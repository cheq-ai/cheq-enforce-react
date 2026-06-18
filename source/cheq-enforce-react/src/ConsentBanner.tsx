import React, { useEffect, useRef, useState } from "react";
import {
    Modal,
    type ModalProps,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";
import type { BannerConfig, Translation } from "./Types";

export interface ConsentBannerProps {
    visible: boolean;
    translation: Translation;
    bannerConfig: BannerConfig;
    onAcceptAll: () => void;
    onRejectAll: () => void;
    onOpenModal: () => void;
    onClose: () => void;
    onDismiss?: ModalProps["onDismiss"];
}

export function ConsentBanner({
    visible,
    translation,
    bannerConfig,
    onAcceptAll,
    onRejectAll,
    onOpenModal,
    onClose,
    onDismiss,
}: ConsentBannerProps) {
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);

    // Reset on every open so stale submitting state never blocks a fresh banner session.
    useEffect(() => {
        if (visible) {
            submittingRef.current = false;
            setSubmitting(false);
        }
    }, [visible]);

    function guard(fn: () => void): () => void {
        return () => {
            if (submittingRef.current) return;
            submittingRef.current = true;
            setSubmitting(true);
            fn();
        };
    }

    const showAcceptAll = bannerConfig.ensAcceptAll.show;
    const showRejectAll = bannerConfig.ensRejectAll.show;
    const showPreferences = bannerConfig.ensOpenModal.show;
    const showClose = bannerConfig.ensCloseBanner.show;

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
            onDismiss={onDismiss}
        >
            <View style={styles.overlay}>
                <View style={styles.container}>
                    <Text style={styles.content}>
                        {translation.notificationBannerContent}
                    </Text>

                    <View style={styles.actions}>
                        {showAcceptAll && (
                            <Pressable
                                style={({ pressed }) => [styles.button, styles.primaryButton, pressed && !submitting && styles.buttonPressed]}
                                onPress={guard(onAcceptAll)}
                                disabled={submitting}
                                accessibilityRole="button"
                            >
                                <Text style={styles.primaryButtonText}>
                                    {translation.notificationBannerAllowAll}
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
                                    {translation.notificationBannerDenyAll}
                                </Text>
                            </Pressable>
                        )}

                        {showPreferences && (
                            <Pressable
                                style={({ pressed }) => [styles.button, styles.secondaryButton, pressed && !submitting && styles.buttonPressed]}
                                onPress={guard(onOpenModal)}
                                disabled={submitting}
                                accessibilityRole="button"
                            >
                                <Text style={styles.secondaryButtonText}>
                                    {translation.notificationBannerPreferences}
                                </Text>
                            </Pressable>
                        )}

                        {showClose && (
                            <Pressable
                                style={({ pressed }) => [styles.closeButton, pressed && !submitting && styles.buttonPressed]}
                                onPress={guard(onClose)}
                                disabled={submitting}
                                accessibilityRole="button"
                                accessibilityLabel={translation.close}
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
    actions: {
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
