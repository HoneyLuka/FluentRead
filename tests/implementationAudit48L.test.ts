/**
 * 文件职责：执行当前内容注册表的公开状态、取消和清理合同。
 * 模块边界：使用真实注册表；被调用功能的 mount/unmount 为受控端口。
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {ContentScriptContext} from 'wxt/utils/content-script-context';
import type {ContentFeatureDefinition, ContentFeatureRuntime} from '@/src/app/content/featureRegistry';
import {createContentFeatureRegistry, rejectUnsupportedContentFeature, type ContentFeatureRegistry} from '@/src/app/content/featureRegistry';
import {browserCapabilities, resolveBrowserCapabilities} from '@/src/platform/browser/capabilities';

const ctx = {isInvalid: false} as ContentScriptContext;
const capabilities = resolveBrowserCapabilities({browser: 'chrome', manifestVersion: 3});
let registries: ContentFeatureRegistry[];
function deferred<T>() {
    let resolve!: (value: T) => void, reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
    return {promise, resolve, reject};
}
function activation(controller = new AbortController(), isCurrent = () => !controller.signal.aborted): ContentFeatureRuntime {
    return {ctx, signal: controller.signal, isCurrent};
}
function registry(features: ContentFeatureDefinition[], onError?: (id: string, phase: 'mount' | 'unmount', error: unknown) => void) {
    const result = createContentFeatureRegistry(features, {capabilities, onError});
    registries.push(result);
    return result;
}
function onlyStatus(rows: {status: string}[]) {return rows[0].status;}
beforeEach(() => {registries = [];});
afterEach(() => {
    registries.forEach(value => value.unmountAll());
    vi.restoreAllMocks();
});

describe('48L 注册表公开状态合同', () => {
    it('未注入 options 时使用生产浏览器能力门控，而不是绕过默认能力', async () => {
        const mount = vi.fn(), isEnabled = vi.fn(() => true);
        const runtime = createContentFeatureRegistry([{id: 'default-capability', requiredCapability: 'chromeTranslation', isEnabled, mount}]);
        registries.push(runtime);
        expect(onlyStatus(await runtime.mountEnabled(activation()))).toBe(browserCapabilities.chromeTranslation ? 'mounted' : 'skipped');
        expect(mount).toHaveBeenCalledTimes(browserCapabilities.chromeTranslation ? 1 : 0);
    });
    it('显式 false 不被历史 Set 覆盖，显式外部 true 仍兼容并归入清理所有权', async () => {
        let actual = true, enabled = true; const mount = vi.fn(() => {actual = true;}), unmount = vi.fn(() => {actual = false;});
        const runtime = registry([{id: 'external', isEnabled: () => enabled, isMounted: () => actual, mount, unmount}]);
        await runtime.mountEnabled(activation()); expect(mount).not.toHaveBeenCalled(); actual = false;
        await runtime.reconcileEnabled(); expect(mount).toHaveBeenCalledOnce();
        enabled = false; await runtime.reconcileEnabled(); expect(unmount).toHaveBeenCalledOnce();
    });
    it('没有 isMounted 的定义继续由 Set 去重，关闭并重开才重新挂载', async () => {
        let enabled = true; const mount = vi.fn(), unmount = vi.fn();
        const runtime = registry([{id: 'set-only', isEnabled: () => enabled, mount, unmount}]);
        await runtime.mountEnabled(activation()); await runtime.reconcileEnabled(); expect(mount).toHaveBeenCalledOnce();
        enabled = false; await runtime.reconcileEnabled(); enabled = true; await runtime.reconcileEnabled();
        expect(mount).toHaveBeenCalledTimes(2); expect(unmount).toHaveBeenCalledOnce();
    });
    it('空激活、已取消及已失效激活均不读取启用条件', async () => {
        const isEnabled = vi.fn(() => true), mount = vi.fn(), runtime = registry([{id: 'inactive', isEnabled, mount}]);
        expect(onlyStatus(await runtime.reconcileEnabled())).toBe('skipped');
        const controller = new AbortController(); controller.abort(); await runtime.mountEnabled(activation(controller));
        await runtime.mountEnabled(activation(new AbortController(), () => false)); expect(isEnabled).not.toHaveBeenCalled(); expect(mount).not.toHaveBeenCalled();
    });
    it('不支持的 capability 先于配置门控，支持的定义按注册顺序执行', async () => {
        const disabled = vi.fn(() => true), mount = vi.fn(), runtime = createContentFeatureRegistry([
            {id: 'unsupported', requiredCapability: 'chromeTranslation', isEnabled: disabled, mount},
            {id: 'healthy', isEnabled: () => true, mount},
        ], {capabilities: resolveBrowserCapabilities({browser: 'safari', manifestVersion: 3})}); registries.push(runtime);
        expect((await runtime.mountEnabled(activation())).map(row => row.status)).toEqual(['skipped', 'mounted']);
        expect(disabled).not.toHaveBeenCalled(); expect(mount).toHaveBeenCalledOnce();
    });
    it('挂载异常上报但不阻断后续功能，无清理回调也可关闭', async () => {
        let enabled = true; const error = new Error('controlled mount failure'), onError = vi.fn(), later = vi.fn();
        const runtime = registry([{id: 'broken', isEnabled: () => true, mount: () => {throw error;}}, {id: 'healthy', isEnabled: () => enabled, mount: later}], onError);
        expect((await runtime.mountEnabled(activation())).map(row => row.status)).toEqual(['failed', 'mounted']);
        expect(onError).toHaveBeenCalledWith('broken', 'mount', error); expect(later).toHaveBeenCalledOnce();
        enabled = false; await runtime.reconcileEnabled();
    });
    it('等待中激活失效且 mount 拒绝时不报告产品错误，也不启动后续功能', async () => {
        let current = true; const gate = deferred<void>(), later = vi.fn(), onError = vi.fn();
        const runtime = registry([{id: 'pending', isEnabled: () => true, mount: () => gate.promise}, {id: 'later', isEnabled: () => true, mount: later}], onError);
        const pending = runtime.mountEnabled(activation(new AbortController(), () => current)); current = false; gate.reject(new Error('cancelled port'));
        expect((await pending).map(row => row.status)).toEqual(['skipped', 'skipped']); expect(onError).not.toHaveBeenCalled(); expect(later).not.toHaveBeenCalled();
    });
    it('没有状态查询的迟到挂载关闭时仍卸载，当前失效则不清理新激活的 singleton', async () => {
        let enabled = true, current = true; const unmount = vi.fn();
        const runtime = registry([{id: 'config-close', isEnabled: () => enabled, mount: () => {enabled = false;}, unmount},
            {id: 'activation-close', isEnabled: () => true, mount: () => {current = false;}, unmount}]);
        expect((await runtime.mountEnabled(activation(new AbortController(), () => current))).map(row => row.status)).toEqual(['skipped', 'skipped']);
        expect(unmount).toHaveBeenCalledOnce();
    });
    it('卸载异常仍清掉 Set，逆序总清理继续释放其他定义', async () => {
        let enabled = true; const error = new Error('controlled remove failure'), onError = vi.fn(), mount = vi.fn(), order: string[] = [];
        const runtime = registry([{id: 'first', isEnabled: () => enabled, mount, unmount: () => {order.push('first');}},
            {id: 'last', isEnabled: () => enabled, mount, unmount: () => {order.push('last'); throw error;}}], onError);
        await runtime.mountEnabled(activation()); enabled = false; await runtime.reconcileEnabled();
        expect(onError).toHaveBeenCalledWith('last', 'unmount', error); enabled = true; await runtime.reconcileEnabled(); expect(mount).toHaveBeenCalledTimes(4);
        order.length = 0; runtime.unmountAll(); expect(order).toEqual(['last', 'first']);
    });
    it('unsupported 公共帮助函数保留受支持入口，拒绝入口只清理一次并返回明确响应', () => {
        const unmount = vi.fn(), send = vi.fn();
        expect(rejectUnsupportedContentFeature(true, unmount, send, 'unsupported')).toBe(false); expect(unmount).not.toHaveBeenCalled();
        expect(rejectUnsupportedContentFeature(false, unmount, send, 'unsupported')).toBe(true);
        expect(unmount).toHaveBeenCalledOnce(); expect(send).toHaveBeenCalledWith({status: 'unsupported', error: 'unsupported'});
    });
});
