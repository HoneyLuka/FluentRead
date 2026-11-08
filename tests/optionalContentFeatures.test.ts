import {afterEach, describe, expect, it, vi} from 'vitest';
import {createOptionalContentFeatureRuntime, type OptionalContentFeatureConfig} from '@/src/app/content/optionalFeatures';

interface Harness {
    activation: AbortController;
    config: OptionalContentFeatureConfig;
    sectionMount: ReturnType<typeof vi.fn>;
    runtime: ReturnType<typeof createOptionalContentFeatureRuntime>;
}

function createHarness(config: OptionalContentFeatureConfig = {on: true}, isSiteDisabled = () => false): Harness {
    const activation = new AbortController();
    const sectionMount = vi.fn();
    const runtime = createOptionalContentFeatureRuntime({
        activationSignal: activation.signal,
        config,
        isSiteDisabled,
        mountSectionTranslationContentFeature: sectionMount,
    });
    return {activation, config, sectionMount, runtime};
}

afterEach(() => vi.restoreAllMocks());

describe('局部翻译入口内容生命周期', () => {
    it('默认随总开关挂载一次，并传入站点禁用查询端口', () => {
        const harness = createHarness();

        harness.runtime.sync();
        harness.runtime.sync();

        // Popup 的局部按钮随时可用，因此入口随总开关挂载，不依赖快捷键开关。
        expect(harness.sectionMount).toHaveBeenCalledOnce();
        expect(harness.sectionMount.mock.calls[0][0].isSiteDisabled()).toBe(false);
    });

    it('局部翻译入口随总开关启停，并在停用时取消自己的子 signal', () => {
        const harness = createHarness();
        harness.runtime.sync();
        const sectionSignal = harness.sectionMount.mock.calls[0][1] as AbortSignal;

        harness.config.on = false;
        harness.runtime.sync();
        expect(sectionSignal.aborted).toBe(true);

        harness.config.on = true;
        harness.runtime.sync();
        expect(harness.sectionMount).toHaveBeenCalledTimes(2);
        const nextSignal = harness.sectionMount.mock.calls[1][1] as AbortSignal;
        harness.runtime.dispose();
        expect(nextSignal.aborted).toBe(true);
    });

    it('总开关关闭或站点禁用时都不挂载局部翻译入口', () => {
        const disabled = createHarness({on: false});
        disabled.runtime.sync();
        expect(disabled.sectionMount).not.toHaveBeenCalled();

        let siteDisabled = true;
        const harness = createHarness({on: true}, () => siteDisabled);
        harness.runtime.sync();
        expect(harness.sectionMount).not.toHaveBeenCalled();
        siteDisabled = false;
        harness.runtime.sync();
        expect(harness.sectionMount).toHaveBeenCalledOnce();
        harness.runtime.dispose();
    });

    it('父 activation 取消时释放子入口，后续 sync 不会复活，dispose 幂等', () => {
        const harness = createHarness();
        harness.runtime.sync();
        const sectionSignal = harness.sectionMount.mock.calls[0][1] as AbortSignal;

        harness.activation.abort();
        expect(sectionSignal.aborted).toBe(true);
        harness.runtime.sync();
        expect(harness.sectionMount).toHaveBeenCalledOnce();
        harness.runtime.dispose();
        harness.runtime.dispose();
        expect(harness.sectionMount).toHaveBeenCalledOnce();
    });

    it('挂载期间父级同步取消时不保留半挂载入口', () => {
        const activation = new AbortController();
        const sectionMount = vi.fn(() => activation.abort());
        const runtime = createOptionalContentFeatureRuntime({
            activationSignal: activation.signal,
            config: {on: true},
            isSiteDisabled: () => false,
            mountSectionTranslationContentFeature: sectionMount,
        });

        runtime.sync();

        expect(sectionMount).toHaveBeenCalledOnce();
        runtime.dispose();
    });

    it('父 signal 已取消时 sync 安全跳过，dispose 仍幂等', () => {
        const harness = createHarness();
        harness.activation.abort();

        harness.runtime.sync();
        harness.runtime.dispose();
        harness.runtime.dispose();

        expect(harness.sectionMount).not.toHaveBeenCalled();
    });
});
