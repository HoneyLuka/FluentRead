import {describe, expect, it, vi} from 'vitest';
import {createCapabilityGatedSelectionTtsTransport} from '@/src/app/background/capabilityRegistry';
import {resolveBrowserCapabilities} from '@/src/platform/browser/capabilities';

describe('background capability registry', () => {
    it('preserves Offscreen transport on supported targets and makes page-only stop a no-op', async () => {
        const play = vi.fn(async (_request: {id: string}) => undefined);
        const stop = vi.fn(async (_route: {id: string}) => undefined);
        const transport = {play, stop};
        const chromeTransport = createCapabilityGatedSelectionTtsTransport(
            resolveBrowserCapabilities({browser: 'chrome', manifestVersion: 3}),
            transport,
        );
        expect(chromeTransport).toBe(transport);
        await chromeTransport.play({id: 'chrome'});
        await chromeTransport.stop({id: 'chrome'});
        expect(play).toHaveBeenCalledWith({id: 'chrome'});
        expect(stop).toHaveBeenCalledWith({id: 'chrome'});

        const pageOnlyTransport = createCapabilityGatedSelectionTtsTransport(
            resolveBrowserCapabilities({browser: 'firefox', manifestVersion: 3}),
            transport,
        );
        expect(pageOnlyTransport.play).toBe(play);
        await pageOnlyTransport.stop({id: 'firefox'});
        expect(stop).toHaveBeenCalledTimes(1);
    });
});
