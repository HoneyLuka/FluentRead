/**
 * @file tests/contentRuntimeLifecycle.test.ts
 * 文件职责：验证内容应用启动、配置等待、页面暂停恢复与离开时的生命周期边界。
 * 主要内容：验证文章导航、锚点跳转、禁用与恢复后的触发归属，以及原始 XML、失效上下文和伪造事件；另经全局字体配置、只读诊断与悬浮入口验证配置代次、站点许可、后端端口和清理联动。
 * 模块边界：常规生命周期隔离无关 feature；集成场景运行真实消息、字体与悬浮生产控制器，仅提供确定性 DOM 布局、CSS Highlight、Shadow UI 和后端消息端口，不声称覆盖真实浏览器或在线翻译服务。
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {setMaxListeners} from 'node:events';
import {Config} from '@/src/core/config/model';
import {installContentPageLifecycle, waitForContentDocument} from '@/src/app/content/pageLifecycle';
import {isRawXmlContentDocument} from '@/src/shared/dom/documentType';

const mocks = vi.hoisted(() => ({
    realComposition: false, createUi: vi.fn(),
    config: {
        on: true, autoTranslate: false, alwaysTranslateDomains: [] as string[], disabledExtensionDomains: [] as string[], bilingualSentenceHighlightEnabled: true,
        browserDefaultTranslationFont: false,
        disableFloatingBall: true, disableSelectionTranslator: true,
        translationProgressPanelEnabled: false,
    },
    configReady: Promise.resolve(), subscribeConfig: vi.fn(),
    ensureLanguageBundle: vi.fn(), languageBundleWait: undefined as Promise<boolean> | undefined,
    installPageStyles: vi.fn(), removeStyles: vi.fn(), syncHighlight: vi.fn(),
    restoreOriginal: vi.fn(),
    resetRouteState: vi.fn(), autoTranslate: vi.fn(), fullPageActive: false,
    addRuntimeListener: vi.fn(), removeRuntimeListener: vi.fn(), createMessageHandler: vi.fn(),
    setBridges: vi.fn(), siteAdaptationRouteChanged: vi.fn(),
    pageFontEnabled: false, pageFontReset: vi.fn(), pageFontDispose: vi.fn(),
    floatingBallAllowed: true,
}));
vi.mock('webextension-polyfill', () => ({default: {
    get extension() {return (globalThis as any).browser?.extension;},
    get runtime() {return (globalThis as any).browser?.runtime;},
}}));
vi.mock('@/src/services/config/store', () => ({
    config: mocks.config, get configReady() { return mocks.configReady; }, subscribeConfig: mocks.subscribeConfig,
}));
vi.mock('@/src/platform/i18n/uiLanguageBundles', async importOriginal => {
    const actual = await importOriginal<typeof import('@/src/platform/i18n/uiLanguageBundles')>();
    return {...actual, ensureUiLanguageBundle: (language: unknown) => {
        mocks.ensureLanguageBundle(language);
        return mocks.languageBundleWait ?? actual.ensureUiLanguageBundle(language);
    }};
});
vi.mock('wxt/utils/content-script-ui/shadow-root', () => ({createShadowRootUi: mocks.createUi}));
vi.mock('@/src/app/content/features', async () => {
    const hover = await import('@/src/features/hover-translation/public');
    return ({
    ...Object.fromEntries([
        'autoTranslateEnglishPage', 'cancelPendingHoverTranslation', 'handleTranslation', 'noteBilingualHostGesture',
        'isFullPageTranslationActive', 'mountFloatingBall', 'mountSelectionTranslator', 'mountTranslationProgressPanel',
        'mountSectionTranslationContentFeature', 'readVisibleTranslationRoot', 'startSectionTranslationPicker',
        'translateSelectionFromContextMenu', 'isSameLanguage', 'normalizeSelectionText', 'readSelectionText',
        'shouldIgnoreSelection', 'unmountFloatingBall', 'unmountSelectionTranslator', 'unmountTranslationProgressPanel',
        'isFullPageTranslationActive', 'getTranslationToolbarStatus', 'getFullPageTranslationDiagnostic',
        'readFullPageUnchangedCompletion', 'getFullPageTranslationFrameState',
        'invalidateFullPageTranslationSessionCache',
    ].map(name => [name, vi.fn()])),
    isFloatingBallAllowedOnPage: () => mocks.floatingBallAllowed,
    createPageTranslationDisplayModeSync: (_initial: unknown, apply: (next: any) => void) => apply,
    restoreOriginalContent: mocks.restoreOriginal,
    resetFullPageTranslationRouteState: mocks.resetRouteState,
    autoTranslateEnglishPage: mocks.autoTranslate,
    isFullPageTranslationActive: () => mocks.fullPageActive,
    getFullPageTranslationDocumentToken: () => 'composition-document',
    getTranslationToolbarStatus: () => 'idle',
    getFullPageTranslationDiagnostic: () => undefined,
    readFullPageUnchangedCompletion: () => undefined,
    getFullPageTranslationFrameState: () => undefined,
    mountHoverTranslationContentFeature: (...args: Parameters<typeof hover.mountHoverTranslationContentFeature>) => mocks.realComposition ? hover.mountHoverTranslationContentFeature(...args) : vi.fn(),
});});
vi.mock('@/src/services/translation/client', () => ({cancelAllTranslations: vi.fn()}));
vi.mock('@/src/services/translation/context', () => ({resetPageTranslationContextCache: vi.fn()}));
vi.mock('@/src/services/translation/legacyPageCache', () => ({clearLegacyPageTranslationCache: vi.fn()}));
vi.mock('@/src/app/content/hotkeyRuntime', () => ({
    createContentHotkeyRuntime: () => ({installFloatingBallHotkey: () => vi.fn(), selectionShortcutPorts: {getConfiguredSelectionHotkey: () => 'none', getCustomSelectionHotkey: () => '', hasActiveSelectionTranslationCandidate: () => false, matchesSelectionTranslatorShortcut: () => false, shouldReserveSelectionShortcut: () => false}}),
}));
vi.mock('@/src/app/content/quickTranslationRuntime', () => ({mountConfiguredQuickTranslation: vi.fn()}));
vi.mock('@/src/app/content/pageStyles', () => ({installPageStyles: mocks.installPageStyles}));
vi.mock('@/src/app/content/pageTranslationFont', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/src/app/content/pageTranslationFont')>();
    return {createPageTranslationFontRuntime: (...args: Parameters<typeof actual.createPageTranslationFontRuntime>) => mocks.realComposition ? actual.createPageTranslationFontRuntime(...args) : ({
    read: () => mocks.pageFontEnabled,
    set: (enabled: boolean) => {mocks.pageFontEnabled = enabled; return true;},
    reset: () => {mocks.pageFontEnabled = false; mocks.pageFontReset();},
    dispose: () => {mocks.pageFontEnabled = false; mocks.pageFontDispose();},
})};});
vi.mock('@/src/app/content/qqMailFrameRuntime', () => ({
    installQqMailTopFrameBridge: vi.fn(),
    installNeteaseMailTopFrameBridge: vi.fn(),
}));
vi.mock('@/src/app/content/embeddedFrameRuntime', () => ({installEmbeddedTopFrameBridge: vi.fn()}));
vi.mock('@/src/app/content/mainWorldBridgeLifecycle', () => ({setMainWorldBridgesEnabled: mocks.setBridges}));
vi.mock('@/src/app/content/messageRuntime', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/src/app/content/messageRuntime')>();
    return {createContentRuntimeMessageHandler: (...args: Parameters<typeof actual.createContentRuntimeMessageHandler>) => mocks.realComposition ? actual.createContentRuntimeMessageHandler(...args) : mocks.createMessageHandler(...args)};
});
vi.mock('@/src/app/content/bilingualSentenceHighlight', () => ({syncBilingualSentenceHighlight: mocks.syncHighlight}));
vi.mock('@/src/app/content/siteAdaptationRuntime', () => ({
    createContentSiteAdaptationRuntime: () => ({routeChanged: mocks.siteAdaptationRouteChanged, update: vi.fn()}),
    applyCoreTranslationPreferences: vi.fn(() => false),
}));

function transition(target: EventTarget, type: string, persisted = false, trusted = true): void {
    // Node EventTarget 没有浏览器导航入口；只在夹具中标记浏览器派发的可信生命周期。
    const event = Object.assign(new Event(type), {persisted});
    Object.defineProperty(event, 'isTrusted', {value: trusted});
    target.dispatchEvent(event);
}

class FakeMutationObserver {
    static instance: FakeMutationObserver | null = null;
    readonly observe = vi.fn();
    readonly disconnect = vi.fn();

    constructor(private readonly callback: () => void) {
        FakeMutationObserver.instance = this;
    }

    trigger(): void {
        this.callback();
    }
}

function createLoadingDocument(): {document: Document; setBody: () => void} {
    const target = new EventTarget() as Document;
    const documentElement = {isConnected: true} as unknown as HTMLElement;
    let body: Node | null = null;
    Object.defineProperties(target, {
        documentElement: {configurable: true, get: () => documentElement},
        body: {configurable: true, get: () => body},
    });
    return {
        document: target,
        setBody: () => { body = {isConnected: true} as unknown as Node; },
    };
}

describe('content document 基础 DOM 就绪边界', () => {
    afterEach(() => {
        FakeMutationObserver.instance = null;
        vi.unstubAllGlobals();
    });

    it('body 出现后立即放行，不等待 DOMContentLoaded', async () => {
        const {document, setBody} = createLoadingDocument();
        vi.stubGlobal('MutationObserver', FakeMutationObserver);
        const ready = waitForContentDocument(document, new AbortController().signal);

        expect(FakeMutationObserver.instance).not.toBeNull();
        setBody();
        FakeMutationObserver.instance!.trigger();

        await expect(ready).resolves.toBe(true);
        expect(FakeMutationObserver.instance!.disconnect).toHaveBeenCalledOnce();
        FakeMutationObserver.instance!.trigger();
    });

    it('已有基础 DOM 时同步放行', async () => {
        const {document, setBody} = createLoadingDocument();
        setBody();

        await expect(waitForContentDocument(document, new AbortController().signal)).resolves.toBe(true);
    });

    it('信号已取消时不建立观察器', async () => {
        const {document} = createLoadingDocument();
        const controller = new AbortController();
        controller.abort();

        await expect(waitForContentDocument(document, controller.signal)).resolves.toBe(false);
    });

    it('页面离开时结束等待，不迟到激活内容功能', async () => {
        const {document} = createLoadingDocument();
        const controller = new AbortController();
        vi.stubGlobal('MutationObserver', FakeMutationObserver);
        const ready = waitForContentDocument(document, controller.signal);

        controller.abort();

        await expect(ready).resolves.toBe(false);
        expect(FakeMutationObserver.instance!.disconnect).toHaveBeenCalledOnce();
    });
});

describe('内容脚本文档类型边界', () => {
    it.each([
        ['text/html', false],
        ['application/xhtml+xml', false],
        ['text/plain', false],
        ['application/json', false],
        ['text/xml', true],
        ['application/xml', true],
        ['application/rss+xml', true],
        ['image/svg+xml', true],
        ['text/xsl', true],
    ] as const)('%s 是否属于原始 XML 文档：%s', (contentType, expected) => {
        expect(isRawXmlContentDocument({contentType})).toBe(expected);
    });
});

describe('content runtime 页面生命周期', () => {
    it('可信前后台切换调整检查预算，伪造事件和往返缓存中的可见性变化不能恢复检查', () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        try {
            const target = new EventTarget();
            const pageDocument = Object.assign(new EventTarget(), {visibilityState: 'visible'});
            const readInvalid = vi.fn(() => false);
            const actions = {suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn()};
            installContentPageLifecycle(target, controller.signal, actions,
                {get isInvalid() { return readInvalid(); }}, pageDocument as unknown as Document);
            pageDocument.visibilityState = 'hidden';
            transition(pageDocument, 'visibilitychange', false, false);
            vi.advanceTimersByTime(1000);
            expect(readInvalid).toHaveBeenCalledOnce();
            transition(pageDocument, 'visibilitychange');
            vi.advanceTimersByTime(4999);
            expect(readInvalid).toHaveBeenCalledOnce();
            vi.advanceTimersByTime(1);
            expect(readInvalid).toHaveBeenCalledTimes(2);
            transition(target, 'pagehide', true);
            pageDocument.visibilityState = 'visible';
            transition(pageDocument, 'visibilitychange');
            expect(readInvalid).toHaveBeenCalledTimes(2);
            expect(vi.getTimerCount()).toBe(0);
            transition(target, 'pageshow', true);
            transition(pageDocument, 'visibilitychange');
            expect(readInvalid).toHaveBeenCalledTimes(4);
            expect(actions.resume).toHaveBeenCalledOnce();
        } finally { controller.abort(); vi.useRealTimers(); }
    });

    it('WXT getter 同步触发失效回调时清理一次，不再由轮询重复销毁', () => {
        vi.useFakeTimers();
        try {
            let invalidated!: () => void;
            const unsubscribe = vi.fn();
            const actions = {suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn()};
            installContentPageLifecycle(new EventTarget(), new AbortController().signal, actions, {
                get isInvalid() { invalidated(); return true; },
                onInvalidated(callback) { invalidated = callback; return unsubscribe; },
            });
            vi.advanceTimersByTime(1000);
            invalidated();
            expect(actions.dispose).toHaveBeenCalledOnce();
            expect(unsubscribe).toHaveBeenCalledOnce();
            expect(vi.getTimerCount()).toBe(0);
        } finally { vi.useRealTimers(); }
    });

    it('关闭浏览器端口轮询时仍响应失效并释放上下文订阅', () => {
        vi.useFakeTimers();
        try {
            let invalidated!: () => void;
            const unsubscribe = vi.fn();
            const actions = {suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn()};
            installContentPageLifecycle(new EventTarget(), new AbortController().signal, actions, {
                isInvalid: false, onInvalidated(callback) { invalidated = callback; return unsubscribe; },
            }, undefined, false);
            expect(vi.getTimerCount()).toBe(0);
            invalidated();
            expect(actions.dispose).toHaveBeenCalledOnce();
            expect(unsubscribe).toHaveBeenCalledOnce();
        } finally { vi.useRealTimers(); }
    });

    it('后台空闲页减少上下文检查，回到前台立即核查失效', () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        try {
            const target = new EventTarget();
            const pageDocument = Object.assign(new EventTarget(), {visibilityState: 'hidden'});
            const readInvalid = vi.fn(() => false);
            const actions = {suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn()};
            installContentPageLifecycle(target, controller.signal, actions,
                {get isInvalid() { return readInvalid(); }}, pageDocument as unknown as Document);
            vi.advanceTimersByTime(60_000);
            expect(readInvalid.mock.calls.length).toBeLessThanOrEqual(12);
            expect(actions.dispose).not.toHaveBeenCalled();

            readInvalid.mockReturnValue(true);
            pageDocument.visibilityState = 'visible';
            transition(pageDocument, 'visibilitychange');
            expect(actions.dispose).toHaveBeenCalledOnce();
            expect(vi.getTimerCount()).toBe(0);
        } finally { controller.abort(); vi.useRealTimers(); }
    });

    it('往返缓存暂停所有检查，恢复前失效不重新挂载旧功能', () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        try {
            const target = new EventTarget();
            const context = {isInvalid: false};
            const actions = {suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn()};
            installContentPageLifecycle(target, controller.signal, actions, context);
            transition(target, 'pagehide', true);
            expect(vi.getTimerCount()).toBe(0);
            context.isInvalid = true;
            transition(target, 'pageshow', true);
            expect(actions.resume).not.toHaveBeenCalled();
            expect(actions.dispose).toHaveBeenCalledOnce();
            expect(vi.getTimerCount()).toBe(0);
        } finally { controller.abort(); vi.useRealTimers(); }
    });

    it('真正离开后自行释放定时器和监听，不依赖销毁回调再次中止信号', () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        try {
            const target = new EventTarget();
            const remove = vi.spyOn(target, 'removeEventListener');
            const actions = {suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn()};
            installContentPageLifecycle(target, controller.signal, actions, {isInvalid: false});
            transition(target, 'pagehide');
            expect(actions.dispose).toHaveBeenCalledOnce();
            expect(vi.getTimerCount()).toBe(0);
            expect(remove.mock.calls.map(([name]) => name)).toEqual(expect.arrayContaining(['pagehide', 'pageshow']));
            vi.advanceTimersByTime(60_000);
            expect(actions.dispose).toHaveBeenCalledOnce();
        } finally { controller.abort(); vi.useRealTimers(); }
    });

    it('上下文检查只在失效时销毁一次，并立即停止检查', () => {
        vi.useFakeTimers();
        try {
            const target = new EventTarget(), context = {isInvalid: false};
            const actions = {suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn()};
            installContentPageLifecycle(target, new AbortController().signal, actions, context);
            vi.advanceTimersByTime(1000);
            expect(actions.dispose).not.toHaveBeenCalled();
            context.isInvalid = true;
            vi.advanceTimersByTime(2000);
            transition(target, 'pagehide');
            expect(actions.dispose).toHaveBeenCalledOnce();
            expect(vi.getTimerCount()).toBe(0);
        } finally { vi.useRealTimers(); }
    });

    it('已经中止的页面不会安装上下文定时器', () => {
        vi.useFakeTimers();
        try {
            const controller = new AbortController(); controller.abort();
            installContentPageLifecycle(new EventTarget(), controller.signal,
                {suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn()}, {isInvalid: true});
            expect(vi.getTimerCount()).toBe(0);
        } finally { vi.useRealTimers(); }
    });
    it('取消离开不卸载，往返缓存暂停后可恢复，真正离开只销毁一次', () => {
        const target = new EventTarget();
        const controller = new AbortController();
        const actions = {suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn()};
        const state = installContentPageLifecycle(target, controller.signal, actions);
        expect(state.isSuspended()).toBe(false);
        transition(target, 'beforeunload');
        transition(target, 'pageshow');
        expect(actions.dispose).not.toHaveBeenCalled();
        expect(actions.suspend).not.toHaveBeenCalled();
        transition(target, 'pagehide', true);
        expect(state.isSuspended()).toBe(true);
        transition(target, 'pagehide', true);
        expect(actions.suspend).toHaveBeenCalledOnce();
        transition(target, 'pageshow');
        expect(actions.resume).not.toHaveBeenCalled();
        transition(target, 'pageshow', true);
        expect(state.isSuspended()).toBe(false);
        transition(target, 'pageshow', true);
        expect(actions.resume).toHaveBeenCalledOnce();
        transition(target, 'pagehide');
        transition(target, 'pagehide');
        transition(target, 'pageshow', true);
        expect(actions.dispose).toHaveBeenCalledOnce();
        expect(actions.resume).toHaveBeenCalledOnce();
    });

    it('宿主伪造页面离开不能卸载扩展，伪造恢复也不能绕过真正的暂停', () => {
        const target = new EventTarget();
        const actions = {suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn()};
        const state = installContentPageLifecycle(target, new AbortController().signal, actions);
        transition(target, 'pagehide', false, false);
        transition(target, 'pagehide', true, false);
        expect(actions.dispose).not.toHaveBeenCalled();
        expect(actions.suspend).not.toHaveBeenCalled();
        expect(state.isSuspended()).toBe(false);
        transition(target, 'pagehide', true);
        transition(target, 'pageshow', true, false);
        expect(actions.resume).not.toHaveBeenCalled();
        expect(state.isSuspended()).toBe(true);
        transition(target, 'pageshow', true);
        expect(actions.resume).toHaveBeenCalledOnce();
        expect(state.isSuspended()).toBe(false);
    });

    it('运行时失效后移除页面监听，不允许迟到的 pageshow 复活扩展', () => {
        const target = new EventTarget();
        const controller = new AbortController();
        const actions = {suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn()};
        installContentPageLifecycle(target, controller.signal, actions);
        transition(target, 'pagehide', true);
        controller.abort();
        transition(target, 'pageshow', true);
        transition(target, 'pagehide');
        expect(actions.resume).not.toHaveBeenCalled();
        expect(actions.dispose).not.toHaveBeenCalled();
    });
});

describe('content composition root 冷启动与暂停恢复', () => {
    let page: EventTarget;
    let invalidated: () => void;
    let context: {isInvalid: boolean; onInvalidated: (callback: () => void) => void};
    let ready: () => void;

    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        mocks.languageBundleWait = undefined;
        mocks.realComposition = false;
        mocks.config.on = true;
        mocks.config.browserDefaultTranslationFont = false;
        mocks.pageFontEnabled = false;
        mocks.config.autoTranslate = false;
        Object.assign(mocks.config, {disableFloatingBall: true, disableSelectionTranslator: true, translationProgressPanelEnabled: false, selectionTranslatorMode: 'bilingual'});
        mocks.config.alwaysTranslateDomains = [];
        mocks.fullPageActive = false;
        mocks.siteAdaptationRouteChanged.mockReset();
        mocks.restoreOriginal.mockImplementation(() => { mocks.fullPageActive = false; });
        mocks.autoTranslate.mockImplementation(() => { mocks.fullPageActive = true; });
        mocks.config.disabledExtensionDomains = [];
        mocks.config.bilingualSentenceHighlightEnabled = true;
        mocks.configReady = new Promise<void>(resolve => { ready = resolve; });
        mocks.installPageStyles.mockReturnValue(mocks.removeStyles);
        mocks.subscribeConfig.mockReturnValue(vi.fn());
        mocks.createMessageHandler.mockReturnValue(vi.fn());
        invalidated = vi.fn();
        context = {isInvalid: false, onInvalidated: callback => { invalidated = callback; }};
        page = Object.assign(new EventTarget(), {location: {href: 'https://example.com/article'}});
        vi.stubGlobal('window', page);
        vi.stubGlobal('document', Object.assign(new EventTarget(), {contentType: 'text/html', getElementById: () => null}));
        vi.stubGlobal('navigator', {});
        vi.stubGlobal('browser', {extension: {inIncognitoContext: false}, runtime: {
            sendMessage: vi.fn().mockResolvedValue(undefined),
            onMessage: {addListener: mocks.addRuntimeListener, removeListener: mocks.removeRuntimeListener},
        }});
    });

    afterEach(() => { invalidated?.(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

    it('全局字体在水合后启用并跨锚点和文章路由保留，停用与 BFCache 暂停撤样式后按原偏好恢复', async () => {
        mocks.config.browserDefaultTranslationFont = true;
        const {startContentApp} = await import('@/src/app/content/runtime');
        const starting = startContentApp(context as never); ready(); await starting;
        const state = mocks.createMessageHandler.mock.calls[0]![1] as {pageTranslationFont: {read(): boolean}};
        expect(state.pageTranslationFont.read()).toBe(true);
        Object.assign(page, {location: {href: 'https://example.com/article#contents'}});
        document.dispatchEvent(new Event('fluentread-route-change'));
        expect(state.pageTranslationFont.read()).toBe(true);
        expect(mocks.pageFontReset).not.toHaveBeenCalled();
        Object.assign(page, {location: {href: 'https://example.com/next'}});
        document.dispatchEvent(new Event('fluentread-route-change'));
        expect(state.pageTranslationFont.read()).toBe(true);
        expect(mocks.pageFontReset).not.toHaveBeenCalled();
        mocks.config.on = false;
        mocks.subscribeConfig.mock.calls[0]![0](mocks.config);
        expect(state.pageTranslationFont.read()).toBe(false);
        expect(mocks.config.browserDefaultTranslationFont).toBe(true);
        mocks.config.on = true;
        mocks.subscribeConfig.mock.calls[0]![0](mocks.config);
        await vi.waitFor(() => expect(mocks.installPageStyles).toHaveBeenCalledTimes(2));
        expect(state.pageTranslationFont.read()).toBe(true);
        transition(page, 'pagehide', true);
        expect(state.pageTranslationFont.read()).toBe(false);
        mocks.subscribeConfig.mock.calls[0]![0](mocks.config);
        expect(state.pageTranslationFont.read()).toBe(false);
        expect(mocks.config.browserDefaultTranslationFont).toBe(true);
        transition(page, 'pageshow', true);
        await vi.waitFor(() => expect(mocks.installPageStyles).toHaveBeenCalledTimes(3));
        expect(state.pageTranslationFont.read()).toBe(true);
        invalidated();
        expect(state.pageTranslationFont.read()).toBe(false);
        expect(mocks.config.browserDefaultTranslationFont).toBe(true);
        expect(mocks.pageFontDispose).toHaveBeenCalledOnce();
    });

    it('全局字体配置 true/false 即时同步，刷新重建运行时仍读取保存的偏好', async () => {
        const {startContentApp} = await import('@/src/app/content/runtime');
        const starting = startContentApp(context as never); ready(); await starting;
        const readFont = () => mocks.createMessageHandler.mock.calls.at(-1)![1].pageTranslationFont.read();
        expect(readFont()).toBe(false);
        for (const enabled of [true, false, true]) {
            mocks.config.browserDefaultTranslationFont = enabled;
            mocks.subscribeConfig.mock.calls[0]![0](mocks.config);
            expect(readFont()).toBe(enabled);
        }
        invalidated();
        expect(readFont()).toBe(false);
        expect(mocks.config.browserDefaultTranslationFont).toBe(true);
        await startContentApp(context as never);
        expect(mocks.createMessageHandler).toHaveBeenCalledTimes(2);
        expect(readFont()).toBe(true);
        expect(mocks.config.browserDefaultTranslationFont).toBe(true);
    });

    it('恢复原文后进入下一篇文章重启始终翻译，锚点和重复路由不重复触发', async () => {
        mocks.config.alwaysTranslateDomains = ['example.com'];
        const {startContentApp} = await import('@/src/app/content/runtime');
        const starting = startContentApp(context as never); ready(); await starting;
        expect(mocks.autoTranslate).toHaveBeenCalledOnce();
        mocks.fullPageActive = false;
        Object.assign(page, {location: {href: 'https://example.com/article#contents'}});
        document.dispatchEvent(new Event('fluentread-route-change'));
        expect(mocks.autoTranslate).toHaveBeenCalledOnce();
        expect(mocks.resetRouteState).not.toHaveBeenCalled();
        Object.assign(page, {location: {href: 'https://example.com/next?chapter=2'}});
        document.dispatchEvent(new Event('fluentread-route-change'));
        expect(mocks.autoTranslate).toHaveBeenCalledTimes(2);
        expect(mocks.resetRouteState).toHaveBeenCalledOnce();
        document.dispatchEvent(new Event('fluentread-route-change'));
        expect(mocks.autoTranslate).toHaveBeenCalledTimes(2);
        expect(mocks.resetRouteState).toHaveBeenCalledOnce();
    });

    it('首页进入产品页时站点正文适配使旧会话失效后自动重启，不要求手动恢复', async () => {
        Object.assign(page, {location: {href: 'https://www.producthunt.com/'}});
        mocks.config.alwaysTranslateDomains = ['producthunt.com'];
        const {startContentApp} = await import('@/src/app/content/runtime');
        const starting = startContentApp(context as never); ready(); await starting;
        expect(mocks.autoTranslate).toHaveBeenCalledOnce();
        // 真实 siteAdaptationRuntime 在命中规则列表变化时恢复原文；这里只替换该端口，
        // 检查 composition root 随后读取最新全文状态并按新页面意图继续自动翻译。
        mocks.siteAdaptationRouteChanged.mockImplementation(() => mocks.restoreOriginal());
        Object.assign(page, {location: {href: 'https://www.producthunt.com/products/reso'}});
        document.dispatchEvent(new Event('fluentread-route-change'));
        expect(mocks.restoreOriginal).toHaveBeenCalledOnce();
        expect(mocks.autoTranslate).toHaveBeenCalledTimes(2);
        expect(mocks.fullPageActive).toBe(true);
    });

    it('进入禁用页面立即清理，离开后复验名单并恢复自动翻译', async () => {
        mocks.config.alwaysTranslateDomains = ['example.com'];
        mocks.config.disabledExtensionDomains = ['blocked.test'];
        const {startContentApp} = await import('@/src/app/content/runtime');
        const starting = startContentApp(context as never); ready(); await starting;
        expect(mocks.autoTranslate).toHaveBeenCalledOnce();
        Object.assign(page, {location: {href: 'https://blocked.test/next'}});
        document.dispatchEvent(new Event('fluentread-route-change'));
        expect(mocks.restoreOriginal).toHaveBeenCalledOnce();
        expect(mocks.removeStyles).toHaveBeenCalledOnce();
        expect(mocks.setBridges).toHaveBeenLastCalledWith(document, false);
        expect(mocks.autoTranslate).toHaveBeenCalledOnce();
        mocks.fullPageActive = false;
        Object.assign(page, {location: {href: 'https://example.com/next'}});
        document.dispatchEvent(new Event('fluentread-route-change'));
        await vi.waitFor(() => expect(mocks.autoTranslate).toHaveBeenCalledTimes(2));
        expect(mocks.setBridges).toHaveBeenLastCalledWith(document, true);
        expect(mocks.installPageStyles).toHaveBeenCalledTimes(2);
    });

    it('空闲页面在扩展失效后主动清理，停止上下文检查且不再次挂载', async () => {
        vi.useFakeTimers();
        try {
            const unsubscribe = vi.fn();
            mocks.subscribeConfig.mockReturnValue(unsubscribe);
            const {startContentApp} = await import('@/src/app/content/runtime');
            const starting = startContentApp(context as never); ready(); await starting;
            context.isInvalid = true;
            vi.stubGlobal('browser', {});
            await vi.advanceTimersByTimeAsync(1000);
            expect(mocks.removeStyles).toHaveBeenCalledOnce();
            expect(mocks.restoreOriginal).toHaveBeenCalledOnce();
            expect(unsubscribe).toHaveBeenCalledOnce();
            expect(vi.getTimerCount()).toBe(0);
            transition(page, 'pageshow', true);
            expect(mocks.installPageStyles).toHaveBeenCalledOnce();
        } finally { vi.useRealTimers(); }
    });

    it.each(['text/xml', 'application/xml', 'application/rss+xml', 'image/svg+xml'])('%s 文档不等待配置，也不挂载页面功能或桥', async contentType => {
        Object.assign(document, {contentType});
        const registerInvalidation = vi.fn();
        context.onInvalidated = registerInvalidation;
        const {startContentApp} = await import('@/src/app/content/runtime');
        await startContentApp(context as never);
        expect(mocks.installPageStyles).not.toHaveBeenCalled();
        expect(mocks.setBridges).not.toHaveBeenCalled();
        expect(mocks.addRuntimeListener).not.toHaveBeenCalled();
        expect(mocks.subscribeConfig).not.toHaveBeenCalled();
        expect(registerInvalidation).not.toHaveBeenCalled();
    });

    it('XHTML 文档仍可启动网页功能', async () => {
        Object.assign(document, {contentType: 'application/xhtml+xml'});
        const {startContentApp} = await import('@/src/app/content/runtime');
        const starting = startContentApp(context as never); ready(); await starting;
        expect(mocks.installPageStyles).toHaveBeenCalledOnce();
    });

    it('纯文本页面保留现有的网页功能入口', async () => {
        Object.assign(document, {contentType: 'text/plain'});
        const {startContentApp} = await import('@/src/app/content/runtime');
        const starting = startContentApp(context as never); ready(); await starting;
        expect(mocks.installPageStyles).toHaveBeenCalledOnce();
    });

    it('启动前已经失效的扩展上下文不注册页面生命周期', async () => {
        context.isInvalid = true;
        const registerInvalidation = vi.fn();
        context.onInvalidated = registerInvalidation;
        const {startContentApp} = await import('@/src/app/content/runtime');
        ready();

        await startContentApp(context as never);

        expect(registerInvalidation).not.toHaveBeenCalled();
        expect(mocks.addRuntimeListener).not.toHaveBeenCalled();
        expect(mocks.installPageStyles).not.toHaveBeenCalled();
    });

    it('扩展重载移除 runtime 后仍完成监听、页面样式与配置订阅清理', async () => {
        const unsubscribe = vi.fn();
        mocks.subscribeConfig.mockReturnValue(unsubscribe);
        const {startContentApp} = await import('@/src/app/content/runtime');
        const starting = startContentApp(context as never); ready(); await starting;
        const listener = mocks.addRuntimeListener.mock.calls[0][0];
        vi.stubGlobal('browser', {});

        expect(() => invalidated()).not.toThrow();

        expect(mocks.removeRuntimeListener).toHaveBeenCalledWith(listener);
        expect(mocks.removeStyles).toHaveBeenCalledOnce();
        expect(mocks.restoreOriginal).toHaveBeenCalledOnce();
        expect(unsubscribe).toHaveBeenCalledOnce();
        invalidated();
        expect(mocks.removeStyles).toHaveBeenCalledOnce();
    });

    it('失效消息端口拒绝注销时仍清理页面功能和配置订阅', async () => {
        const unsubscribe = vi.fn();
        mocks.subscribeConfig.mockReturnValue(unsubscribe);
        const {startContentApp} = await import('@/src/app/content/runtime');
        const starting = startContentApp(context as never); ready(); await starting;
        mocks.removeRuntimeListener.mockImplementationOnce(() => { throw new Error('Extension context invalidated.'); });

        expect(() => invalidated()).not.toThrow();

        expect(mocks.removeStyles).toHaveBeenCalledOnce();
        expect(mocks.restoreOriginal).toHaveBeenCalledOnce();
        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it.each(['pagehide', 'invalidate', 'invalid-flag'] as const)('配置读取期间 %s 后不允许迟到初始化挂载', async reason => {
        const {startContentApp} = await import('@/src/app/content/runtime');
        const starting = startContentApp(context as never);
        if (reason === 'pagehide') transition(page, 'pagehide');
        else { context.isInvalid = true; if (reason === 'invalidate') invalidated(); }
        ready();
        await starting;
        transition(page, 'pageshow', true);
        expect(mocks.ensureLanguageBundle).not.toHaveBeenCalled();
        expect(mocks.installPageStyles).not.toHaveBeenCalled();
        expect(mocks.addRuntimeListener).not.toHaveBeenCalled();
        expect(mocks.subscribeConfig).not.toHaveBeenCalled();
    });

    it('有效页面配置就绪后仍等待界面语言包再挂载，完成后只初始化一次', async () => {
        let bundleReady!: (loaded: boolean) => void;
        mocks.languageBundleWait = new Promise(resolve => { bundleReady = resolve; });
        const {startContentApp} = await import('@/src/app/content/runtime');
        const starting = startContentApp(context as never);
        expect(mocks.ensureLanguageBundle).not.toHaveBeenCalled();
        ready();
        await vi.waitFor(() => expect(mocks.ensureLanguageBundle).toHaveBeenCalledOnce());
        expect(mocks.installPageStyles).not.toHaveBeenCalled();
        expect(mocks.subscribeConfig).not.toHaveBeenCalled();
        bundleReady(true);
        await starting;
        expect(mocks.installPageStyles).toHaveBeenCalledOnce();
        expect(mocks.subscribeConfig).toHaveBeenCalledOnce();
    });

    it.each(['pagehide', 'invalidate'] as const)('语言包已开始等待时 %s，迟到资源仍不能挂载页面', async reason => {
        let bundleReady!: (loaded: boolean) => void;
        mocks.languageBundleWait = new Promise(resolve => { bundleReady = resolve; });
        const {startContentApp} = await import('@/src/app/content/runtime');
        const starting = startContentApp(context as never);
        ready();
        await vi.waitFor(() => expect(mocks.ensureLanguageBundle).toHaveBeenCalledOnce());
        if (reason === 'pagehide') transition(page, 'pagehide');
        else { context.isInvalid = true; invalidated(); }
        bundleReady(true);
        await starting;
        expect(mocks.installPageStyles).not.toHaveBeenCalled();
        expect(mocks.addRuntimeListener).not.toHaveBeenCalled();
        expect(mocks.subscribeConfig).not.toHaveBeenCalled();
    });

    it('配置读取期间进往返缓存，配置就绪后继续保持暂停直到真实恢复', async () => {
        const {startContentApp} = await import('@/src/app/content/runtime');
        const starting = startContentApp(context as never);
        transition(page, 'pagehide', true);
        ready();
        await starting;
        expect(mocks.ensureLanguageBundle).toHaveBeenCalledOnce();
        expect(mocks.installPageStyles).not.toHaveBeenCalled();
        const state = mocks.createMessageHandler.mock.calls[0][1];
        expect(state.isPageSuspended()).toBe(true);
        transition(page, 'pageshow', true, false);
        expect(mocks.installPageStyles).not.toHaveBeenCalled();
        transition(page, 'pageshow', true);
        await vi.waitFor(() => expect(mocks.installPageStyles).toHaveBeenCalledOnce());
        expect(state.isPageSuspended()).toBe(false);
        invalidated();
        transition(page, 'pageshow', true);
        expect(mocks.removeStyles).toHaveBeenCalledOnce();
        expect(mocks.installPageStyles).toHaveBeenCalledOnce();
    });

    it('取消离开以及伪造离开都保留功能；暂停时配置回声不能写入高亮属性', async () => {
        const {startContentApp} = await import('@/src/app/content/runtime');
        const starting = startContentApp(context as never);
        transition(page, 'beforeunload');
        transition(page, 'pagehide', false, false);
        ready();
        await starting;
        expect(mocks.installPageStyles).toHaveBeenCalledOnce();
        transition(page, 'pagehide', true);
        const onConfig = mocks.subscribeConfig.mock.calls[0][0];
        onConfig(mocks.config);
        expect(mocks.syncHighlight).toHaveBeenLastCalledWith(document, false, undefined, undefined);
        expect(mocks.removeStyles).toHaveBeenCalledOnce();
        expect(mocks.installPageStyles).toHaveBeenCalledOnce();
    });

    it('站点禁用时其他设置变更不能重新给宿主页面添加高亮属性', async () => {
        mocks.config.disabledExtensionDomains = ['example.com'];
        const {startContentApp} = await import('@/src/app/content/runtime');
        const starting = startContentApp(context as never);
        ready();
        await starting;
        mocks.subscribeConfig.mock.calls[0][0](mocks.config);
        expect(mocks.syncHighlight).toHaveBeenLastCalledWith(document, false, undefined, undefined);
        expect(mocks.installPageStyles).not.toHaveBeenCalled();
    });

    it('宿主伪造相同 URL 的路由通知不能反复失效正在执行的翻译', async () => {
        const {startContentApp} = await import('@/src/app/content/runtime');
        const starting = startContentApp(context as never);
        ready();
        await starting;
        document.dispatchEvent(new Event('fluentread-route-change'));
        expect(mocks.resetRouteState).not.toHaveBeenCalled();
        window.location.href = 'https://example.com/next-article';
        document.dispatchEvent(new Event('fluentread-route-change'));
        document.dispatchEvent(new Event('fluentread-route-change'));
        expect(mocks.resetRouteState).toHaveBeenCalledOnce();
    });
});

/** 浏览器缺失端口只提供 DOM/CSS Highlight/Shadow UI 语义；入口、消息与悬浮控制器均运行生产实现。 */
describe('content composition root 的真实页面入口联动', () => {
    let dispose = () => {};
    let page: Window;
    let doc: Document;
    let frames: Map<number, FrameRequestCallback>;
    let paints: Map<string, Set<Range>>;
    let send: ReturnType<typeof vi.fn>;
    let listener: (message: unknown, sender: unknown, reply: (response: any) => void) => boolean;
    const settle = async () => {
        for (let i = 0; i < 80; i++) {
            const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0));
            await Promise.resolve();
        }
    };
    const message = async (payload: Record<string, unknown>) => {
        let response: any;
        expect(listener(payload, {id: 'composition-extension'}, value => {response = value;})).toBe(true);
        await settle();
        return response;
    };
    const key = (target: EventTarget, type: string, fields: Record<string, unknown>) => {
        const event = new (page as unknown as {Event: typeof Event}).Event(type, {bubbles: true, cancelable: true});
        Object.assign(event, {key: '', code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, repeat: false, ...fields});
        Object.defineProperty(event, 'isTrusted', {value: true});
        target.dispatchEvent(event);
        return event;
    };
    beforeEach(async () => {
        vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); mocks.realComposition = true;
        mocks.languageBundleWait = undefined;
        Object.assign(mocks.config, new Config());
        Object.assign(mocks.config, {on: true, autoTranslate: false, alwaysTranslateDomains: [], disabledExtensionDomains: [],
            disableFloatingBall: true, disableSelectionTranslator: true,
            translationProgressPanelEnabled: false,
            hotkey: 'Alt', mouseHoverTranslationDelay: 0, animations: false});
        mocks.configReady = Promise.resolve();
        mocks.installPageStyles.mockReturnValue(mocks.removeStyles); mocks.subscribeConfig.mockReturnValue(vi.fn());
        const parsed = parseHTML('<html><head></head><body><article><p>The extraordinary algorithm preserves original paragraphs and inline links.</p></article><textarea>Hello world</textarea></body></html>');
        doc = parsed.document as unknown as Document;
        frames = new Map(); paints = new Map(); let frameId = 0;
        const href = {href: 'https://example.com/article'};
        const Observer = class {observe() {} disconnect() {}};
        page = new Proxy(parsed.window, {get(target, prop) {
            if (prop === 'location') return href;
            if (prop === 'CSS') return {highlights: paints};
            if (prop === 'Highlight') return Set;
            if (prop === 'MutationObserver') return Observer;
            if (prop === 'innerWidth') return 1000;
            if (prop === 'innerHeight') return 600;
            if (prop === 'getComputedStyle') return (element: HTMLElement) => ({display: element.style.display || 'block', visibility: 'visible', color: 'rgb(0,0,0)'});
            if (prop === 'requestAnimationFrame') return (callback: FrameRequestCallback) => {frames.set(++frameId, callback); return frameId;};
            if (prop === 'cancelAnimationFrame') return (id: number) => frames.delete(id);
            return Reflect.get(target, prop);
        }}) as unknown as Window;
        Object.defineProperty(doc, 'defaultView', {value: page});
        Object.defineProperty(doc, 'readyState', {value: 'complete'});
        Object.defineProperty(doc, 'contentType', {value: 'text/html'});
        Object.defineProperty(doc, 'activeElement', {configurable: true, value: doc.querySelector('textarea')});
        // linkedom 没有布局、原生 CSS Highlight Range 或 signal 自动移除；在浏览器边界补齐这些确定性语义。
        for (const target of [doc, page]) {
            const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
            target.addEventListener = ((type: string, handler: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean) => {
                const signal = typeof options === 'object' ? options.signal : undefined;
                if (signal?.aborted) return;
                if (signal) setMaxListeners(0, signal);
                add(type, handler, options);
                signal?.addEventListener('abort', () => remove(type, handler, options), {once: true});
            }) as typeof target.addEventListener;
        }
        for (const element of doc.querySelectorAll('*')) {
            element.getBoundingClientRect = () => ({left: 10, right: 400, top: 20, bottom: 50, width: 390, height: 30, x: 10, y: 20, toJSON() {return {};}});
        }
        doc.createRange = () => {
            let text: Text, start = 0, end = 0;
            return {setStart(node: Text, offset: number) {text = node; start = offset;}, setEnd(_node: Text, offset: number) {end = offset;},
                toString: () => text.data.slice(start, end), getBoundingClientRect: () => ({top: 20, bottom: 50})} as unknown as Range;
        };
        vi.stubGlobal('window', page); vi.stubGlobal('document', doc); vi.stubGlobal('navigator', {platform: 'Linux'});
        vi.stubGlobal('Event', parsed.window.Event); vi.stubGlobal('HTMLElement', parsed.window.HTMLElement); vi.stubGlobal('Element', parsed.window.Element);
        send = vi.fn(async () => ({success: true}));
        vi.stubGlobal('browser', {extension: {inIncognitoContext: false}, runtime: {id: 'composition-extension', sendMessage: send,
            onMessage: {addListener: mocks.addRuntimeListener, removeListener: mocks.removeRuntimeListener}}});
        mocks.createUi.mockImplementation(async (_ctx, options) => {
            const host = doc.createElement('div'), container = doc.createElement('div'); host.append(container);
            const ui = {shadowHost: host, mounted: undefined as HTMLElement | undefined,
                mount() {doc.body.append(host); ui.mounted = options.onMount(container);}, remove() {host.remove();}};
            return ui;
        });
        const {startContentApp} = await import('@/src/app/content/runtime');
        await startContentApp({isInvalid: false, onInvalidated(callback: () => void) {dispose = callback;}} as never);
        listener = mocks.addRuntimeListener.mock.calls[0][0];
    });
    afterEach(() => {dispose(); mocks.realComposition = false; vi.useRealTimers(); vi.unstubAllGlobals();});

    it('全局字体配置更新真实样式并发通知，站点停用清除样式后重新启用恢复偏好，旧单页写入无效', async () => {
        const changed = vi.fn(); doc.addEventListener('fluentread-page-translation-font-changed', changed);
        const state = await message({type: 'getPageTranslationFontState'});
        expect(state).toMatchObject({status: 'success', browserDefault: false, pageUrl: 'https://example.com/article'});
        mocks.config.browserDefaultTranslationFont = true;
        mocks.subscribeConfig.mock.calls[0][0](mocks.config);
        expect(doc.getElementById('fluent-read-page-translation-font')?.textContent).toContain('font-family: initial');
        expect(changed).toHaveBeenCalledOnce();
        expect(await message({type: 'getPageTranslationFontState'})).toMatchObject({status: 'success', browserDefault: true});
        const obsoleteReply = vi.fn();
        expect(listener({type: 'setPageTranslationFont', browserDefault: false, documentToken: state.documentToken, pageUrl: state.pageUrl}, {id: 'composition-extension'}, obsoleteReply)).toBe(false);
        expect(obsoleteReply).not.toHaveBeenCalled();
        expect(mocks.config.browserDefaultTranslationFont).toBe(true);
        mocks.config.browserDefaultTranslationFont = false;
        mocks.subscribeConfig.mock.calls[0][0](mocks.config);
        expect(doc.getElementById('fluent-read-page-translation-font')).toBeNull();
        expect(await message({type: 'getPageTranslationFontState'})).toMatchObject({status: 'success', browserDefault: false});
        mocks.config.browserDefaultTranslationFont = true;
        mocks.subscribeConfig.mock.calls[0][0](mocks.config);
        expect(await message({type: 'updateSiteExtensionDisabled', isDisabled: true})).toEqual({status: 'success'});
        expect(doc.getElementById('fluent-read-page-translation-font')).toBeNull(); expect(changed).toHaveBeenCalledTimes(4);
        expect(mocks.config.browserDefaultTranslationFont).toBe(true);
        expect(await message({type: 'toggleFloatingBall', isEnabled: true})).toEqual({status: 'disabled'});
        expect(await message({type: 'getPageTranslationFontState'})).toEqual({status: 'disabled'});
        expect(await message({type: 'updateSiteExtensionDisabled', isDisabled: false})).toEqual({status: 'success'});
        expect(doc.getElementById('fluent-read-page-translation-font')?.textContent).toContain('font-family: initial');
        expect(mocks.config.browserDefaultTranslationFont).toBe(true);
        expect(changed).toHaveBeenCalledTimes(5);
    });

    it('真实悬浮快捷键使用当前页面许可，站点停用后不再触发翻译', async () => {
        Object.defineProperty(doc, 'activeElement', {configurable: true, value: doc.body});
        const features = await import('@/src/app/content/features');
        key(doc.body, 'mouseover', {clientX: 30, clientY: 40});
        key(page, 'keydown', {key: 'Alt', code: 'AltLeft', altKey: true});
        key(page, 'keyup', {key: 'Alt', code: 'AltLeft'});
        expect(features.handleTranslation).toHaveBeenCalledWith(30, 40, {inputSource: 'mouse-shortcut'});
        await message({type: 'updateSiteExtensionDisabled', isDisabled: true});
        key(page, 'keydown', {key: 'Alt', code: 'AltLeft', altKey: true}); key(page, 'keyup', {key: 'Alt', code: 'AltLeft'});
        vi.advanceTimersByTime(180); await settle();
        expect(features.handleTranslation).toHaveBeenCalledOnce();
    });
});
