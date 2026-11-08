/**
 * @file src/app/offscreen/messageRouter.ts
 * 文件职责：解析并分派发送到扩展自有 DOM 页面的可信运行时消息，为 Chrome 内置翻译与划词 TTS 播放提供统一响应纪律。
 * 主要内容：提供 ready 与 TTS 一次性许可握手，在播放器前拒绝失效 PLAY，校验 TTS 播放控制来自同扩展且不属于网页 tab，以共用的可取消请求表管理取消与单次回复；Chrome 翻译请求按 requestId 可取消并序列化待准备语言对与模型不可用错误码。
 * 模块边界：路由器不创建 Audio/Worker、不调用 browser.offscreen，也不实现翻译算法；资源实例由 offscreen runtime 构造，具体能力来自 translation、ttsPlayback 和 feature services。
 */
import {isChromePreparationRequiredError} from './translation';
import {
    OFFSCREEN_CANCEL_CHROME_TRANSLATION_MESSAGE_TYPE,
    OFFSCREEN_READY_MESSAGE_TYPE,
} from '@/src/platform/offscreen/client';
import {createSelectionTtsPlaybackAdmission} from './ttsPlaybackAdmission';

export type OffscreenSendResponse = (response: unknown) => void;

export interface OffscreenMessageDependencies {
    /** 生产组合根注入自身扩展 ID，TTS 播放控制仅接受同扩展且无 tab 的发送方。 */
    readonly runtimeId?: string;
    readonly translate: (data: unknown, signal: AbortSignal) => Promise<string>;
    readonly ttsPlayer: import('./ttsPlayback').SelectionTtsPlayer;
}

