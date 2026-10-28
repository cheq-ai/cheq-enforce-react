import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Enforce } from '../Enforce';
import { configurePlatform } from '../configurePlatform';
import { fetchRemoteConfig } from '../api';
import { clearReportedFlags, sendReportingBeacon } from '../ConsentReporting';
import { sendError } from '../ErrorReporting';
import { loadConsent, saveConsent, clearConsent } from '../Storage';
import type { ConsentData, EnforceConfig } from '../Types';

vi.mock('../configurePlatform', () => ({ configurePlatform: vi.fn() }));
vi.mock('../api', () => ({ fetchRemoteConfig: vi.fn() }));
vi.mock('../ConsentReporting', () => ({
    sendReportingBeacon: vi.fn(),
    resetReportingState: vi.fn(),
    clearReportedFlags: vi.fn(),
}));
vi.mock('../ErrorReporting', () => ({ sendError: vi.fn() }));
vi.mock('../Storage', () => ({
    loadConsent: vi.fn(),
    saveConsent: vi.fn(),
    clearConsent: vi.fn(),
    loadEnvironmentOverride: vi.fn().mockResolvedValue(null),
    saveEnvironmentOverride: vi.fn(),
    clearEnvironmentOverride: vi.fn(),
}));

const TEST_CONFIG: EnforceConfig = {
    clientName: 'test',
    publishPath: 'prod',
    environment: 'test-env',
};

beforeEach(async () => {
    vi.resetAllMocks();
    vi.mocked(configurePlatform).mockResolvedValue(true);
    vi.mocked(sendReportingBeacon).mockResolvedValue(undefined);
    vi.mocked(clearReportedFlags).mockResolvedValue(undefined);
    vi.mocked(sendError).mockResolvedValue(true);
    vi.mocked(saveConsent).mockResolvedValue(undefined);
    vi.mocked(clearConsent).mockResolvedValue(undefined);
    vi.mocked(loadConsent).mockResolvedValue(null);
    vi.mocked(fetchRemoteConfig).mockRejectedValue(new Error('unused'));
    await Enforce.configure(TEST_CONFIG);
});

describe('Enforce.clearConsent — reported event flags', () => {
    it('clears persisted reporting event flags along with consent', async () => {
        await Enforce.clearConsent();

        expect(clearConsent).toHaveBeenCalledOnce();
        expect(clearReportedFlags).toHaveBeenCalledOnce();
    });
});

describe('Enforce.configure — event flag expiry', () => {
    function storedConsent(overrides: Partial<ConsentData> = {}): ConsentData {
        return {
            categories: { Analytics: true },
            savedAt: Date.now() - 1_000,
            dataRetentionPeriod: 86_400_000,
            version: '1',
            ...overrides,
        };
    }

    async function configureNative(stored: ConsentData | null): Promise<void> {
        vi.mocked(clearReportedFlags).mockClear();
        vi.mocked(configurePlatform).mockResolvedValue(false);
        vi.mocked(fetchRemoteConfig).mockRejectedValue(new Error('fetch not needed'));
        vi.mocked(loadConsent).mockResolvedValue(stored);
        await Enforce.configure(TEST_CONFIG);
    }

    it('clears reported event flags and the dead record when stored consent has expired', async () => {
        await configureNative(storedConsent({ savedAt: 0, dataRetentionPeriod: 1_000 }));
        expect(clearReportedFlags).toHaveBeenCalledOnce();
        expect(clearConsent).toHaveBeenCalledOnce();
    });

    it('clears reported event flags and the dead record when the stored consent version mismatches', async () => {
        await configureNative(storedConsent({ version: 'v99' }));
        expect(clearReportedFlags).toHaveBeenCalledOnce();
        expect(clearConsent).toHaveBeenCalledOnce();
    });

    it('keeps reported event flags while stored consent is valid', async () => {
        await configureNative(storedConsent());
        expect(clearReportedFlags).not.toHaveBeenCalled();
        expect(clearConsent).not.toHaveBeenCalled();
    });

    it('keeps reported event flags when no consent is stored at all', async () => {
        await configureNative(null);
        expect(clearReportedFlags).not.toHaveBeenCalled();
        expect(clearConsent).not.toHaveBeenCalled();
    });

    it('does not clear events on launches after the dead record was removed', async () => {
        // Launch 1: expired record found → events + record cleared once.
        await configureNative(storedConsent({ savedAt: 0, dataRetentionPeriod: 1_000 }));
        expect(clearReportedFlags).toHaveBeenCalledOnce();

        // Launch 2: record is gone, so events recorded since (e.g.
        // BANNER_LOADED) must survive.
        await configureNative(null);
        expect(clearReportedFlags).not.toHaveBeenCalled();
    });
});