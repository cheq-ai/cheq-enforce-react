import React, { useMemo, useRef, useState } from "react";
import {
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    View,
} from "react-native";
import { ConsentButton, type ButtonDescriptor } from "./ConsentButton";
import { ConsentLogo } from "./ConsentLogo";
import { log, warn } from "./logger";
import { useSubmitGuard } from "./useSubmitGuard";
import { DEFAULT_RESOLVED_THEME, orderVisibleButtons, withScaledLineHeight } from "./ThemeResolver";
import type { ModalButtonName, ResolvedModalTheme } from "./ThemeTypes";
import type { ConsentModalConfig, Translation } from "./Types";

export interface ConsentModalProps {
    visible: boolean;
    translation: Translation;
    modalConfig: ConsentModalConfig;
    /** Current consent state when the modal opens */
    initialConsent: Record<string, boolean>;
    /** Resolved theme overrides. Omit for the default appearance. */
    theme?: ResolvedModalTheme;
    debug?: boolean;
    onAcceptAll: () => void | Promise<void>;
    onRejectAll: () => void | Promise<void>;
    onSave: (consent: Record<string, boolean>) => void | Promise<void>;
    onClose: () => void | Promise<void>;
}

// Base font metrics of the modal description text (styles.description below).
const DESCRIPTION_BASE_FONT_SIZE = 13;
const DESCRIPTION_BASE_LINE_HEIGHT = 18;

// Status-bar headroom for the fullScreen presentation (kept as a simple
// platform constant to avoid a safe-area dependency).
const FULLSCREEN_TOP_PADDING = Platform.select({ ios: 64, android: 32, default: 24 });

// Android otherwise tints the switch thumb with the host app's theme accent.
// White matches the native iOS switch thumb.
const ANDROID_THUMB_COLOR = "#FFFFFF";

function buildCompleteConsentState(
    translation: Translation,
    initialConsent: Record<string, boolean>
): Record<string, boolean> {
    return Object.fromEntries(
        Object.keys(translation.cookies).map((key) => [key, initialConsent[key] ?? false])
    );
}

