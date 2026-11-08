import {createHash} from 'node:crypto';
import type {Plugin} from 'vite';

/**
 * 固定版本依赖的扩展 CSP 适配。原始依赖保持不变；只在构建副本中
 * 使用现代浏览器原生全局与现有解释执行分支，避免发布包携带字符串代码执行入口。
 * 每个完整输入均锁定 SHA-256；上游升级须重新审查，不能猜测替换压缩后的任意代码。
 */
const SOURCE_SHA256 = {
    'jszip': 'acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e',
    'lodash-root': 'df58ff96c454ca91ace20d20e6af49b354c70dfba7e737adc00cd23e8ff77168',
} as const;
export type ExtensionVendorSource = keyof typeof SOURCE_SHA256;

function replaceOnce(source: string, before: string, after: string): string {
    if (source.split(before).length !== 2) throw new Error('Missing or ambiguous extension CSP patch match');
    return source.replace(before, after);
}

export function patchExtensionVendorSource(kind: ExtensionVendorSource, original: string): string {
    if (createHash('sha256').update(original).digest('hex') !== SOURCE_SHA256[kind]) {
        throw new Error(`Unsupported ${kind} source: review extension CSP packaging before upgrading`);
    }
    const source = original;
    switch (kind) {
        case 'lodash-root':
            return replaceOnce(source, "Function('return this')()", 'globalThis');
        case 'jszip':
            // JSZip 自身只传函数；不支持历史 setImmediate 字符串回调，避免将字符串编译成代码。
            return replaceOnce(source, '"function"!=typeof e&&(e=new Function(""+e));',
                'if("function"!=typeof e)throw new TypeError("setImmediate callback must be a function");');
    }
}

/** WXT 构建内的模块与 ?url worker 资源均适配；不改 node_modules 或源码仓库中的 vendor。 */
export function extensionCspBuildPlugin(): Plugin {
    return {
        name: 'fluentread-extension-csp-vendor',
        enforce: 'pre',
        apply: 'build',
        transform(source, id) {
            if (id.includes('\0') || id.includes('?')) return;
            const file = id.replace(/\\/g, '/');
            const modules: [RegExp, ExtensionVendorSource][] = [
                [/(?:^|\/)jszip\/dist\/jszip\.min\.js$/, 'jszip'],
                [/(?:^|\/)lodash-es\/_root\.js$/, 'lodash-root'],
            ];
            const match = modules.find(([pattern]) => pattern.test(file));
            if (match) return {code: patchExtensionVendorSource(match[1], source), map: null};
        },
    };
}
