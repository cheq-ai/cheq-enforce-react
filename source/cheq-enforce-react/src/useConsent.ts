/**
 * useConsent — React hook for reading consent state reactively.
 *
 * Returns the current consent map and a helper to check individual categories.
 * Triggers a re-render whenever consent is updated by subscribing via
 * Enforce._addConsentChangeListener.
 */

import { useCallback, useEffect, useState } from "react";
import { Enforce } from "./Enforce";

export interface UseConsentResult {
    /** Full map of category → bool, or an empty object if no consent is stored yet. */
    consent: Record<string, boolean>;
    /** Returns true if the given category has been consented to. */
    checkConsent: (category: string) => boolean;
    /** True while consent is being loaded on first render. */
    loading: boolean;
}

export function useConsent(): UseConsentResult {
    const [consent, setConsent] = useState<Record<string, boolean>>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            try {
                const c = await Enforce.getConsent();
                if (!cancelled) {
                    setConsent(c);
                    setLoading(false);
                }
            } catch {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void run();
        const unsubscribe = Enforce._addConsentChangeListener(() => { void run(); });

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, []);

    const checkConsent = useCallback(
        (category: string) => consent[category] === true,
        [consent]
    );

    return { consent, checkConsent, loading };
}
