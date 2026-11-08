import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createOffscreenMessageListener} from '@/src/app/offscreen/messageRouter';
import {createSelectionTtsPlayer, type SelectionAudioPort} from '@/src/app/offscreen/ttsPlayback';
import {createBackgroundMessageRouter, type BackgroundMessageHandler} from '@/src/services/messaging/backgroundRouter';
import {createSelectionTtsBackgroundHandlers, type SelectionTtsContext} from '@/src/features/selection-translation/background/ttsHandler';
import {createSelectionTtsSynthesizer} from '@/src/features/selection-translation/background/selectionTtsSynthesis';
import {createSelectionTtsContentController} from '@/src/features/selection-translation/content/selectionTtsContentController';
import {createSelectionTtsOffscreenAdapter} from '@/src/features/selection-translation/background/offscreenAdapter';
import {setRuntimeFetch} from '@/src/platform/http/runtime';
import {type OffscreenClient} from '@/src/platform/offscreen/client';

const send = vi.fn();
const sendIfPresent = vi.fn();
const client = {
    ensureDocument: vi.fn(async () => undefined),
    hasDocument: vi.fn(async () => false),
    send,
    sendIfPresent,
} as unknown as OffscreenClient;

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    setRuntimeFetch();
});

describe('selection TTS Offscreen adapter', () => {
    const preparePermit = () => {
        send.mockResolvedValueOnce({success: true, revision: 'revision', receiverId: 'receiver'})
            .mockResolvedValueOnce({success: true, playbackToken: 'permit'});
    };
    const adapter = createSelectionTtsOffscreenAdapter(client);

    it('fetches Google audio through the platform transport and preserves its response metadata', async () => {
        const transport = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: {'content-type': 'audio/ogg'},
        }));
        const controller = new AbortController();
        setRuntimeFetch(transport);

        await expect(adapter.fetchPageAudio('https://example.test/audio', controller.signal)).resolves.toEqual({
            audio: new Uint8Array([1, 2, 3]).buffer,
            contentType: 'audio/ogg',
        });
        expect(transport).toHaveBeenCalledWith('https://example.test/audio', {signal: controller.signal});
    });

    it.each([
        {statusText: 'Service Unavailable', expected: 'Google TTS failed: 503 Service Unavailable'},
        {statusText: '', expected: 'Google TTS failed: 503'},
    ])('reports Google HTTP errors with or without a status label: $statusText', async ({statusText, expected}) => {
        setRuntimeFetch(async () => new Response('unavailable', {status: 503, statusText}));
        await expect(adapter.fetchPageAudio('https://example.test/audio', new AbortController().signal)).rejects.toThrow(expected);
    });

    it('cancels an unread Google error body before reporting the HTTP failure', async () => {
        const cancel = vi.fn();
        const body = new ReadableStream<Uint8Array>({cancel});
        setRuntimeFetch(async () => new Response(body, {status: 503}));
        await expect(adapter.fetchPageAudio('https://example.test/audio', new AbortController().signal)).rejects.toThrow('Google TTS failed: 503');
        expect(cancel).toHaveBeenCalledOnce();
    });

    it('uses the MPEG content type when Google omits the response header', async () => {
        setRuntimeFetch(async () => new Response(new Uint8Array([7])));
        await expect(adapter.fetchPageAudio('https://example.test/audio', new AbortController().signal)).resolves.toMatchObject({
            contentType: 'audio/mpeg',
        });
    });

    it.each([
        {errorCode: 'selection-tts-permit-invalid', receiverId: 'receiver'},
        {errorCode: 'selection-tts-permit-invalid'},
        {errorCode: 'selection-tts-permit-invalid', receiverId: 1},
        {errorCode: 'different-error', receiverId: 'replacement'},
    ])('does not retry same-instance revocation or unverified playback failure %j', async failure => {
        preparePermit();
        send.mockResolvedValueOnce({success: false, error: 'revoked', ...failure});
        await expect(adapter.play({tabId: 7, clientRequestId: 'revoked', sourceUrl: 'https://example.test/audio'}))
            .rejects.toThrow('revoked');
        expect(send).toHaveBeenCalledTimes(3);
    });

    it('bounds repeated verified receiver replacement without accepting any old permit', async () => {
        for (let i = 0; i < 3; i++) {
            send.mockResolvedValueOnce({success: true, revision: `revision-${i}`, receiverId: `receiver-${i}`})
                .mockResolvedValueOnce({success: true, playbackToken: `permit-${i}`})
                .mockResolvedValueOnce({success: false, errorCode: 'selection-tts-permit-invalid', receiverId: `receiver-${i + 1}`});
        }
        await expect(adapter.play({tabId: 7, clientRequestId: 'replaced', sourceUrl: 'https://example.test/audio'}))
            .rejects.toThrow('语音播放未能启动，请重试');
        expect(send).toHaveBeenCalledTimes(9);
    });

    it.each([undefined, {success: false}, {success: false, error: 'read-error'},
        {success: true}, {success: true, revision: 1}, {success: true, revision: 'v', receiverId: 1}])('rejects malformed snapshot %j before reserving or sending audio', async response => {
        send.mockResolvedValueOnce(response);
        await expect(adapter.play({tabId: 7, clientRequestId: 'invalid-snapshot', sourceUrl: 'https://example.test/audio'})).rejects.toThrow();
        expect(send).toHaveBeenCalledOnce();
    });

    it.each([undefined, {success: false}, {success: false, error: 'reserve-error'},
        {success: true}, {success: true, playbackToken: 1}])('rejects malformed reservation %j without sending PLAY', async response => {
        send.mockResolvedValueOnce({success: true, revision: 'version', receiverId: 'receiver'}).mockResolvedValueOnce(response);
        await expect(adapter.play({tabId: 7, clientRequestId: 'invalid-reserve', sourceUrl: 'https://example.test/audio'})).rejects.toThrow();
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('retries a compare-and-swap conflict with the same local signal and stops after three conflicts', async () => {
        const controller = new AbortController(), route = {tabId: 7, clientRequestId: 'conflict'};
        send.mockResolvedValueOnce({success: true, revision: 'v1', receiverId: 'receiver'})
            .mockResolvedValueOnce({success: false, conflict: true})
            .mockResolvedValueOnce({success: true, revision: 'v2', receiverId: 'receiver'})
            .mockResolvedValueOnce({success: true, playbackToken: 'permit'})
            .mockResolvedValueOnce({success: true});
        await adapter.play({...route, sourceUrl: 'https://example.test/audio'}, controller.signal);
        for (const [message, options] of send.mock.calls) {
            expect(options.signal).toBe(controller.signal); expect(message).not.toHaveProperty('signal');
            expect(options.cancelMessage).toEqual({type: 'STOP_SELECTION_TTS', ...route});
        }
        send.mockClear();
        for (let i = 0; i < 3; i++) send.mockResolvedValueOnce({success: true, revision: `v${i}`, receiverId: 'receiver'})
            .mockResolvedValueOnce({success: false, conflict: true});
        await expect(adapter.play({...route, sourceUrl: 'https://example.test/audio'}, controller.signal)).rejects.toThrow('语音播放未能启动，请重试');
        expect(send).toHaveBeenCalledTimes(6);
    });

    it('does not start preparation or delivery for a pre-cancelled signal', async () => {
        const controller = new AbortController(); controller.abort();
        await expect(adapter.play({tabId: 0, clientRequestId: 'cancelled', sourceUrl: 'https://example.test/audio'}, controller.signal))
            .rejects.toMatchObject({name: 'AbortError'});
        expect(send).not.toHaveBeenCalled();
    });

    it('seeks only an existing document and returns whether its current route accepted the jump', async () => {
        sendIfPresent.mockResolvedValueOnce({success:true,seeked:true});
        await expect(adapter.seek(route,5)).resolves.toBe(true);
        expect(sendIfPresent).toHaveBeenLastCalledWith({type:'SEEK_SELECTION_TTS',...route,offsetSeconds:5});
        for(const response of [undefined,{success:true},{success:true,seeked:false}]){
            sendIfPresent.mockResolvedValueOnce(response);await expect(adapter.seek(route,-5)).resolves.toBe(false);
        }
        sendIfPresent.mockResolvedValueOnce({success:false,error:'seek custom'});await expect(adapter.seek(route,5)).rejects.toThrow('seek custom');
        sendIfPresent.mockResolvedValueOnce({success:false});await expect(adapter.seek(route,5)).rejects.toThrow('语音跳转失败');
        expect(send).not.toHaveBeenCalled();
    });
    const route = {tabId: 7, clientRequestId: 'request-1'};

    it('plays audio/source payloads and rejects unsuccessful playback', async () => {
        preparePermit();
        send.mockResolvedValueOnce({success: true});
        await expect(adapter.play({...route, sourceUrl: 'https://example.test/audio'})).resolves.toBeUndefined();
        expect(send).toHaveBeenCalledWith({
            type: 'PLAY_SELECTION_TTS',
            ...route,
            sourceUrl: 'https://example.test/audio', playbackToken: 'permit',
        }, {signal: undefined, cancelMessage: {type: 'STOP_SELECTION_TTS', ...route}});

        preparePermit();
        send.mockResolvedValueOnce({success: false, error: 'play custom'});
        await expect(adapter.play({...route, audioBase64: 'AA==', contentType: 'audio/mpeg'}))
            .rejects.toThrow('play custom');
        preparePermit();
        send.mockResolvedValueOnce(undefined);
        await expect(adapter.play({...route, audioBase64: 'AA==', contentType: 'audio/mpeg'}))
            .rejects.toThrow('Offscreen TTS 播放失败');
    });

    it('uses optional delivery for stop and accepts missing or successful documents', async () => {
        sendIfPresent.mockResolvedValueOnce(undefined);
        await expect(adapter.stop(route)).resolves.toBeUndefined();
        expect(sendIfPresent).toHaveBeenCalledWith({type: 'STOP_SELECTION_TTS', ...route});

        sendIfPresent.mockResolvedValueOnce({success: true});
        await expect(adapter.stop(route)).resolves.toBeUndefined();

        sendIfPresent.mockResolvedValueOnce({success: false, error: 'stop custom'});
        await expect(adapter.stop(route)).rejects.toThrow('stop custom');
        sendIfPresent.mockResolvedValueOnce({success: false});
        await expect(adapter.stop(route)).rejects.toThrow('Offscreen TTS 停止失败');
    });

    it('forwards text and timings without mutation for both generated audio and legacy URL playback', async () => {
        const timings = [{startChar: 0, endChar: 5, startTime: 0, endTime: 1}];
        for (const payload of [
            {...route, audioBase64: 'AA==', contentType: 'audio/wav' as const, text: 'Hello', timings},
            {...route, sourceUrl: 'https://example.test/audio', text: 'Hello'},
        ]) {
            preparePermit(); send.mockResolvedValueOnce({success: true});
            await adapter.play(payload);
            expect(send).toHaveBeenLastCalledWith({type: 'PLAY_SELECTION_TTS', ...payload, playbackToken: 'permit'},
                {signal: undefined, cancelMessage: {type: 'STOP_SELECTION_TTS', ...route}});
        }
        expect(timings).toEqual([{startChar: 0, endChar: 5, startTime: 0, endTime: 1}]);
    });
});
describe('TTS metadata across online synthesis, adapters and routed playback', () => {
    let player: ReturnType<typeof createSelectionTtsPlayer> | undefined;
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => { player?.dispose(); player = undefined; vi.useRealTimers(); });
    const timings = [
        {startChar: 0, endChar: 5, startTime: 0, endTime: 1},
        {startChar: 6, endChar: 11, startTime: 1, endTime: 5},
    ];

    it.each([
        ['timed', {timings}, timings], ['legacy', {}, undefined], ['invalid', {timings: [{...timings[0], endTime: 0}]}, [{...timings[0], endTime: 0}]],
    ])('plays %s Edge metadata through the actual cross-layer path and keeps progress cancellable', async (kind, metadata, expectedTimings) => {
        const audios: Array<SelectionAudioPort & {currentTime: number; duration: number}> = [];
        const messages: Record<string, unknown>[] = [];
        const received: unknown[] = [];
        const controller = createSelectionTtsContentController({
            createClientRequestId: () => 'flow-client', stopRemote: vi.fn(async () => undefined),
        });
        const request = controller.beginRemoteRequest();
        const notify = (audioRequest: {tabId: number; clientRequestId: string}, state: string, progress?: unknown) => {
            void background.dispatch({type: 'selectionTtsPlaybackState', ...audioRequest, state, progress}, {});
        };
        player = createSelectionTtsPlayer({
            createAudio: () => {
                const audio = {currentTime: 0, duration: 5, preload: '', src: '', onended: null, onerror: null,
                    play: vi.fn(async () => undefined), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn()};
                audios.push(audio);
                return audio;
            },
            decodeBase64: value => Uint8Array.from(atob(value), char => char.charCodeAt(0)),
            createObjectUrl: () => 'blob:cross-layer', revokeObjectUrl: vi.fn(),
            notify: (audioRequest, state) => notify(audioRequest, state),
            notifyProgress: (audioRequest, progress) => notify(audioRequest, 'progress', progress),
        });
        const synthesizeOnline = vi.fn(async () => ({
            audio: new Uint8Array([82, 73, 70, 70]).buffer, contentType: 'audio/wav' as const, voice: 'zf_001', ...(metadata as object),
        }));
        const offscreen = createOffscreenMessageListener({ttsPlayer: player, translate: vi.fn()});
        const routeMessage = async (message: Record<string, unknown>) => {
            messages.push(message);
            return new Promise(resolve => expect(offscreen({...message, target: 'offscreen'}, {}, resolve)).toBe(true));
        };
        const client = {send: vi.fn(routeMessage), sendIfPresent: vi.fn(routeMessage)} as unknown as OffscreenClient;
        const playback = createSelectionTtsOffscreenAdapter(client);
        const synthesize = createSelectionTtsSynthesizer({
            getOnlineVoices: () => [], synthesizeOnline,
        });
        const background = createBackgroundMessageRouter<SelectionTtsContext>(createSelectionTtsBackgroundHandlers({
            getPreferredVoices: () => [], synthesize, playWithOffscreen: playback.play, stopWithOffscreen: playback.stop, seekWithOffscreen: playback.seek,
            sendTabMessage: vi.fn(async (tabId, message) => {
                expect(tabId).toBe(0);
                expect(controller.matchRemoteState(message)).not.toBeNull();
                received.push(message);
            }),
        }) as Array<BackgroundMessageHandler<SelectionTtsContext>>);
        const result = await background.dispatch({type: 'selectionTts', text: ' Hello world ', language: 'en-US', clientRequestId: request.clientRequestId}, {sender: {tab: {id: 0}}});
        if (!result.handled) throw new Error('Expected selection TTS to be handled by the background router');
        expect(result.response).toEqual({success: true, transport: 'offscreen', voice: 'zf_001'});
        expect(controller.completeRemoteRequest(request, result.response as {success: boolean; transport: string})).toBe('offscreen');
        expect(messages.find(message => message.type === 'PLAY_SELECTION_TTS')).toEqual({
            type: 'PLAY_SELECTION_TTS', playbackToken: expect.any(String), audioBase64: 'UklGRg==', contentType: 'audio/wav' as const, text: 'Hello world', tabId: 0, clientRequestId: request.clientRequestId,
            ...(expectedTimings === undefined ? {} : {timings: expectedTimings}),
        });
        expect(synthesizeOnline).toHaveBeenCalledWith('Hello world', 'en-US', [], expect.any(AbortSignal));
        audios[0].currentTime = 3;
        await vi.advanceTimersByTimeAsync(100);
        const progress = (received.at(-1) as {progress: {start: number; end: number; fraction: number; estimated: boolean}}).progress;
        expect(progress).toMatchObject({start: 6, end: 11, estimated: true});
        expect(progress.fraction).toBeCloseTo(kind === 'timed' ? 0.5 : 0.12);
        expect(controller.getState().activeClientRequestId).toBe(request.clientRequestId);
        await background.dispatch({type: 'selectionTtsStop', clientRequestId: request.clientRequestId}, {sender: {tab: {id: 0}}});
        expect(messages.at(-1)).toEqual({type: 'STOP_SELECTION_TTS', tabId: 0, clientRequestId: request.clientRequestId});
        expect(audios[0].pause).toHaveBeenCalledOnce();
        expect(received.at(-1)).toMatchObject({state: 'stopped', clientRequestId: request.clientRequestId});
        expect(vi.getTimerCount()).toBe(0);
    });
});
