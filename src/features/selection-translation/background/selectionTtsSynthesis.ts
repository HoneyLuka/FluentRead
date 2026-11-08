/**
 * @file src/features/selection-translation/background/selectionTtsSynthesis.ts
 * 文件职责：把划词朗读请求转交给在线 Edge TTS 合成端口。
 * 主要内容：保留可注入的合成器工厂形状，供 handler 与单元测试复用。
 * 模块边界：只决定合成来源，不播放音频；播放和停止仍由 selectionTts handler 与 Offscreen 负责。
 */

import type {SelectionTtsAudio} from './ttsHandler';

export interface SelectionTtsSynthesisDependencies {
    readonly getOnlineVoices: () => unknown;
    readonly synthesizeOnline: (
        text: string,
        language: string,
        preferredVoices: unknown,
        signal?: AbortSignal,
    ) => Promise<SelectionTtsAudio>;
}

/** 创建可注入的策略合成器，便于单元测试。 */
export function createSelectionTtsSynthesizer(
    dependencies: SelectionTtsSynthesisDependencies,
) {
    return async function synthesizeSelectionTts(
        text: string,
        language: string,
        _preferredVoices: unknown,
        signal?: AbortSignal,
    ): Promise<SelectionTtsAudio> {
        signal?.throwIfAborted();
        return dependencies.synthesizeOnline(text, language, dependencies.getOnlineVoices(), signal);
    };
}
