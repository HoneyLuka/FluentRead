#!/usr/bin/env node

import {readdir, readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const MATRIX_PATH = path.join(PROJECT_ROOT, 'tests/test-matrix.json');
const TEST_ROOT = path.join(PROJECT_ROOT, 'tests');
const GROUPS = ['architecture', 'unit', 'functional', 'regression'];
const TEST_GLOBALS = new Set(['describe', 'it', 'test']);
const SOURCE_ROOTS = ['entrypoints', 'scripts', 'src'];

async function listTestFiles(dir = TEST_ROOT) {
    const entries = await readdir(dir);
    const files = [];
    for (const entry of entries) {
        const absolute = path.join(dir, entry);
        const info = await stat(absolute);
        if (info.isDirectory()) {
            files.push(...await listTestFiles(absolute));
            continue;
        }
        if (entry.endsWith('.test.ts')) {
            files.push(path.relative(PROJECT_ROOT, absolute).replaceAll(path.sep, '/'));
        }
    }
    return files.sort();
}

async function listAuditedSourceFiles(dir) {
    const entries = await readdir(dir, {withFileTypes: true});
    const files = [];
    for (const entry of entries) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listAuditedSourceFiles(absolute));
        } else if (/\.(?:cjs|js|mjs|ts|vue)$/u.test(entry.name)) {
            files.push(absolute);
        }
    }
    return files;
}

async function loadMatrix() {
    const raw = await readFile(MATRIX_PATH, 'utf8');
    return JSON.parse(raw);
}

function lineOf(sourceFile, node) {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function literalName(node) {
    if (!node) return '<dynamic>';
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) {
        return node.head.text + node.templateSpans.map(span => `<dynamic>${span.literal.text}`).join('');
    }
    return '<dynamic>';
}

function calleeInfo(expression) {
    if (ts.isIdentifier(expression) && TEST_GLOBALS.has(expression.text)) {
        return {kind: expression.text, modifier: 'normal'};
    }
    if (ts.isPropertyAccessExpression(expression)) {
        const base = expression.expression;
        const name = expression.name.text;
        if (ts.isIdentifier(base) && TEST_GLOBALS.has(base.text) && ['only', 'skip', 'each'].includes(name)) {
            return {kind: base.text, modifier: name};
        }
    }
    if (ts.isCallExpression(expression)) {
        const inner = calleeInfo(expression.expression);
        if (inner?.modifier === 'each') return {...inner, modifier: 'each-call'};
    }
    return null;
}

function hasSkipExplanation(lines, lineNumber) {
    const current = lines[lineNumber - 1] || '';
    const previous = lines[lineNumber - 2] || '';
    return /(?:skip|跳过|原因|reason)\s*[:：]/iu.test(current) ||
        /(?:skip|跳过|原因|reason)\s*[:：]/iu.test(previous);
}

function collectTestCalls(file, source) {
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const lines = source.split(/\r?\n/u);
    const calls = [];
    const problems = [];

    function visit(node, suites) {
        if (ts.isCallExpression(node)) {
            const info = calleeInfo(node.expression);
            if (info) {
                if (info.modifier === 'each') {
                    ts.forEachChild(node, (child) => visit(child, suites));
                    return;
                }

                const name = literalName(node.arguments[0]);
                const atLine = lineOf(sourceFile, node);
                if (info.modifier === 'only') {
                    problems.push(`${file}:${atLine} 禁止提交 ${info.kind}.only`);
                }
                if (info.modifier === 'skip' && !hasSkipExplanation(lines, atLine)) {
                    problems.push(`${file}:${atLine} ${info.kind}.skip 缺少 skip:/原因: 说明`);
                }

                if (info.kind === 'describe') {
                    const callback = node.arguments[1];
                    if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
                        visit(callback.body, [...suites, name]);
                        return;
                    }
                } else {
                    calls.push({
                        file,
                        line: atLine,
                        fullName: [...suites, name].join(' > '),
                    });
                }
            }
        }
        ts.forEachChild(node, (child) => visit(child, suites));
    }

    visit(sourceFile, []);
    return {calls, problems};
}

function auditMatrix(matrix, actualFiles) {
    const errors = [];
    const seen = new Map();
    for (const group of GROUPS) {
        const files = matrix.groups?.[group];
        if (!Array.isArray(files)) {
            errors.push(`test-matrix 缺少 ${group} 数组`);
            continue;
        }
        for (const file of files) {
            if (seen.has(file)) errors.push(`${file} 同时出现在 ${seen.get(file)} 和 ${group}`);
            seen.set(file, group);
        }
    }

    const actual = new Set(actualFiles);
    for (const file of actualFiles) {
        if (!seen.has(file)) errors.push(`${file} 未归类到 test-matrix`);
    }

    for (const file of seen.keys()) {
        if (!actual.has(file)) errors.push(`${file} 已归类但文件不存在`);
    }
    return errors;
}

async function main() {
    const matrix = await loadMatrix();
    const actualFiles = await listTestFiles();
    const errors = auditMatrix(matrix, actualFiles);
    const fullNames = new Map();

    for (const file of actualFiles) {
        const absolute = path.join(PROJECT_ROOT, file);
        const source = await readFile(absolute, 'utf8');

        // 步骤 1：禁止覆盖率忽略注释，避免用注释伪造 100%。
        const coverageIgnore = source.match(/\b(?:v8|istanbul|c8|coverage)\s+ignore\b/iu);
        if (coverageIgnore) errors.push(`${file} 包含覆盖率忽略指令`);

        // 步骤 2：用 TypeScript AST 提取 describe/it/test，避免简单 grep 漏掉 it.each。
        const {calls, problems} = collectTestCalls(file, source);
        errors.push(...problems);

        // 步骤 3：完整 suite+case 名不能重复，减少复制测试只改断言不改意图的情况。
        for (const call of calls) {
            const key = call.fullName;
            const existing = fullNames.get(key);
            if (existing) {
                errors.push(`重复测试名：${key}（${existing.file}:${existing.line} 与 ${call.file}:${call.line}）`);
            } else {
                fullNames.set(key, call);
            }
        }
    }

    // 步骤 4：同一条 ignore 禁令覆盖业务源码与测试，不能把未覆盖分支藏在被测模块里。
    for (const sourceRoot of SOURCE_ROOTS) {
        for (const absolute of await listAuditedSourceFiles(path.join(PROJECT_ROOT, sourceRoot))) {
            const source = await readFile(absolute, 'utf8');
            if (/\b(?:v8|istanbul|c8|coverage)\s+ignore\b/iu.test(source)) {
                errors.push(`${path.relative(PROJECT_ROOT, absolute)} 包含覆盖率忽略指令`);
            }
        }
    }

    if (errors.length > 0) {
        console.error(`测试套件审计失败：\n- ${errors.join('\n- ')}`);
        process.exit(1);
    }

    console.log(JSON.stringify({
        status: 'ok',
        groups: Object.fromEntries(GROUPS.map((group) => [group, matrix.groups[group].length])),
        files: actualFiles.length,
        cases: fullNames.size,
    }, null, 2));
}

main().catch((error) => {
    console.error(`[test-audit] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