type OffscreenMessageListener = (
    message: unknown,
    sender: unknown,
    sendResponse: OffscreenSendResponse,
) => boolean;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredRequestId(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError('Offscreen requestId 必须是非空字符串');
    if (!REQUEST_ID_PATTERN.test(value)) throw new TypeError('Offscreen requestId 格式无效');
    return value;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function chromeTranslationErrorResponse(error: unknown): Record<string, unknown> {
    const response: Record<string, unknown> = {success: false, error: errorMessage(error)};
    if (isChromePreparationRequiredError(error)) {
        response.errorCode = error.code;
        response.errorName = error.name;
        response.sourceLanguage = error.sourceLanguage;
        response.targetLanguage = error.targetLanguage;
    } else if (error instanceof Error && error.name === 'ChromeModelUnavailableError') {
        response.errorCode = 'model-unavailable';
        response.errorName = error.name;
    }
    return response;
}

function respondWith<T>(
    operation: () => Promise<T>,
    sendResponse: OffscreenSendResponse,
    shape: (result: T) => unknown,
): void {
    void Promise.resolve()
        .then(operation)
        .then((result) => sendResponse(shape(result)))
        .catch((error) => sendResponse({success: false, error: errorMessage(error)}));
}

/**
 * 在请求表中登记可取消操作：取消、成功与失败只回复一次，结束时只释放自己持有的槽位。
 * 取消后跳过迟到结果与错误的序列化；shape 抛出的结果校验错误与操作失败使用同一 failure 序列化。
 */
function runCancellableRequest<T>(
    active: Map<string, AbortController>,
    requestId: string,
    sendResponse: OffscreenSendResponse,
    cancelledError: string,
    operation: (signal: AbortSignal) => Promise<T>,
    shape: (result: T) => unknown,
    failure: (error: unknown) => unknown,
): void {
    const controller = new AbortController();
    active.set(requestId, controller);
    let settled = false;
    const finish = (response: unknown) => {
        if (settled) return;
        settled = true;
        controller.signal.removeEventListener('abort', handleAbort);
        if (active.get(requestId) === controller) active.delete(requestId);
        sendResponse(response);
    };
    const handleAbort = () => finish({success: false, cancelled: true, requestId, error: cancelledError});
    controller.signal.addEventListener('abort', handleAbort, {once: true});
    void Promise.resolve()
        .then(() => operation(controller.signal))
        .then((result) => {if (!settled) finish(shape(result));}, (error) => {if (!settled) finish(failure(error));})
        .catch((error) => {if (!settled) finish(failure(error));});
}

/** 校验 requestId 后中止在途请求；未登记时直接回复未取消。 */
function cancelRequest(
    active: Map<string, AbortController>,
    message: Record<string, unknown>,
    sendResponse: OffscreenSendResponse,
): void {
    try {
        const requestId = requiredRequestId(message.requestId);
        const controller = active.get(requestId);
        if (controller) controller.abort();
        sendResponse({success: true, cancelled: Boolean(controller), requestId});
    } catch (error) {
        sendResponse({success: false, error: errorMessage(error)});
    }
}

/** 静态路由 Offscreen 消息；未知或非对象消息不会占用其他 runtime listener。 */
export function createOffscreenMessageListener(dependencies: OffscreenMessageDependencies): OffscreenMessageListener {
    const ttsAdmission = createSelectionTtsPlaybackAdmission();
    const activeChromeTranslations = new Map<string, AbortController>();

    return (message, sender, sendResponse) => {
        if (!isRecord(message) || typeof message.type !== 'string') return false;
        if (message.target !== 'offscreen') return false;
        if (dependencies.runtimeId !== undefined
            && ['READ_SELECTION_TTS_REVISION', 'RESERVE_SELECTION_TTS', 'PLAY_SELECTION_TTS', 'STOP_SELECTION_TTS', 'SEEK_SELECTION_TTS'].includes(message.type)
            && (!isRecord(sender) || sender.id !== dependencies.runtimeId || sender.tab !== undefined)) {
            sendResponse({success: false, error: 'TTS 播放控制发送方无效'});
            return true;
        }

        switch (message.type) {
            case OFFSCREEN_READY_MESSAGE_TYPE:
                sendResponse({success: true, ready: true});
                return true;
            case 'READ_SELECTION_TTS_REVISION':
                respondWith(async () => ttsAdmission.read(), sendResponse, (snapshot) => ({success: true, ...(snapshot as object)}));
                return true;
            case 'RESERVE_SELECTION_TTS':
                respondWith(async () => ttsAdmission.reserve(message), sendResponse, (playbackToken) =>
                    playbackToken === undefined ? {success: false, conflict: true} : {success: true, playbackToken});
                return true;
            case 'PLAY_SELECTION_TTS':
                respondWith(async () => {
                    // 消费许可与进入真实播放器连续执行；拒绝旧 PLAY 时尚未创建/停止 Audio。
                    if (!ttsAdmission.consume(message)) {
                        return {success: false, error: 'TTS 播放许可已失效',
                            errorCode: 'selection-tts-permit-invalid', receiverId: ttsAdmission.read().receiverId};
                    }
                    await dependencies.ttsPlayer.play(message);
                    return {success: true};
                }, sendResponse, (response) => response);
                return true;
            case 'STOP_SELECTION_TTS':
                respondWith(async () => {
                    ttsAdmission.stop(message);
                    return dependencies.ttsPlayer.stop(message);
                }, sendResponse, () => ({success: true}));
                return true;
            case 'SEEK_SELECTION_TTS':
                respondWith(async () => dependencies.ttsPlayer.seek(message), sendResponse, (seeked) => ({success: true, seeked}));
                return true;
            case 'CHROME_TRANSLATE_OFFSCREEN': {
                let requestId: string;
                try {
                    requestId = requiredRequestId(message.requestId);
                    if (activeChromeTranslations.has(requestId)) {
                        throw new Error('Offscreen Chrome 翻译 requestId 正在执行');
                    }
                } catch (error) {
                    sendResponse({success: false, error: errorMessage(error)});
                    return true;
                }

                runCancellableRequest(activeChromeTranslations, requestId, sendResponse, 'Chrome 翻译请求已取消',
                    (signal) => dependencies.translate(message.data, signal),
                    (result) => {
                        if (typeof result !== 'string') throw new Error('Chrome 翻译结果无效');
                        return {success: true, result, requestId};
                    },
                    (error) => ({...chromeTranslationErrorResponse(error), requestId}));
                return true;
            }
            case OFFSCREEN_CANCEL_CHROME_TRANSLATION_MESSAGE_TYPE:
                cancelRequest(activeChromeTranslations, message, sendResponse);
                return true;
            default:
                return false;
        }
    };
}
