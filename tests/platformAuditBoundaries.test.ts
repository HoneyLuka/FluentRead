/**
 * @file tests/platformAuditBoundaries.test.ts
 * 文件职责：验证平台摘要、浏览器标识与编译期能力契约的输入边界。
 * 主要内容：摘要的编码与非法输入、tab/window ID 判定，以及构建目标和运行时 UA 约束。
 * 模块边界：不启动浏览器，不访问网络或账号；只测试共享平台模块，不修改编译环境。
 */
import {createHash} from 'node:crypto';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {sha256Hex} from '@/src/shared/function/sha256';
import {applyRuntimeBrowserConstraints, browserBuildTargetFromEnv, browserCapabilities, browserCapabilityBuildMarker, readRuntimeUserAgent, resolveBrowserCapabilities} from '@/src/platform/browser/capabilities';
import {isBrowserTabId} from '@/src/platform/browser/ids';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('摘要与浏览器 ID 输入边界', () => {
    it.each(['', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), '\uD800', '\uDC00', 'a\u0000中🙂e\u0301', '🙂中文'.repeat(100_000)])('UTF-8 摘要与原生结果一致 %#', value => {
        expect(sha256Hex(value)).toBe(createHash('sha256').update(value).digest('hex'));
        expect(sha256Hex(value)).toMatch(/^[0-9a-f]{64}$/);
    });
    it.each([undefined, null, 1, {}, true])('拒绝非法标量与普通对象输入 %#', value => {
        expect(() => sha256Hex(value as unknown as string)).toThrow();
    });
    it('保留底层字节输入的运行时兼容性且不修改调用方 view', () => {
        const input = new Uint8Array([77, 0, 97, 98, 99, 77]);
        const view = input.subarray(1, 5);
        expect(sha256Hex(view as unknown as string)).toBe(createHash('sha256').update(view).digest('hex'));
        expect(input).toEqual(new Uint8Array([77, 0, 97, 98, 99, 77]));
    });
    it('摘要不做 Unicode 或换行规范化，避免合并不同缓存与签名身份', () => {
        expect(sha256Hex('é')).not.toBe(sha256Hex('e\u0301'));
        expect(sha256Hex('a\r\nb')).not.toBe(sha256Hex('a\nb'));
    });
    it.each([0, -0, 1, Number.MAX_SAFE_INTEGER])('接受合法 tab/window ID %#', id => { expect(isBrowserTabId(id)).toBe(true); });
    it.each([-1, -0.1, 1.1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '0', 0n, null, undefined, {}, new Number(0)])('拒绝缺失、非法或来源类型错误的 ID %#', id => { expect(isBrowserTabId(id)).toBe(false); });
});

describe('浏览器构建与运行能力契约', () => {
    it('规范化不受土耳其语大小写影响', () => {
        const original = String.prototype.toLocaleLowerCase;
        vi.spyOn(String.prototype, 'toLocaleLowerCase').mockImplementation(function (this: string) { return original.call(this, 'tr'); });
        expect(resolveBrowserCapabilities({browser: ' FIREFOX ', manifestVersion: 2}).extensionDom).toBe(true);
        expect(browserBuildTargetFromEnv({BROWSER: 'FIREFOX'})).toEqual({browser: 'firefox', manifestVersion: 2});
    });
    it('仅提供确定的构建支持范围，不从 UA 打开功能', () => {
        for (const [browser, manifestVersion, dom, translator] of [
            ['chrome', 3, true, true], ['edge', 3, true, false], ['firefox', 2, true, false],
            ['firefox', 3, false, false], ['chrome', 2, false, false], ['edge', 2, false, false],
            ['userscript', 2, false, false], ['unknown', 3, false, false], ['', 2, false, false],
        ] as const) {
            const result = resolveBrowserCapabilities({browser, manifestVersion});
            expect(result).toMatchObject({extensionDom: dom, selectionTtsExtensionPlayback: dom, chromeTranslation: translator, selectionTtsPageFallback: true});
            expect(result.offscreenDocument).toBe(dom && browser !== 'firefox');
            expect(Object.isFrozen(result)).toBe(true);
        }
    });
    it('Chrome 包在 Edge 上收紧翻译能力，Firefox 包在 Thunderbird 上收紧 DOM 能力', () => {
        const chrome = resolveBrowserCapabilities({browser: 'chrome', manifestVersion: 3});
        const firefox = resolveBrowserCapabilities({browser: 'firefox', manifestVersion: 2});
        for (const ua of ['Edg/130', 'EdgA/130', 'EdgiOS/130']) {
            expect(applyRuntimeBrowserConstraints(chrome, ua)).toMatchObject({browser: 'edge', extensionDom: true, chromeTranslation: false});
        }
        expect(applyRuntimeBrowserConstraints(chrome, 'Thunderbird/130')).toBe(chrome);
        expect(applyRuntimeBrowserConstraints(firefox, 'Edg/130')).toBe(firefox);
        expect(applyRuntimeBrowserConstraints(firefox, 'Firefox/130')).toBe(firefox);
        expect(applyRuntimeBrowserConstraints(firefox, 'Thunderbird/130')).toMatchObject({browser: 'thunderbird', extensionDom: false});
    });
    it('环境缺失和非法 MV 安全回退，合法 MV 保持原值', () => {
        expect(browserBuildTargetFromEnv()).toEqual({browser: 'unknown', manifestVersion: 2});
        expect(browserBuildTargetFromEnv({BROWSER: 'edge'})).toEqual({browser: 'edge', manifestVersion: 3});
        expect(browserBuildTargetFromEnv({BROWSER: 'chrome'})).toEqual({browser: 'chrome', manifestVersion: 3});
        expect(browserBuildTargetFromEnv({BROWSER: 'firefox', MANIFEST_VERSION: 3})).toEqual({browser: 'firefox', manifestVersion: 3});
        expect(browserBuildTargetFromEnv({BROWSER: 'chrome', MANIFEST_VERSION: 2})).toEqual({browser: 'chrome', manifestVersion: 2});
        expect(browserBuildTargetFromEnv({BROWSER: 2, MANIFEST_VERSION: 4} as unknown as Partial<ImportMetaEnv>)).toEqual({browser: 'unknown', manifestVersion: 2});
        expect(browserBuildTargetFromEnv({BROWSER: ' '})).toEqual({browser: 'unknown', manifestVersion: 2});
        expect(readRuntimeUserAgent({})).toBe('');
        expect(readRuntimeUserAgent({navigator: {userAgent: 0}})).toBe('');
        expect(readRuntimeUserAgent({navigator: {userAgent: 'Edg/130'}})).toBe('Edg/130');
        expect(Object.isFrozen(browserCapabilities)).toBe(true);
        expect(browserCapabilities.buildTargetMarker).toBe(browserCapabilityBuildMarker);
    });
});
