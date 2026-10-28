import { decompressBlock, makeBuffer } from 'lz4js';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    clearReportedFlags,
    createLiteralOnlyLz4Block,
    getReportedEventFlags,
    resetReportingState,
    sendReportingBeacon,
} from '../ConsentReporting';
import { clearReportingEvents, loadReportingEvents } from '../Storage';
import { SDK_VERSION } from '../version';
import type { EnforceConfig, RemoteConfig } from '../Types';

vi.mock('../ErrorReporting', () => ({ sendError: vi.fn().mockResolvedValue(true) }));

/** Decode a beacon URL's LZ4-compressed base64url `d` param back to the JSON payload. */
function decodeBeaconPayload(url: string): Record<string, unknown> {
    const params = new URL(url).searchParams;
    const encoded = params.get('d');
    const decompressedLength = Number(params.get('s'));
    if (!encoded || !Number.isFinite(decompressedLength)) {
        throw new Error(`beacon URL missing d/s params: ${url}`);
    }
    const compressed = new Uint8Array(Buffer.from(encoded, 'base64url'));
    const decompressed = makeBuffer(decompressedLength);
    decompressBlock(compressed, decompressed, 0, compressed.length, 0);
    return JSON.parse(new TextDecoder().decode(decompressed)) as Record<string, unknown>;
}

const CONFIG: EnforceConfig = {
    clientName: 'test',
    publishPath: 'prod',
    environment: 'English',
};

const REMOTE_CONFIG = {
    clientId: 'cid-1',
    version: '1.0',
    enforcement: true,
    enablePrivacyNotice: false,
    enableConsentModal: false,
} as unknown as RemoteConfig;

