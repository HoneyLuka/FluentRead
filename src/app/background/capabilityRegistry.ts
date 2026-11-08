/**
 * @file src/app/background/capabilityRegistry.ts
 * 文件职责：把浏览器能力探测结果转化为划词朗读传输的可用集合，使组合根只注册当前宿主真正支持的能力。
 * 主要内容：按 BrowserCapabilities 为 Selection TTS 返回扩展 DOM 播放传输或页面播放后备实现，保留本地 AbortSignal 参数。
 * 模块边界：本文件只做能力门控与依赖选择，不探测浏览器品牌、不实现音频播放；具体业务由 feature 工厂和 platform capability 模块承担。
 */
import type {BrowserCapabilities} from '@/src/platform/browser/capabilities';

export function createCapabilityGatedSelectionTtsTransport<TRequest, TRoute>(
    capabilities: BrowserCapabilities,
    transport: {
        readonly play: (request: TRequest, signal?: AbortSignal) => Promise<void>;
        readonly stop: (route: TRoute) => Promise<void>;
    },
): {
    readonly play: (request: TRequest, signal?: AbortSignal) => Promise<void>;
    readonly stop: (route: TRoute) => Promise<void>;
} {
    if (capabilities.selectionTtsExtensionPlayback) return transport;
    return {
        // handler 在 page-only 模式下不会调用 play；保留签名避免分裂协议。
        play: transport.play,
        stop: async () => undefined,
    };
}
