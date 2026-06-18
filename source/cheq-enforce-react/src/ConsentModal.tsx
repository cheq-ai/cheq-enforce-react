import React, { useEffect, useRef, useState } from "react";
import {
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    View,
} from "react-native";
import { log } from "./logger";
import type { ConsentModalConfig, Translation } from "./Types";

export interface ConsentModalProps {
    visible: boolean;
    translation: Translation;
    modalConfig: ConsentModalConfig;
    /** Current consent state when the modal opens */
    initialConsent: Record<string, boolean>;
    debug?: boolean;
    onAcceptAll: () => void;
    onRejectAll: () => void;
    onSave: (consent: Record<string, boolean>) => void;
    onClose: () => void;
}

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
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);

    // Reset local state only on the hidden→visible transition, not on every re-render
    // while the modal is already open (which would discard in-progress user toggles).
    React.useEffect(() => {
        const justOpened = visible && !wasVisibleRef.current;
        wasVisibleRef.current = visible;

        if (justOpened) {
            submittingRef.current = false;
            setSubmitting(false);
            const nextConsent = buildCompleteConsentState(translation, initialConsent);
            localConsentRef.current = nextConsent;
            log(debug, "ConsentModal initial state", nextConsent);
            setLocalConsent(nextConsent);
        }
    }, [visible, initialConsent, translation, debug]);

    function guard(fn: () => void): () => void {
        return () => {
            if (submittingRef.current) return;
            submittingRef.current = true;
            setSubmitting(true);
            fn();
        };
    }

    const categories = Object.entries(translation.cookies);

    const showAcceptAll = modalConfig.ensConsentAcceptAll.show;
    const showRejectAll = modalConfig.ensConsentRejectAll.show;
    const showSave = modalConfig.ensSaveModal.show;
    const showClose = modalConfig.ensCloseModal.show;

    const toggle = (key: string, value: boolean) => {
        setLocalConsent((prev) => {
            const next = { ...prev, [key]: value };
            localConsentRef.current = next;
            return next;
        });
    };

    const handleSave = () => {
        log(debug, "ConsentModal save payload", localConsentRef.current);
        onSave(localConsentRef.current);
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <View style={styles.container}>
                    {/* Header */}
                    <Text style={styles.title}>{translation.consentTitle}</Text>
                    <Text style={styles.description}>
                        {translation.consentDescription}
                    </Text>

                    {/* Category list */}
                    <ScrollView
                        style={styles.scroll}
                        contentContainerStyle={styles.scrollContent}
                        showsVerticalScrollIndicator={false}
                    >
                        {categories.map(([key, details]) => (
                            <View key={key} style={styles.categoryRow}>
                                <View style={styles.categoryText}>
                                    <Text style={styles.categoryTitle}>
                                        {details.title}
                                    </Text>
                                    {details.description ? (
                                        <Text style={styles.categoryDescription}>
                                            {details.description}
                                        </Text>
                                    ) : null}
                                </View>
                                <Switch
                                    value={localConsent[key] ?? false}
                                    onValueChange={(v) => toggle(key, v)}
                                    accessibilityLabel={details.title}
                                />
                            </View>
                        ))}
                    </ScrollView>

                    {/* Buttons */}
                    <View style={styles.actions}>
                        {showAcceptAll && (
                            <Pressable
                                style={({ pressed }) => [styles.button, styles.primaryButton, pressed && !submitting && styles.buttonPressed]}
                                onPress={guard(onAcceptAll)}
                                disabled={submitting}
                                accessibilityRole="button"
                            >
                                <Text style={styles.primaryButtonText}>
                                    {translation.consentModalAllowAll}
                                </Text>
                            </Pressable>
                        )}

                        {showRejectAll && (
                            <Pressable
                                style={({ pressed }) => [styles.button, styles.secondaryButton, pressed && !submitting && styles.buttonPressed]}
                                onPress={guard(onRejectAll)}
                                disabled={submitting}
                                accessibilityRole="button"
                            >
                                <Text style={styles.secondaryButtonText}>
                                    {translation.consentModalDenyAll}
                                </Text>
                            </Pressable>
                        )}

                        {showSave && (
                            <Pressable
                                style={({ pressed }) => [styles.button, styles.primaryButton, pressed && !submitting && styles.buttonPressed]}
                                onPress={guard(handleSave)}
                                disabled={submitting}
                                accessibilityRole="button"
                            >
                                <Text style={styles.primaryButtonText}>
                                    {translation.save}
                                </Text>
                            </Pressable>
                        )}

                        {showClose && (
                            <Pressable
                                style={({ pressed }) => [styles.closeButton, pressed && !submitting && styles.buttonPressed]}
                                onPress={guard(onClose)}
                                disabled={submitting}
                                accessibilityRole="button"
                            >
                                <Text style={styles.closeButtonText}>
                                    {translation.close}
                                </Text>
                            </Pressable>
                        )}
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
    title: {
        fontSize: 18,
        fontWeight: "700",
        color: "#111",
        marginBottom: 8,
    },
    description: {
        fontSize: 13,
        color: "#555",
        lineHeight: 18,
        marginBottom: 16,
    },
    scroll: {
        flexGrow: 0,
        maxHeight: 300,
    },
    scrollContent: {
        gap: 12,
        paddingBottom: 4,
    },
    categoryRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "#e0e0e0",
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
    button: {
        borderRadius: 8,
        paddingVertical: 12,
        paddingHorizontal: 16,
        alignItems: "center",
    },
    buttonPressed: {
        opacity: 0.7,
    },
    primaryButton: {
        backgroundColor: "#1a73e8",
    },
    primaryButtonText: {
        color: "#fff",
        fontWeight: "600",
        fontSize: 15,
    },
    secondaryButton: {
        backgroundColor: "#f0f0f0",
    },
    secondaryButtonText: {
        color: "#333",
        fontWeight: "500",
        fontSize: 15,
    },
    closeButton: {
        alignItems: "center",
        paddingVertical: 8,
    },
    closeButtonText: {
        color: "#888",
        fontSize: 13,
    },
});
