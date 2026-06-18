import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useConsent } from '../useConsent';
import { Enforce } from '../Enforce';

vi.mock('../Enforce', () => ({
    Enforce: {
        getConsent: vi.fn(),
        _addConsentChangeListener: vi.fn(),
    },
}));

describe('useConsent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(Enforce.getConsent).mockResolvedValue({});
        vi.mocked(Enforce._addConsentChangeListener).mockReturnValue(vi.fn());
    });

    it('starts with loading=true and empty consent', () => {
        vi.mocked(Enforce.getConsent).mockReturnValue(new Promise(() => {}));
        const { result } = renderHook(() => useConsent());
        expect(result.current.loading).toBe(true);
        expect(result.current.consent).toEqual({});
    });

    it('sets loading=false and populates consent after getConsent resolves', async () => {
        vi.mocked(Enforce.getConsent).mockResolvedValue({ analytics: true });
        const { result } = renderHook(() => useConsent());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.consent).toEqual({ analytics: true });
    });

    it('registers a change listener on mount', async () => {
        const { result } = renderHook(() => useConsent());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(Enforce._addConsentChangeListener).toHaveBeenCalledOnce();
    });

    it('calls the unsubscribe function on unmount', async () => {
        const mockUnsubscribe = vi.fn();
        vi.mocked(Enforce._addConsentChangeListener).mockReturnValue(mockUnsubscribe);
        const { result, unmount } = renderHook(() => useConsent());
        await waitFor(() => expect(result.current.loading).toBe(false));
        unmount();
        expect(mockUnsubscribe).toHaveBeenCalledOnce();
    });

    it('re-fetches consent when the change listener is triggered', async () => {
        vi.mocked(Enforce.getConsent)
            .mockResolvedValueOnce({ analytics: true })
            .mockResolvedValueOnce({ analytics: false, marketing: true });

        const { result } = renderHook(() => useConsent());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.consent).toEqual({ analytics: true });

        const listener = vi.mocked(Enforce._addConsentChangeListener).mock.calls[0][0];
        act(() => { listener(); });
        await waitFor(() =>
            expect(result.current.consent).toEqual({ analytics: false, marketing: true })
        );
    });

    it('sets loading=false and keeps empty consent when getConsent throws', async () => {
        vi.mocked(Enforce.getConsent).mockRejectedValue(new Error('notConfigured'));
        const { result } = renderHook(() => useConsent());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.consent).toEqual({});
    });

    describe('checkConsent', () => {
        it('returns true for a consented category', async () => {
            vi.mocked(Enforce.getConsent).mockResolvedValue({ analytics: true });
            const { result } = renderHook(() => useConsent());
            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(result.current.checkConsent('analytics')).toBe(true);
        });

        it('returns false for a rejected category', async () => {
            vi.mocked(Enforce.getConsent).mockResolvedValue({ analytics: false });
            const { result } = renderHook(() => useConsent());
            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(result.current.checkConsent('analytics')).toBe(false);
        });

        it('returns false for a category not in the consent map', async () => {
            vi.mocked(Enforce.getConsent).mockResolvedValue({ analytics: true });
            const { result } = renderHook(() => useConsent());
            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(result.current.checkConsent('unknown')).toBe(false);
        });
    });
});
