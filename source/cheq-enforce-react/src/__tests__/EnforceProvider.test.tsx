import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { EnforceProvider } from '../EnforceProvider';
import { Enforce } from '../Enforce';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('EnforceProvider', () => {
    it('unregisters its UI callbacks on unmount', () => {
        const register = Enforce._registerCallbacks.bind(Enforce);
        const unregister = vi.fn();
        vi.spyOn(Enforce, '_registerCallbacks').mockImplementation((callbacks) => {
            unregister.mockImplementation(register(callbacks));
            return unregister;
        });

        const { unmount } = render(<EnforceProvider>{null}</EnforceProvider>);
        expect(Enforce._registerCallbacks).toHaveBeenCalledOnce();
        expect(unregister).not.toHaveBeenCalled();

        unmount();

        expect(unregister).toHaveBeenCalledOnce();
    });
});
