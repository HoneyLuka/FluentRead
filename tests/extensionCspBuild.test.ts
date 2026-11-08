import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createContext, runInContext} from 'node:vm';
import {extensionCspBuildPlugin, patchExtensionVendorSource, type ExtensionVendorSource} from '../scripts/testing/extension-csp-build';
import {defuddleEntityBuildPlugin, patchDefuddleEntitySource, replaceDefuddleEntityDecoder} from '../scripts/testing/defuddle-entity-build';
import {decodeTextareaHtml} from '../src/shared/text/htmlEntities';

const require = createRequire(import.meta.url);
const sources: Record<ExtensionVendorSource, string> = {
    'jszip': require.resolve('jszip/dist/jszip.min.js'),
    'lodash-root': createRequire(require.resolve('element-plus')).resolve('lodash-es/_root.js'),
};
const original = (kind: ExtensionVendorSource) => fs.readFileSync(sources[kind], 'utf8');
const patched = (kind: ExtensionVendorSource) => patchExtensionVendorSource(kind, original(kind));
const sandbox = (values: Record<string, unknown> = {}) => createContext(values, {codeGeneration: {strings: false, wasm: false}});

describe('extension dependency CSP packaging', () => {
    it('固定 Defuddle UMD 入口并只替换实体解码，保留默认导出的构造器', () => {
        const sourcePath = require.resolve('defuddle');
        const source = fs.readFileSync(sourcePath, 'utf8');
        const result = patchDefuddleEntitySource(source);
        expect(fs.readFileSync(sourcePath, 'utf8')).toBe(source);
        expect(result).not.toContain('e.decodeHTMLEntities=function(t,e){const r=t.createElement("textarea");return r.innerHTML=e,r.value}');
        expect(() => patchDefuddleEntitySource(source + '\n')).toThrow(/Unsupported Defuddle source/);
        const anchor = 'e.decodeHTMLEntities=function(t,e){const r=t.createElement("textarea");return r.innerHTML=e,r.value}';
        expect(replaceDefuddleEntityDecoder(anchor)).toBe('e.decodeHTMLEntities=function(t,e){return __fluentreadDecodeTextareaHtml(e,t)}');
        expect(() => replaceDefuddleEntityDecoder('missing')).toThrow(/Missing or ambiguous/);
        expect(() => replaceDefuddleEntityDecoder(anchor + anchor)).toThrow(/Missing or ambiguous/);
        const plugin = defuddleEntityBuildPlugin();
        const transform = plugin.transform as (source: string, id: string) => {code: string} | undefined;
        expect(transform(source, '\0virtual')).toBeUndefined();
        expect(transform(source, sourcePath + '?commonjs-proxy')).toBeUndefined();
        expect(transform(source, sourcePath)?.code).toBe(result);

        const context = sandbox({__fluentreadDecodeTextareaHtml: decodeTextareaHtml});
        runInContext(result.replace(/^import[^\n]+\n/u, '')
            .replace('export default module.exports;', 'globalThis.fixtureDefuddle = module.exports;'), context);
        expect(context.fixtureDefuddle).toBeTypeOf('function');
        expect(Object.getOwnPropertyNames(context.fixtureDefuddle.prototype))
            .toEqual(Object.getOwnPropertyNames(require('defuddle').prototype));
    });

    it.each(Object.keys(sources) as ExtensionVendorSource[])('固定完整 %s 源码，拒绝上游变化且不修改原依赖', kind => {
        const source = original(kind);
        const result = patchExtensionVendorSource(kind, source);
        expect(result).not.toBe(source);
        expect(fs.readFileSync(sources[kind], 'utf8')).toBe(source);
        expect(result).not.toMatch(/\b(?:new\s+)?Function\s*\(/);
        expect(() => patchExtensionVendorSource(kind, `${source}\n`)).toThrow(/Unsupported/);
        expect(() => patchExtensionVendorSource(kind, result)).toThrow(/Unsupported/);
    });

    it('JSZip 在禁用字符串代码执行的上下文中保留异步压缩和解压', async () => {
        const context = sandbox({module: {exports: {}}, exports: {}, setTimeout, clearTimeout, Uint8Array, ArrayBuffer, Promise});
        context.self = context;
        runInContext(patched('jszip'), context);
        const Zip = context.module.exports;
        const input = new Zip();
        input.file('hello.txt', '你好 Firefox');
        const bytes = await input.generateAsync({type: 'uint8array', compression: 'DEFLATE'});
        const restored = await Zip.loadAsync(bytes, {checkCRC32: true});
        expect(await restored.file('hello.txt').async('string')).toBe('你好 Firefox');
    });



    it('lodash 保留现代浏览器全局且无需编译字符串', () => {
        const context = sandbox({module: {exports: {}}});
        const root = patched('lodash-root').replace("import freeGlobal from './_freeGlobal.js';", 'var freeGlobal=undefined;')
            .replace('export default root;', 'globalThis.fixtureRoot=root;');
        runInContext(root, context);
        expect(context.fixtureRoot).toBe(context.fixtureRoot.globalThis);
    });

    it('模块 transform 仅匹配固定依赖，不处理业务源码或代理地址', () => {
        const plugin = extensionCspBuildPlugin();
        const transform = plugin.transform as (source: string, id: string) => {code: string} | undefined;
        expect(transform('const x=1;', '/src/business.ts')).toBeUndefined();
        expect(transform('wrapper', '\0/vendor/jszip/dist/jszip.min.js')).toBeUndefined();
        expect(transform('wrapper', `${sources.jszip}?commonjs-proxy`)).toBeUndefined();
        expect(transform(original('jszip'), sources.jszip)?.code).toBe(patched('jszip'));
    });
});
