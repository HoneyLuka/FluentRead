/**
 * @file src/app/offscreen/runtime.ts
 * 文件职责：作为 Chrome Offscreen 与 Firefox 后台 iframe 共用 DOM 页面的组合根，创建独占 TTS 播放器并安装一次 runtime 消息监听，把浏览器资源适配给各离屏用例。
 * 主要内容：将 base64 音频解码为 Uint8Array，注入 Audio、Blob URL 创建/释放和带 frame/page 路由的状态回传，向播放控制入口注入扩展 ID 校验，组合 Chrome Translation 依赖并注册 message listener。
 * 模块边界：本文件只负责 Web API 资源与用例装配，不解析业务消息、不实现翻译算法，也不创建 Offscreen document；两种浏览器容器的文档生命周期均由 platform/offscreen client 和 WXT 入口管理。
 */
import {createOffscreenMessageListener} from './messageRouter';
import {parseSelectionTtsRoute} from '@/src/features/selection-translation/protocol';
import {createSelectionTtsPlayer} from './ttsPlayback';
import {disposeChromeTranslationModels, translateWithChromeApi, type ChromeTranslationEnvironment} from './translation';

function decodeAudioBase64(audioBase64: string): Uint8Array {
    const binary = atob(audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

/** 组装 Offscreen 的实验 API、Audio/Blob 浏览器能力。 */
export function startOffscreenApp(): void {
    const ttsPlayer = createSelectionTtsPlayer({
        createAudio: () => new Audio(),
        decodeBase64: decodeAudioBase64,
        createObjectUrl: (bytes, contentType) => URL.createObjectURL(new Blob([bytes], {type: contentType})),
        revokeObjectUrl: (url) => URL.revokeObjectURL(url),
        notifyProgress: (request, progress, position) => {
            void chrome.runtime.sendMessage({type: 'selectionTtsPlaybackState', ...parseSelectionTtsRoute(request), state: 'progress', progress, position}, () => {void chrome.runtime.lastError;});
        },
        notify: (request, state, error) => {
            void chrome.runtime.sendMessage({
                type: 'selectionTtsPlaybackState',
                ...parseSelectionTtsRoute(request),
                state,
                error: error instanceof Error ? error.message : error ? String(error) : undefined,
            }, () => {
                // Firefox 的 chrome 命名空间只提供 callback；两种容器共用此通知路径。
                void chrome.runtime.lastError;
            });
        },
    });
    const listener = createOffscreenMessageListener({
        runtimeId: chrome.runtime.id,
        translate: (data, signal) => translateWithChromeApi(data, self as ChromeTranslationEnvironment, signal),
        ttsPlayer,
    });

    chrome.runtime.onMessage.addListener(listener);
    window.addEventListener('pagehide', () => {
        ttsPlayer.dispose();
        disposeChromeTranslationModels(self as ChromeTranslationEnvironment);
    }, {once: true});
}
