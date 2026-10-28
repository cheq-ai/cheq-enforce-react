import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sendError } from '../ErrorReporting';
import { SDK_VERSION } from '../version';

const OPTIONS = {
    msg: 'something broke',
    fn: 'Enforce.configure.test',
    config: { clientName: 'acme', publishPath: 'prod', debug: false },
};

function calledUrl(callIndex = 0): URL {
    return new URL(vi.mocked(fetch).mock.calls[callIndex][0] as string);
}

describe('sendError — URL construction', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    });

    it('sends the expected query parameters', async () => {
        await expect(sendError(OPTIONS)).resolves.toBe(true);

        const url = calledUrl();
        expect(url.origin).toBe('https://nexus.ensighten.com');
        expect(url.pathname).toBe('/error/e.gif');
        expect(url.searchParams.get('msg')).toBe('something broke');
        expect(url.searchParams.get('client')).toBe('acme');
        expect(url.searchParams.get('publishPath')).toBe('prod');
        expect(url.searchParams.get('errorName')).toBe('SDKError');
        expect(url.searchParams.get('fn')).toContain(`CheqEnforce/${SDK_VERSION}`);
    });

    it('includes the utm parameters', async () => {
        await sendError(OPTIONS);

        const url = calledUrl();
        expect(url.searchParams.get('utm_platform')).toBe('react');
        expect(url.searchParams.get('utm_sdk_version')).toBe(SDK_VERSION);
    });

    it('includes cid only when a clientId is provided', async () => {
        await sendError({ ...OPTIONS, clientId: 'cid-42' });
        expect(calledUrl(0).searchParams.get('cid')).toBe('cid-42');

        await sendError(OPTIONS);
        expect(calledUrl(1).searchParams.get('cid')).toBeNull();
    });

    it('uses the test host when debug is enabled', async () => {
        await sendError({ ...OPTIONS, config: { ...OPTIONS.config, debug: true } });
        expect(calledUrl().origin).toBe('https://nexus-test.ensighten.com');
    });

    it('retries without headers on header failure, keeping the same URL', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockRejectedValueOnce(new Error('headers rejected'))
                .mockResolvedValueOnce({ ok: true })
        );

        await expect(sendError(OPTIONS)).resolves.toBe(true);

        expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
        const [firstUrl, firstInit] = vi.mocked(fetch).mock.calls[0];
        const [secondUrl, secondInit] = vi.mocked(fetch).mock.calls[1];
        expect(secondUrl).toBe(firstUrl);
        expect((firstInit as RequestInit).headers).toBeDefined();
        expect((secondInit as RequestInit).headers).toBeUndefined();
        expect(new URL(secondUrl as string).searchParams.get('utm_platform')).toBe('react');
    });
});