describe('buildReportingContext — null-return guard (W1)', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
        resetReportingState();
    });

    it('does not call fetch when remoteConfig is null', async () => {
        await sendReportingBeacon({ config: CONFIG, remoteConfig: null, type: 'billing' });
        expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('does not call fetch when remoteConfig is missing clientId', async () => {
        const rc = { ...REMOTE_CONFIG, clientId: undefined } as unknown as RemoteConfig;
        await sendReportingBeacon({ config: CONFIG, remoteConfig: rc, type: 'consent' });
        expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('does not call fetch when remoteConfig is missing version', async () => {
        const rc = { ...REMOTE_CONFIG, version: undefined } as unknown as RemoteConfig;
        await sendReportingBeacon({ config: CONFIG, remoteConfig: rc, type: 'consent' });
        expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('does not call fetch when remoteConfig enforcement is not a boolean', async () => {
        const rc = { ...REMOTE_CONFIG, enforcement: 'yes' } as unknown as RemoteConfig;
        await sendReportingBeacon({ config: CONFIG, remoteConfig: rc, type: 'consent' });
        expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });
});

describe('createLiteralOnlyLz4Block — large-input paths (W3)', () => {
    it('encodes an input < 15 bytes with a single token byte', () => {
        const input = new Uint8Array(5).fill(0x61);
        const result = createLiteralOnlyLz4Block(input);
        expect(result[0]).toBe(5 << 4);
        expect(result.slice(1)).toEqual(input);
    });

    it('encodes a 15-byte input with a two-byte token+overflow header', () => {
        const input = new Uint8Array(15).fill(0x61);
        const result = createLiteralOnlyLz4Block(input);
        expect(result[0]).toBe(0xf0); // 15 << 4
        expect(result[1]).toBe(0x00); // literalLength - 15 = 0
        expect(result.slice(2)).toEqual(input);
    });

    it('encodes a 270-byte input through the >= 255 overflow loop', () => {
        const input = new Uint8Array(270).fill(0x61);
        const result = createLiteralOnlyLz4Block(input);
        expect(result[0]).toBe(0xf0); // 15 << 4
        expect(result[1]).toBe(0xff); // first overflow byte: 255
        expect(result[2]).toBe(0x00); // remainder: 270 - 15 - 255 = 0
        expect(result.slice(3)).toEqual(input);
    });
});

describe('beacon URL and payload', () => {
    beforeEach(async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
        resetReportingState();
        await clearReportingEvents();
    });

    it('sends utm_platform=react and the plain SDK version as utm_sdk_version', async () => {
        await sendReportingBeacon({ config: CONFIG, remoteConfig: REMOTE_CONFIG, type: 'consent' });

        const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string);
        expect(url.origin).toBe('https://data.privacy.ensighten.com');
        expect(url.searchParams.get('utm_platform')).toBe('react');
        expect(url.searchParams.get('utm_sdk_version')).toBe(SDK_VERSION);
    });

    it('reports the combined gateway version in the billing payload', async () => {
        await sendReportingBeacon({ config: CONFIG, remoteConfig: REMOTE_CONFIG, type: 'billing' });

        const payload = decodeBeaconPayload(vi.mocked(fetch).mock.calls[0][0] as string);
        expect(payload.gateway).toBe(`1.0-react-${SDK_VERSION}`);
    });

    it('includes seeded event flags in the billing payload cookies, unprefixed', async () => {
        await sendReportingBeacon({
            config: CONFIG,
            remoteConfig: REMOTE_CONFIG,
            type: 'billing',
            cookieFlags: { analytics: true, BANNER_VIEWED: true, MODAL_LOADED: true },
        });

        const payload = decodeBeaconPayload(vi.mocked(fetch).mock.calls[0][0] as string);
        expect(payload.cookies).toEqual({
            analytics: '1',
            BANNER_VIEWED: '1',
            MODAL_LOADED: '1',
        });
    });

    it('keeps prefixed cookie names in the consent payload', async () => {
        await sendReportingBeacon({
            config: CONFIG,
            remoteConfig: REMOTE_CONFIG,
            type: 'consent',
            cookieFlags: { analytics: true },
            eventFlags: { BANNER_VIEWED: true },
        });

        const payload = decodeBeaconPayload(vi.mocked(fetch).mock.calls[0][0] as string);
        expect(payload.cookies).toEqual({
            TEST_ENSIGHTEN_PRIVACY_analytics: '1',
            TEST_ENSIGHTEN_PRIVACY_BANNER_VIEWED: '1',
        });
    });

    it('accumulates reported event flags and clears them on reset', async () => {
        await sendReportingBeacon({
            config: CONFIG,
            remoteConfig: REMOTE_CONFIG,
            type: 'consent',
            eventFlags: { BANNER_LOADED: true },
        });
        await sendReportingBeacon({
            config: CONFIG,
            remoteConfig: REMOTE_CONFIG,
            type: 'consent',
            cookieFlags: { analytics: true },
            eventFlags: { BANNER_VIEWED: true },
        });

        expect(getReportedEventFlags()).toEqual({ BANNER_LOADED: true, BANNER_VIEWED: true });

        resetReportingState();
        expect(getReportedEventFlags()).toEqual({});
    });

    it('reports the combined gateway version in the consent payload', async () => {
        await sendReportingBeacon({
            config: CONFIG,
            remoteConfig: REMOTE_CONFIG,
            type: 'consent',
            cookieFlags: { analytics: true },
        });

        const payload = decodeBeaconPayload(vi.mocked(fetch).mock.calls[0][0] as string);
        expect(payload.gateway).toBe(`1.0-react-${SDK_VERSION}`);
    });
});

describe('event flag persistence across sessions', () => {
    beforeEach(async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
        resetReportingState();
        await clearReportingEvents();
    });

    it('persists event flags when an event beacon is sent', async () => {
        await sendReportingBeacon({
            config: CONFIG,
            remoteConfig: REMOTE_CONFIG,
            type: 'consent',
            eventFlags: { BANNER_LOADED: true },
        });

        await expect(loadReportingEvents()).resolves.toEqual({ BANNER_LOADED: true });
    });

    it('includes events persisted before a restart in the billing cookies', async () => {
        // Session 1: banner shown, no consent given.
        await sendReportingBeacon({
            config: CONFIG,
            remoteConfig: REMOTE_CONFIG,
            type: 'consent',
            eventFlags: { BANNER_LOADED: true },
        });

        // Session 2: app relaunch (in-memory state gone, storage remains).
        resetReportingState();
        await sendReportingBeacon({
            config: CONFIG,
            remoteConfig: REMOTE_CONFIG,
            type: 'billing',
            cookieFlags: { analytics: true },
        });

        const payload = decodeBeaconPayload(vi.mocked(fetch).mock.calls[1][0] as string);
        expect(payload.cookies).toEqual({ analytics: '1', BANNER_LOADED: '1' });
    });

    it('unions event flags across sessions', async () => {
        await sendReportingBeacon({
            config: CONFIG,
            remoteConfig: REMOTE_CONFIG,
            type: 'consent',
            eventFlags: { BANNER_LOADED: true },
        });

        resetReportingState();
        await sendReportingBeacon({
            config: CONFIG,
            remoteConfig: REMOTE_CONFIG,
            type: 'consent',
            eventFlags: { MODAL_LOADED: true },
        });

        await expect(loadReportingEvents()).resolves.toEqual({
            BANNER_LOADED: true,
            MODAL_LOADED: true,
        });
    });

    it('clearReportedFlags removes flags from memory and storage', async () => {
        await sendReportingBeacon({
            config: CONFIG,
            remoteConfig: REMOTE_CONFIG,
            type: 'consent',
            eventFlags: { BANNER_VIEWED: true },
        });

        await clearReportedFlags();

        expect(getReportedEventFlags()).toEqual({});
        await expect(loadReportingEvents()).resolves.toBeNull();
    });

    it('beacons sent after clearReportedFlags do not contain cleared cookie values', async () => {
        await sendReportingBeacon({
            config: CONFIG,
            remoteConfig: REMOTE_CONFIG,
            type: 'consent',
            cookieFlags: { analytics: true },
            eventFlags: { BANNER_VIEWED: true },
        });

        await clearReportedFlags();

        await sendReportingBeacon({
            config: CONFIG,
            remoteConfig: REMOTE_CONFIG,
            type: 'consent',
            eventFlags: { BANNER_LOADED: true },
        });

        const payload = decodeBeaconPayload(vi.mocked(fetch).mock.calls[1][0] as string);
        expect(payload.cookies).toEqual({ TEST_ENSIGHTEN_PRIVACY_BANNER_LOADED: '1' });
    });
});

describe('resetReportingState', () => {
    beforeEach(async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
        resetReportingState();
        await clearReportingEvents();
    });

    it('resets billingSent so a billing beacon fires again after reset', async () => {
        // First beacon — sets billingSent = true
        await sendReportingBeacon({ config: CONFIG, remoteConfig: REMOTE_CONFIG, type: 'billing' });
        expect(vi.mocked(fetch)).toHaveBeenCalledOnce();

        // Second call without reset — billingSent is still true, beacon is skipped
        await sendReportingBeacon({ config: CONFIG, remoteConfig: REMOTE_CONFIG, type: 'billing' });
        expect(vi.mocked(fetch)).toHaveBeenCalledOnce();

        // After reset, billingSent is false again — beacon fires
        resetReportingState();
        await sendReportingBeacon({ config: CONFIG, remoteConfig: REMOTE_CONFIG, type: 'billing' });
        expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    });

    it('resets consentBeaconCount so beacon numbering restarts after reset', async () => {
        await sendReportingBeacon({ config: CONFIG, remoteConfig: REMOTE_CONFIG, type: 'consent', cookieFlags: { analytics: true } });
        await sendReportingBeacon({ config: CONFIG, remoteConfig: REMOTE_CONFIG, type: 'consent', cookieFlags: { marketing: false } });

        // n=1 first call, n=2 second call
        const firstUrl = vi.mocked(fetch).mock.calls[0][0] as string;
        const secondUrl = vi.mocked(fetch).mock.calls[1][0] as string;
        expect(firstUrl).toContain('n=1');
        expect(secondUrl).toContain('n=2');

        resetReportingState();
        await sendReportingBeacon({ config: CONFIG, remoteConfig: REMOTE_CONFIG, type: 'consent', cookieFlags: { analytics: true } });
        const afterResetUrl = vi.mocked(fetch).mock.calls[2][0] as string;
        expect(afterResetUrl).toContain('n=1');
    });
});

