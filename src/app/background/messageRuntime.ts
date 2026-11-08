/**
 * @file src/app/background/messageRuntime.ts
 * 文件职责：构建并安装后台消息总运行时，把配置、翻译、划词词典与朗读、扩展面板导航和标签页状态等公开 handler 连接到 browser.runtime。
 * 主要内容：为划词朗读注入在线合成器并绑定能力门控的 offscreen 传输；为配置与缓存注入共享网页通知端口；装配翻译、TTS、下载等类型化 router 与生命周期。
 * 模块边界：本文件是 composition root，只决定依赖装配和监听生命周期，不实现各 feature 的业务算法、provider 协议或存储事务；具体实现均来自 features、services、providers 与 platform。
 */
import {getFreeTranslationWeightSnapshot, createProviderTestRuntimeHandlers} from './providerRuntime';
import {createChatGPTPlanHandler} from './chatgptPlanRuntime';
import {config, configReady} from '@/src/services/config/store';
import {lookupWord} from '@/src/features/selection-translation/services/wordDictionary';
import {createSelectionPageZoomBrowserPort, createSelectionPageZoomHandler} from '@/src/features/selection-translation/background/pageZoomHandler';
import {synthesizeEdgeTts} from '@/src/features/selection-translation/services/edgeTts';
import {clearTranslationCache, getTranslationCacheStats, translateWithCache} from '@/src/app/translation/runtime';
import {serializeTranslationError} from '@/src/services/translation/errors';
import {createBackgroundMessageRouter, createBackgroundRuntimeMessageListener, type BackgroundMessageHandler} from '@/src/services/messaging/backgroundRouter';
import {createTranslationCacheHandlers, createTranslationCacheInvalidationBroadcaster} from './handlers/translationCache';
import {type ConfigPersistenceContext} from './handlers/configPersistence';
import {
    createFullPageTranslationStateHandlers, createQqMailFrameBackgroundHandlers,
    type FullPageBackgroundContext, type QQMailFrameBackgroundContext,
} from './handlers/fullPageTranslationState';
import {createNeteaseMailFrameBackgroundHandlers, type NeteaseMailFrameBackgroundContext} from '@/src/features/full-page-translation/background/neteaseMailFrameHandlers';
import {createFreeTranslationWeightsHandler} from './handlers/freeTranslationWeights';
import {createPopupNavigationHandlers, type PopupContext} from './popupNavigation';
import {createDownloadProgressHandler, createDownloadProgressQueryHandler} from './handlers/downloadProgress';
import {createTranslationCancelHandler, createTranslationRequestFallback, createTranslationRequestRegistry} from './handlers/translation';
import {createSelectionTtsBackgroundHandlers, type SelectionTtsContext} from './handlers/selectionTts';
import {createSelectionWordLookupHandler} from './handlers/selectionWordLookup';
import {isBrowserTabId, type TabTranslationStateStore} from './tabTranslationState';
import {browserCapabilities, type BrowserCapabilities} from '@/src/platform/browser/capabilities';
import {selectionTtsOffscreenAdapter} from '@/src/features/selection-translation/background/offscreenAdapter';
import {createCapabilityGatedSelectionTtsTransport} from './capabilityRegistry';
import {createConfigBackgroundHandlers} from './configMessageHandlers';
import {installBrowserConfigStorageBroadcast, installBrowserTabBroadcastRuntime} from './configStorageRuntime';
import {createSelectionTtsSynthesizer} from '@/src/features/selection-translation/background/selectionTtsSynthesis';
import {createEmbeddedFrameBackgroundHandlers, type EmbeddedFrameBackgroundContext} from '@/src/features/full-page-translation/background/embeddedFrameHandlers';
type BackgroundRuntimeContext = QQMailFrameBackgroundContext & NeteaseMailFrameBackgroundContext
    & EmbeddedFrameBackgroundContext & ConfigPersistenceContext & SelectionTtsContext
    & FullPageBackgroundContext & PopupContext;
