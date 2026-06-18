/**
 * <EnforceProvider>
 *
 * Wraps your app and renders the consent banner + modal overlays.
 * It registers the UI callbacks with the Enforce singleton so that
 * Enforce.showBanner() / Enforce.showModal() work from anywhere.
 *
 * Usage:
 *   <EnforceProvider>
 *     <YourApp />
 *   </EnforceProvider>
 *
 * Then in your app entry point (or wherever convenient):
 *   await Enforce.configure({ clientName, publishPath, environment });
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Platform } from "react-native";
import { sendReportingBeacon } from "./ConsentReporting";
import { ConsentBanner } from "./ConsentBanner";
import { ConsentModal } from "./ConsentModal";
import { Enforce } from "./Enforce";
import { log } from "./logger";
import type { RemoteConfig } from "./Types";

export interface EnforceProviderProps {
    children: ReactNode;
}

function buildConsentForAllCategories(
    remoteConfig: RemoteConfig,
    value: boolean
): Record<string, boolean> {
    return Object.fromEntries(
        Object.keys(remoteConfig.translation.cookies).map((key) => [key, value])
    );
}

async function reportConsentEvent(eventFlags: Record<string, boolean>): Promise<void> {
    const config = Enforce._getConfig();
    const remoteConfig = Enforce._getRemoteConfig();

    if (!config || !remoteConfig) {
        return;
    }

    await sendReportingBeacon({
        config,
        remoteConfig,
        type: "consent",
        eventFlags,
    });
}

export function EnforceProvider({ children }: EnforceProviderProps) {
    const [remoteConfig, setRemoteConfig] = useState<RemoteConfig | null>(null);
    const [bannerVisible, setBannerVisible] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [currentConsent, setCurrentConsent] = useState<Record<string, boolean>>({});
    const pendingModalOpenRef = useRef(false);
    const bannerVisibleRef = useRef(false);

    useEffect(() => {
        bannerVisibleRef.current = bannerVisible;
    }, [bannerVisible]);

    // Register callbacks with the singleton
    useEffect(() => {
        Enforce._registerCallbacks({
            showBanner: () => {
                pendingModalOpenRef.current = false;
                
                setModalVisible(false);
                setBannerVisible(true);
                void reportConsentEvent({ BANNER_LOADED: true });
            },
            hideBanner: () => {
                pendingModalOpenRef.current = false;
                
                setBannerVisible(false);
            },
            showModal: () => {
                // Snapshot current consent so the modal toggles start at the right state
                Enforce.getConsent().then((c) => {
                    const nextConsent = c ?? {};
                    log(Enforce._getConfig()?.debug, "EnforceProvider showModal()", {
                        bannerVisible: bannerVisibleRef.current,
                        initialConsent: nextConsent,
                    });
                    setCurrentConsent(nextConsent);
                    if (Platform.OS === "ios" && bannerVisibleRef.current) {
                        pendingModalOpenRef.current = true;
                        
                        setBannerVisible(false);
                        return;
                    }

                    pendingModalOpenRef.current = false;
                    
                    setBannerVisible(false);
                    setModalVisible(true);
                    void reportConsentEvent({ MODAL_LOADED: true });
                })
                .catch((err) => {
                    console.warn("[CheqEnforce] showModal getConsent failed", err);
                });
            },
            hideModal: () => {
                pendingModalOpenRef.current = false;
                
                setModalVisible(false);
            },
            onRemoteConfigLoaded: (rc) => setRemoteConfig(rc),
        });
    }, [reportConsentEvent]);

    const handleBannerAcceptAll = useCallback(async () => {
        if (!remoteConfig) {
            return;
        }
        try {
            await Enforce._setConsent(buildConsentForAllCategories(remoteConfig, true), {
                BANNER_VIEWED: true,
            });
        } catch (err) {
            console.warn("[CheqEnforce] handleBannerAcceptAll: setConsent failed", err);
        }
    }, [remoteConfig]);

    const handleBannerRejectAll = useCallback(async () => {
        if (!remoteConfig) {
            return;
        }
        try {
            await Enforce._setConsent(buildConsentForAllCategories(remoteConfig, false), {
                BANNER_VIEWED: true,
            });
        } catch (err) {
            console.warn("[CheqEnforce] handleBannerRejectAll: setConsent failed", err);
        }
    }, [remoteConfig]);

    const handleModalAcceptAll = useCallback(async () => {
        if (!remoteConfig) {
            return;
        }
        try {
            await Enforce._setConsent(buildConsentForAllCategories(remoteConfig, true), {
                MODAL_VIEWED: true,
            });
        } catch (err) {
            console.warn("[CheqEnforce] handleModalAcceptAll: setConsent failed", err);
        }
    }, [remoteConfig]);

    const handleModalRejectAll = useCallback(async () => {
        if (!remoteConfig) {
            return;
        }
        try {
            await Enforce._setConsent(buildConsentForAllCategories(remoteConfig, false), {
                MODAL_VIEWED: true,
            });
        } catch (err) {
            console.warn("[CheqEnforce] handleModalRejectAll: setConsent failed", err);
        }
    }, [remoteConfig]);

    const handleOpenModal = useCallback(() => {
        void reportConsentEvent({ BANNER_VIEWED: true });
        Enforce.showModal();
    }, []);

    const handleBannerDismiss = useCallback(() => {
        if (!pendingModalOpenRef.current) {
            return;
        }

        pendingModalOpenRef.current = false;
        
        setModalVisible(true);
        void reportConsentEvent({ MODAL_LOADED: true });
    }, []);

    const handleBannerClose = useCallback(async () => {
        try {
            await Enforce._applyDefault({ BANNER_VIEWED: true });
        } catch (err) {
            console.warn("[CheqEnforce] handleBannerClose: applyDefault failed", err);
        }
    }, []);

    const handleModalSave = useCallback(async (consent: Record<string, boolean>) => {
        log(Enforce._getConfig()?.debug, "EnforceProvider handleModalSave()", consent);
        try {
            await Enforce._setConsent(consent, { MODAL_VIEWED: true });
        } catch (err) {
            console.warn("[CheqEnforce] handleModalSave: setConsent failed", err);
        }
    }, []);

    const handleModalClose = useCallback(async () => {
        try {
            await Enforce._applyDefault({ MODAL_VIEWED: true });
        } catch (err) {
            console.warn("[CheqEnforce] handleModalClose: applyDefault failed", err);
        }
    }, []);

    return (
        <>
            {children}

            {remoteConfig && (
                <>
                    <ConsentBanner
                        visible={bannerVisible}
                        translation={remoteConfig.translation}
                        bannerConfig={remoteConfig.bannerConfig}
                        onAcceptAll={handleBannerAcceptAll}
                        onRejectAll={handleBannerRejectAll}
                        onOpenModal={handleOpenModal}
                        onClose={handleBannerClose}
                        onDismiss={handleBannerDismiss}
                    />

                    <ConsentModal
                        visible={modalVisible}
                        translation={remoteConfig.translation}
                        modalConfig={remoteConfig.consentModalConfig}
                        initialConsent={currentConsent}
                        debug={Enforce._getConfig()?.debug}
                        onAcceptAll={handleModalAcceptAll}
                        onRejectAll={handleModalRejectAll}
                        onSave={handleModalSave}
                        onClose={handleModalClose}
                    />
                </>
            )}
        </>
    );
}