describe('beacon index (n)', () => {
    beforeEach(async () => {
        resetReportingState();
        await clearReportingEvents();
    });

    function beaconIndexes(): (string | null)[] {
        return vi.mocked(fetch).mock.calls.map(([url]) =>
            new URL(url as string).searchParams.get('n')
        );
    }

    it('numbers billing 0 and consent beacons from 1', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

        await sendReportingBeacon({ config: CONFIG, remoteConfig: REMOTE_CONFIG, type: 'billing' });
        await sendReportingBeacon({ config: CONFIG, remoteConfig: REMOTE_CONFIG, type: 'consent', cookieFlags: { analytics: true } });
        await sendReportingBeacon({ config: CONFIG, remoteConfig: REMOTE_CONFIG, type: 'consent', cookieFlags: { analytics: false } });

        expect(beaconIndexes()).toEqual(['0', '1', '2']);
    });

    it('uses up an index when its beacon fails to send', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn()
                .mockRejectedValueOnce(new Error('offline'))
                .mockResolvedValue({ ok: true })
        );

        await sendReportingBeacon({ config: CONFIG, remoteConfig: REMOTE_CONFIG, type: 'consent', cookieFlags: { analytics: true } });
        await sendReportingBeacon({ config: CONFIG, remoteConfig: REMOTE_CONFIG, type: 'consent', cookieFlags: { analytics: false } });

        // The failed beacon was n=1, so the next one is n=2: the gap tells the
        // backend a beacon was lost.
        expect(beaconIndexes()).toEqual(['1', '2']);
    });
});
