import {describe, expect, it} from 'vitest';
import {Config, normalizeConfig} from '@/src/core/config/model';
import {buildConfigDiff} from '@/src/core/config/diff';
import {prepareConfigForExport, prepareConfigForImport} from '@/src/core/config/transfer';
import {sanitizeConfigCredentials} from '@/src/core/config/credentials';
import {createGlossaryLibrary} from '@/src/core/glossary';

function library() {
    return {...createGlossaryLibrary([]), id: 'technical', name: '技术词库', entries: [
        {id: 'agent', source: 'agent', target: '智能体', caseSensitive: false},
        {id: 'brand', source: 'FluentRead', target: '', caseSensitive: true},
    ]};
}

describe('术语库配置与迁移', () => {
    it('默认保持关闭，不隐式选择词库', () => {
        for (const config of [new Config(), normalizeConfig({}), normalizeConfig({glossaryEnabled: 'true'})]) {
            expect(config.glossaryEnabled).toBe(false);
            expect(config.glossaryLibraries).toEqual([]);
        }
    });

    it('词库先规范化，再克隆词条；修改草稿不会污染原始数据', () => {
        const source = {glossaryEnabled: true, glossaryLibraries: [library()]};
        const config = normalizeConfig(source);
        expect(config.glossaryEnabled).toBe(true);
        expect(config.glossaryLibraries).toEqual([library()]);
        config.glossaryLibraries[0].entries[0].target = '修改';
        expect(source.glossaryLibraries[0].entries[0].target).toBe('智能体');
    });

    it('完整和公开配置迁移保留术语与原文规则', () => {
        const source = normalizeConfig({...new Config(), glossaryEnabled: true, glossaryLibraries: [library()]});
        // 完整备份与不含凭据的旧公开配置文件都必须保留术语库。
        for (const exported of [prepareConfigForExport(source), sanitizeConfigCredentials(JSON.parse(JSON.stringify(source)))]) {
            const restored = prepareConfigForImport(JSON.parse(JSON.stringify(exported)), new Config());
            expect(restored.glossaryEnabled).toBe(true);
            expect(restored.glossaryLibraries).toEqual(source.glossaryLibraries);
        }
        const legacy = prepareConfigForImport({on: true, service: 'openai', display: 1, from: 'auto', to: 'zh-Hans'}, source);
        expect(legacy.glossaryEnabled).toBe(false);
        expect(legacy.glossaryLibraries).toEqual([]);
    });
});

describe('术语库配置历史摘要', () => {
    it('以规模提示词库变更，不在差异中展开专业词句', () => {
        const diff = buildConfigDiff({glossaryEnabled: false, glossaryLibraries: []}, {
            glossaryEnabled: true, glossaryLibraries: [library()],
        });
        const changes = diff.groups.flatMap(group => group.changes);
        expect(changes).toContainEqual({key: 'glossaryEnabled', label: '术语库', before: '关闭', after: '开启'});
        expect(changes).toContainEqual({key: 'glossaryLibraries', label: '术语库内容', before: '0 套词库，0 条术语', after: '1 套词库，2 条术语'});
        expect(JSON.stringify(diff)).not.toContain('智能体');
    });

    it('相同数量的词条修改仍显示更新，损坏快照安全降级', () => {
        const before = library();
        const after = {...before, entries: before.entries.map(entry => ({...entry, target: '新的译名'}))};
        expect(buildConfigDiff({glossaryLibraries: [before]}, {glossaryLibraries: [after]}).groups[0].changes[0].after)
            .toBe('1 套词库，2 条术语（内容已更新）');
        const malformed = buildConfigDiff({glossaryLibraries: true}, {
            glossaryLibraries: [{}, null],
        }).groups.flatMap(group => group.changes);
        expect(malformed).toContainEqual({key: 'glossaryLibraries', label: '术语库内容', before: '开启', after: '1 套词库，0 条术语'});
    });
});
