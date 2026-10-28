import React, { useEffect, useMemo } from "react";
import {
    Modal,
    type ModalProps,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { ConsentButton, type ButtonDescriptor } from "./ConsentButton";
import { ConsentLogo } from "./ConsentLogo";
import { warn } from "./logger";
import { useSubmitGuard } from "./useSubmitGuard";
import { DEFAULT_RESOLVED_THEME, orderVisibleButtons, withScaledLineHeight } from "./ThemeResolver";
import type { BannerButtonName, ResolvedBannerTheme } from "./ThemeTypes";
import type { BannerConfig, Translation } from "./Types";

export interface ConsentBannerProps {
    visible: boolean;
    translation: Translation;
    bannerConfig: BannerConfig;
    /** Resolved theme overrides. Omit for the default appearance. */
    theme?: ResolvedBannerTheme;
    debug?: boolean;
    onAcceptAll: () => void | Promise<void>;
    onRejectAll: () => void | Promise<void>;
    onOpenModal: () => void | Promise<void>;
    onClose: () => void | Promise<void>;
    onDismiss?: ModalProps["onDismiss"];
}

// Base font metrics of the banner content text (styles.content below) —
// used to keep a themed fontSize from clipping against the baked lineHeight.
const CONTENT_BASE_FONT_SIZE = 14;
const CONTENT_BASE_LINE_HEIGHT = 20;

export function ConsentBanner({
    visible,
    translation,
    bannerConfig,
    theme,
    debug,
    onAcceptAll,
    onRejectAll,
    onOpenModal,
    onClose,
    onDismiss,
}: ConsentBannerProps) {
    const { submitting, guard, handleRequestClose, reset } = useSubmitGuard(onClose);

    // Reset on every open so stale submitting state never blocks a fresh banner session.
    useEffect(() => {
        if (visible) reset();
    }, [visible, reset]);

    const t = theme ?? DEFAULT_RESOLVED_THEME.banner;

    const showAcceptAll = bannerConfig.ensAcceptAll.show;
    const showRejectAll = bannerConfig.ensRejectAll.show;
    const showPreferences = bannerConfig.ensOpenModal.show;
    const showClose = bannerConfig.ensCloseBanner.show;

    // Which buttons appear is remote-config controlled; the theme only orders
    // and styles them. Memoized so hidden-button skips are logged once.
    const orderedButtons = useMemo(
        () =>
            orderVisibleButtons(
                t.buttonOrder,
                {
                    acceptAll: showAcceptAll,
                    rejectAll: showRejectAll,
                    openModal: showPreferences,
                    close: showClose,
                },
                (name) => warn(debug, `theme: banner button "${name}" is hidden by the remote config — skipping`)
            ),
        [t.buttonOrder, showAcceptAll, showRejectAll, showPreferences, showClose, debug]
    );

    const descriptors: Record<BannerButtonName, ButtonDescriptor> = {
        acceptAll: {
            role: "primary",
            label: translation.notificationBannerAllowAll,
            onPress: onAcceptAll,
        },
        rejectAll: {
            // Same styling as acceptAll: accepting and rejecting must be
            // equally prominent choices (GDPR).
            role: "primary",
            label: translation.notificationBannerDenyAll,
            onPress: onRejectAll,
        },
        openModal: {
            role: "secondary",
            label: translation.notificationBannerPreferences,
            onPress: onOpenModal,
        },
        close: {
            role: "textOnly",
            label: translation.close,
            onPress: onClose,
            accessibilityLabel: translation.close,
        },
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={handleRequestClose}
            onDismiss={onDismiss}
        >
            <View
                style={[
                    styles.overlay,
                    t.overlayColor !== undefined && { backgroundColor: t.overlayColor },
                ]}
            >
                <View
                    style={[
                        styles.container,
                        t.backgroundColor !== undefined && { backgroundColor: t.backgroundColor },
                    ]}
                >
                    {t.logo && <ConsentLogo logo={t.logo} />}

                    <Text
                        style={[
                            styles.content,
                            withScaledLineHeight(
                                t.summaryDescription,
                                CONTENT_BASE_FONT_SIZE,
                                CONTENT_BASE_LINE_HEIGHT
                            ),
                        ]}
                    >
                        {translation.notificationBannerContent}
                    </Text>

                    {t.separatorColor !== undefined && (
                        <View style={[styles.separator, { backgroundColor: t.separatorColor }]} />
                    )}

                    <View style={styles.actions}>
                        {orderedButtons.map((name) => {
                            const descriptor = descriptors[name];
                            return (
                                <ConsentButton
                                    key={name}
                                    label={descriptor.label}
                                    role={descriptor.role}
                                    themed={t.buttons[name]}
                                    disabled={submitting}
                                    onPress={guard(descriptor.onPress)}
                                    accessibilityLabel={descriptor.accessibilityLabel}
                                />
                            );
                        })}
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: "flex-end",
        backgroundColor: "rgba(0,0,0,0.45)",
    },
    container: {
        backgroundColor: "#fff",
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 32,
        gap: 12,
    },
    content: {
        fontSize: 14,
        color: "#333",
        lineHeight: 20,
    },
    separator: {
        height: StyleSheet.hairlineWidth,
    },
    actions: {
        gap: 10,
    },
});