export interface BackgroundMessageRuntimeOptions {
    tabTranslationStates: TabTranslationStateStore;
    onFullPageStateChanged(tabId: number): void;
    capabilities?: BrowserCapabilities;
}
export function installBackgroundMessageRuntime(options: BackgroundMessageRuntimeOptions): void {
    const capabilities = options.capabilities ?? browserCapabilities;
    const tabBroadcast = installBrowserTabBroadcastRuntime(capabilities.browser);
    const translationRequestRegistry = createTranslationRequestRegistry();
    const selectionTtsTransport = createCapabilityGatedSelectionTtsTransport(capabilities, selectionTtsOffscreenAdapter);
    const selectionPageZoom = createSelectionPageZoomBrowserPort(browser.tabs);
    const selectionTtsSynthesizer = createSelectionTtsSynthesizer({
        getOnlineVoices: () => config.selectionTtsVoices,
        synthesizeOnline: synthesizeEdgeTts,
    });
    const handlers: Array<BackgroundMessageHandler<BackgroundRuntimeContext>> = [
        createChatGPTPlanHandler(),
        createTranslationCancelHandler(translationRequestRegistry),
        ...createQqMailFrameBackgroundHandlers({sendTabMessage: (tabId, message, options) => browser.tabs.sendMessage(tabId, message, options)}),
        ...createEmbeddedFrameBackgroundHandlers({sendTabMessage: (tabId, message, options) => browser.tabs.sendMessage(tabId, message, options)}),
        ...createNeteaseMailFrameBackgroundHandlers({sendTabMessage: (tabId, message, options) => browser.tabs.sendMessage(tabId, message, options)}),
        ...createTranslationCacheHandlers(clearTranslationCache, getTranslationCacheStats, createTranslationCacheInvalidationBroadcaster({
            ...tabBroadcast,
            warn: (message, error) => console.warn(message, error),
        })),
        createFreeTranslationWeightsHandler({
            ready: configReady,
            getSnapshot: getFreeTranslationWeightSnapshot,
            isOptionsUrl: (url) => url.startsWith(browser.runtime.getURL('/options.html')),
        }),
        ...createConfigBackgroundHandlers<BackgroundRuntimeContext>(tabBroadcast.registerContentReceiver),
        ...createProviderTestRuntimeHandlers(),
        ...createPopupNavigationHandlers(),
        ...createFullPageTranslationStateHandlers({
            stateStore: options.tabTranslationStates,
            isTabId: isBrowserTabId,
            onStateChanged: options.onFullPageStateChanged,
        }),
        createSelectionWordLookupHandler({
            lookupWord: (word) => lookupWord(word, config.selectionDictionarySource),
            getDefaultTargetLanguage: () => config.to,
            translate: (request) => translateWithCache({...request, serviceOverride: config.selectionTranslationService || config.service}),
            warn: (message, error) => console.warn(message, error),
        }),
        createSelectionPageZoomHandler(selectionPageZoom.getZoom),
        ...createSelectionTtsBackgroundHandlers({
            playbackStateSender: {runtimeId: browser.runtime.id, url: browser.runtime.getURL('/offscreen.html')},
            getPreferredVoices: () => config.selectionTtsVoices,
            synthesize: selectionTtsSynthesizer,
            fetchPageAudio: selectionTtsOffscreenAdapter.fetchPageAudio,
            playWithOffscreen: selectionTtsTransport.play,
            stopWithOffscreen: selectionTtsTransport.stop,
            seekWithOffscreen: selectionTtsOffscreenAdapter.seek,
            offscreenPlaybackEnabled: capabilities.selectionTtsExtensionPlayback,
            sendTabMessage: (tabId, message, options) => browser.tabs.sendMessage(tabId, message, options),
            warn: (message, error) => console.warn(message, error),
        }),
        createDownloadProgressHandler({runtimeId: browser.runtime.id, offscreenUrl: browser.runtime.getURL('/offscreen.html'), storage: browser.storage.local}), createDownloadProgressQueryHandler({runtimeId: browser.runtime.id, storage: browser.storage.local}),
    ];
    const router = createBackgroundMessageRouter(handlers,
        createTranslationRequestFallback({
            translate: translateWithCache,
            serializeError: serializeTranslationError,
            requestRegistry: translationRequestRegistry,
        }),
    );
    browser.runtime.onMessage.addListener(createBackgroundRuntimeMessageListener(router, (sender) => ({sender}) as BackgroundRuntimeContext));
    selectionPageZoom.installZoomChangeListener();
    installBrowserConfigStorageBroadcast(tabBroadcast);
}
