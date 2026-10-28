/**
 * useSubmitGuard — the submit lock shared by the consent banner and modal.
 *
 * guard(fn) wraps a button action so only one runs at a time. The lock is
 * taken before the action runs and released if it throws or its promise
 * rejects, so a failed action leaves the UI usable. On success the lock is
 * held while the UI is dismissed, until the component calls reset().
 */

import { useCallback, useRef, useState } from "react";

type Action = () => void | Promise<void>;

export interface SubmitGuard {
    /** True while a guarded action holds the lock. */
    submitting: boolean;
    /** Wraps an action so it only runs when no other guarded action is in progress. */
    guard: (fn: Action) => () => void;
    /** Calls onClose outside the lock, for the system back gesture. */
    handleRequestClose: () => void;
    /** Releases the lock, e.g. when the UI opens again. */
    reset: () => void;
}

export function useSubmitGuard(onClose: Action): SubmitGuard {
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);

    const reset = useCallback(() => {
        submittingRef.current = false;
        setSubmitting(false);
    }, []);

    const guard = useCallback(
        (fn: Action) => () => {
            if (submittingRef.current) return;
            submittingRef.current = true;
            setSubmitting(true);
            try {
                const result = fn();
                if (result) void result.catch(reset);
            } catch {
                reset();
            }
        },
        [reset]
    );

    // Bypasses the lock so the system back gesture always works. onClose
    // reports its own failures; swallow the rejection here.
    const handleRequestClose = useCallback(() => {
        const result = onClose();
        if (result) void result.catch(() => {});
    }, [onClose]);

    return { submitting, guard, handleRequestClose, reset };
}