export function ConsentModal({
    visible,
    translation,
    modalConfig,
    initialConsent,
    theme,
    debug,
    onAcceptAll,
    onRejectAll,
    onSave,
    onClose,
}: ConsentModalProps) {
    const [localConsent, setLocalConsent] = useState<Record<string, boolean>>(
        () => buildCompleteConsentState(translation, initialConsent)
    );
    const localConsentRef = useRef(localConsent);
    const wasVisibleRef = useRef(false);
    const { submitting, guard, handleRequestClose, reset } = useSubmitGuard(onClose);

    // Reset local state only on the hidden→visible transition, not on every re-render
    // while the modal is already open (which would discard in-progress user toggles).
    React.useEffect(() => {
        const justOpened = visible && !wasVisibleRef.current;
        wasVisibleRef.current = visible;

        if (justOpened) {
            reset();
            const nextConsent = buildCompleteConsentState(translation, initialConsent);
            localConsentRef.current = nextConsent;
            log(debug, "ConsentModal initial state", nextConsent);
            setLocalConsent(nextConsent);
        }
    }, [visible, initialConsent, translation, debug, reset]);

    const t = theme ?? DEFAULT_RESOLVED_THEME.modal;
    const fullScreen = t.presentationStyle === "fullScreen";

    const categories = Object.entries(translation.cookies);

    const showAcceptAll = modalConfig.ensConsentAcceptAll.show;
    const showRejectAll = modalConfig.ensConsentRejectAll.show;
    const showSave = modalConfig.ensSaveModal.show;
    const showClose = modalConfig.ensCloseModal.show;

    // Which buttons appear is remote-config controlled; the theme only orders
    // and styles them. Memoized so hidden-button skips are logged once.
    const orderedButtons = useMemo(
        () =>
            orderVisibleButtons(
                t.buttonOrder,
                {
                    acceptAll: showAcceptAll,
                    rejectAll: showRejectAll,
                    save: showSave,
                    close: showClose,
                },
                (name) => warn(debug, `theme: modal button "${name}" is hidden by the remote config — skipping`)
            ),
        [t.buttonOrder, showAcceptAll, showRejectAll, showSave, showClose, debug]
    );

    const toggle = (key: string, value: boolean) => {
        setLocalConsent((prev) => {
            const next = { ...prev, [key]: value };
            localConsentRef.current = next;
            return next;
        });
    };

    const handleSave = () => {
        log(debug, "ConsentModal save payload", localConsentRef.current);
        return onSave(localConsentRef.current);
    };

    const descriptors: Record<ModalButtonName, ButtonDescriptor> = {
        acceptAll: {
            role: "primary",
            label: translation.consentModalAllowAll,
            onPress: onAcceptAll,
        },
        rejectAll: {
            // Same styling as acceptAll: accepting and rejecting must be
            // equally prominent choices (GDPR).
            role: "primary",
            label: translation.consentModalDenyAll,
            onPress: onRejectAll,
        },
        save: {
            role: "secondary",
            label: translation.save,
            onPress: handleSave,
        },
        close: {
            role: "textOnly",
            label: translation.cancel,
            onPress: onClose,
        },
    };

    // The "on" color defaults to the primary button blue; the "off" color
    // keeps the untinted native look unless themed.
    const trackColor = {
        true: t.categories.toggleOnColor ?? "#1a73e8",
        ...(t.categories.toggleOffColor !== undefined && {
            false: t.categories.toggleOffColor,
        }),
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={handleRequestClose}
        >
            <View
                style={[
                    styles.overlay,
                    t.overlayColor !== undefined && { backgroundColor: t.overlayColor },
                    fullScreen && styles.overlayFullScreen,
                ]}
            >
                <View
                    style={[
                        styles.container,
                        t.backgroundColor !== undefined && { backgroundColor: t.backgroundColor },
                        fullScreen && styles.containerFullScreen,
                    ]}
                >
                    {/* Everything except the buttons scrolls together. */}
                    <ScrollView
                        style={[styles.scroll, fullScreen && styles.scrollFullScreen]}
                        contentContainerStyle={styles.scrollContent}
                        showsVerticalScrollIndicator={false}
                    >
                        {t.logo && (
                            <View style={styles.logoWrapper}>
                                <ConsentLogo logo={t.logo} />
                            </View>
                        )}

                        {/* Header */}
                        <Text style={[styles.title, t.summaryTitle]}>
                            {translation.consentTitle}
                        </Text>
                        <Text
                            style={[
                                styles.description,
                                withScaledLineHeight(
                                    t.summaryDescription,
                                    DESCRIPTION_BASE_FONT_SIZE,
                                    DESCRIPTION_BASE_LINE_HEIGHT
                                ),
                            ]}
                        >
                            {translation.consentDescription}
                        </Text>

                        {t.separatorColor !== undefined && (
                            <View
                                style={[styles.separator, { backgroundColor: t.separatorColor }]}
                            />
                        )}

                        {/* Category list */}
                        <View style={styles.categories}>
                            {categories.map(([key, details], index) => (
                                <View
                                    key={key}
                                    style={[
                                        styles.categoryRow,
                                        t.categories.separatorColor !== undefined &&
                                            index < categories.length - 1 && {
                                                borderBottomWidth: StyleSheet.hairlineWidth,
                                                borderBottomColor: t.categories.separatorColor,
                                            },
                                    ]}
                                >
                                    <View style={styles.categoryText}>
                                        <Text style={[styles.categoryTitle, t.categories.title]}>
                                            {details.title}
                                        </Text>
                                        {details.description ? (
                                            <Text
                                                style={[
                                                    styles.categoryDescription,
                                                    t.categories.description,
                                                ]}
                                            >
                                                {details.description}
                                            </Text>
                                        ) : null}
                                    </View>
                                    <Switch
                                        value={localConsent[key] ?? false}
                                        onValueChange={(v) => toggle(key, v)}
                                        accessibilityLabel={details.title}
                                        trackColor={trackColor}
                                        thumbColor={Platform.OS === "android" ? ANDROID_THUMB_COLOR : undefined}
                                    />
                                </View>
                            ))}
                        </View>
                    </ScrollView>

                    {/* Buttons */}
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
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "rgba(0,0,0,0.55)",
        paddingHorizontal: 16,
    },
    overlayFullScreen: {
        paddingHorizontal: 0,
    },
    container: {
        width: "100%",
        maxWidth: 480,
        maxHeight: "80%",
        backgroundColor: "#fff",
        borderRadius: 12,
        paddingHorizontal: 20,
        paddingTop: 24,
        paddingBottom: 20,
    },
    containerFullScreen: {
        maxWidth: "100%",
        height: "100%",
        maxHeight: "100%",
        borderRadius: 0,
        paddingTop: FULLSCREEN_TOP_PADDING,
    },
    logoWrapper: {
        marginBottom: 12,
    },
    title: {
        fontSize: 18,
        fontWeight: "700",
        color: "#111",
        textAlign: "center",
        marginBottom: 8,
    },
    description: {
        fontSize: 13,
        color: "#555",
        lineHeight: 18,
        marginBottom: 16,
    },
    scroll: {
        // Sized by content, shrinking (= scrolling) when the container hits
        // its maxHeight. The buttons below never scroll.
        flexGrow: 0,
        flexShrink: 1,
    },
    scrollFullScreen: {
        flexGrow: 1,
    },
    scrollContent: {
        paddingBottom: 4,
    },
    categories: {
        gap: 12,
    },
    separator: {
        height: StyleSheet.hairlineWidth,
        marginBottom: 16,
    },
    categoryRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        paddingVertical: 8,
    },
    categoryText: {
        flex: 1,
    },
    categoryTitle: {
        fontSize: 14,
        fontWeight: "600",
        color: "#222",
    },
    categoryDescription: {
        fontSize: 12,
        color: "#777",
        marginTop: 2,
    },
    actions: {
        marginTop: 16,
        gap: 10,
    },
});
