import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sendReportingBeacon, resetReportingState, createLiteralOnlyLz4Block } from '../ConsentReporting';
import type { EnforceConfig, RemoteConfig } from '../Types';

vi.mock('../ErrorReporting', () => ({ sendError: vi.fn().mockResolvedValue(true) }));

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

describe('resetReportingState', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
        resetReportingState();
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
