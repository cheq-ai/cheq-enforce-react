import React, { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    Platform,
} from "react-native";
import {
    Enforce,
    EnforceProvider,
    useConsent,
} from "cheq-enforce-react";

// ---------------------------------------------------------------------------
// Configuration — replace with your real values
// ---------------------------------------------------------------------------
const CLIENT_NAME = "demoretail";
const PUBLISH_PATH = "mobile_privacy_sdk";
const ENVIRONMENT = "English";

function parseConsentInput(input: string): {
    parsed: Record<string, boolean> | null;
    error: string | null;
} {
    const segments = input
        .split(",")
        .map((segment) => segment.trim())
        .filter(Boolean);

    if (segments.length === 0) {
        return {
            parsed: null,
            error: 'Enter one or more values like "Analytics: true".',
        };
    }

    const parsed: Record<string, boolean> = {};

    for (const segment of segments) {
        const separatorIndex = segment.indexOf(":");

        if (separatorIndex === -1) {
            return {
                parsed: null,
                error: `Invalid entry "${segment}". Use "Category: true" format.`,
            };
        }

        const key = segment.slice(0, separatorIndex).trim();
        const rawValue = segment.slice(separatorIndex + 1).trim().toLowerCase();

        if (!key) {
            return {
                parsed: null,
                error: `Invalid entry "${segment}". Category name is required.`,
            };
        }

        if (rawValue !== "true" && rawValue !== "false") {
            return {
                parsed: null,
                error: `Invalid boolean "${segment}". Use true or false.`,
            };
        }

        parsed[key] = rawValue === "true";
    }

    return { parsed, error: null };
}

// ---------------------------------------------------------------------------
// Inner app — has access to the EnforceProvider context
// ---------------------------------------------------------------------------
function InnerApp() {
    const { consent, loading } = useConsent();
    const [log, setLog] = useState<string[]>([]);
    const [environment, setEnvironment] = useState(ENVIRONMENT);
    const [environmentPending, setEnvironmentPending] = useState(false);
    const [environmentMessage, setEnvironmentMessage] = useState<string | null>(null);
    const [environmentError, setEnvironmentError] = useState<string | null>(null);
    const [checkConsentCategory, setCheckConsentCategory] = useState("");
    const [checkConsentMessage, setCheckConsentMessage] = useState<string | null>(null);
    const [consentCategory, setConsentCategory] = useState("");
    const [consentQueryMessage, setConsentQueryMessage] = useState<string | null>(null);
    const [consentUpdateInput, setConsentUpdateInput] = useState("");
    const [consentUpdateMessage, setConsentUpdateMessage] = useState<string | null>(null);
    const hasStoredConsent = Object.keys(consent).length > 0;

    const addLog = (msg: string) =>
        setLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 29)]);

    useEffect(() => {
        Enforce.onConsent((currentConsent) => {
            addLog(`onConsent 1: ${JSON.stringify(currentConsent)}`);
        });

        Enforce.onConsent((currentConsent) => {
            addLog(`onConsent 2: ${JSON.stringify(currentConsent)}`);
        });
    }, []);

    useEffect(() => {
        addLog("Configuring Enforce…");
        Enforce.configure({
            clientName: CLIENT_NAME,
            publishPath: PUBLISH_PATH,
            environment: ENVIRONMENT,
            debug: true,
            dataRetentionPeriod: 60000, // 30 s for demo — use 1 year in prod
            version: "1",
            defaultConsent: { Analytics: true, Marketing: false, Functional: true },
        })
            .then(() => addLog("configure() complete"))
            .catch((e: Error) => addLog(`configure() error: ${e.message}`));
    }, []);

    const handleShowBanner = () => {
        Enforce.showBanner();
        addLog("showBanner()");
    };

    const handleShowModal = () => {
        Enforce.showModal();
        addLog("showModal()");
    };

    const handleSetEnvironment = async () => {
        const nextEnvironment = environment.trim();

        if (!nextEnvironment) {
            const message = "Please enter an environment name.";
            setEnvironmentError(message);
            setEnvironmentMessage(null);
            addLog(`setEnvironment() error: ${message}`);
            return;
        }

        setEnvironmentPending(true);
        setEnvironmentError(null);
        setEnvironmentMessage(null);
        addLog(`setEnvironment("${nextEnvironment}") started`);

        try {
            await Enforce.setEnvironment(nextEnvironment);
            setEnvironmentMessage(`Environment updated to "${nextEnvironment}".`);
            addLog(`setEnvironment("${nextEnvironment}") complete`);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            setEnvironmentError("Unable to retrieve Environment - it may not exist");
            addLog(`setEnvironment("${nextEnvironment}") error: ${message}`);
        } finally {
            setEnvironmentPending(false);
        }
    };

    const handleClearConsent = async () => {
        await Enforce.clearConsent();
        addLog("clearConsent()");
    };

    const handleCheckConsent = async () => {
        const category = checkConsentCategory.trim();

        if (!category) {
            const message = 'Enter a category name before tapping "Check Consent".';
            setCheckConsentMessage(message);
            addLog(`checkConsent() error: ${message}`);
            return;
        }

        try {
            const result = await Enforce.checkConsent(category);
            const message = `checkConsent("${category}"): ${result}`;
            setCheckConsentMessage(message);
            addLog(message);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            setCheckConsentMessage(`checkConsent() failed: ${message}`);
            addLog(`checkConsent() error: ${message}`);
        }
    };

    const handleGetConsent = async () => {
        const rawInput = consentCategory.trim();
        const requestedCategories = rawInput
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);

        try {
            let result: Record<string, boolean>;
            let label: string;

            if (!rawInput) {
                result = await Enforce.getConsent();
                label = "getConsent()";
            } else if (requestedCategories.length === 1) {
                result = await Enforce.getConsent(requestedCategories[0]);
                label = `getConsent("${requestedCategories[0]}")`;
            } else {
                result = await Enforce.getConsent(requestedCategories);
                label = `getConsent(${JSON.stringify(requestedCategories)})`;
            }

            const formattedResult = JSON.stringify(result);
            const message = `${label}: ${formattedResult}`;
            setConsentQueryMessage(message);
            addLog(message);

            if (Object.keys(result).length === 0) {
                addLog(`${label} returned no matching consent values.`);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            setConsentQueryMessage(`getConsent() failed: ${message}`);
            addLog(`getConsent() error: ${message}`);
        }
    };

    const handleSetConsent = async () => {
        const { parsed, error } = parseConsentInput(consentUpdateInput);

        if (!parsed || error) {
            const message = error ?? "Unable to parse consent input.";
            setConsentUpdateMessage(message);
            addLog(`setConsent() error: ${message}`);
            return;
        }

        const formattedConsent = JSON.stringify(parsed);
        setConsentUpdateMessage(null);
        addLog(`setConsent(${formattedConsent})`);

        try {
            await Enforce.setConsent(parsed);
            const message = `setConsent() complete: ${formattedConsent}`;
            setConsentUpdateMessage(message);
            addLog(message);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            setConsentUpdateMessage(`setConsent() failed: ${message}`);
            addLog(`setConsent() error: ${message}`);
        }
    };

    return (
        <ScrollView
            style={styles.page}
            contentContainerStyle={styles.pageContent}
            keyboardShouldPersistTaps="handled"
        >
            {/* Consent state */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>Consent State</Text>
                {loading ? (
                    <Text style={styles.value}>Loading…</Text>
                ) : hasStoredConsent ? (
                    Object.entries(consent).map(([k, v]) => (
                        <View key={k} style={styles.row}>
                            <Text style={styles.label}>{k}</Text>
                            <Text style={[styles.badge, v ? styles.badgeOn : styles.badgeOff]}>
                                {v ? "Allowed" : "Denied"}
                            </Text>
                        </View>
                    ))
                ) : (
                    <Text style={styles.value}>No consent stored</Text>
                )}
            </View>

            {/* Actions */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>Actions</Text>
                <View style={styles.actions}>
                    <ActionButton text="Show Banner" onPress={handleShowBanner} />
                    <ActionButton text="Show Modal" onPress={handleShowModal} />
                    <View style={styles.environmentSection}>
                        <Text style={styles.inputLabel}>Environment</Text>
                        <TextInput
                            value={environment}
                            onChangeText={setEnvironment}
                            editable={!environmentPending}
                            placeholder="Enter environment"
                            autoCapitalize="none"
                            autoCorrect={false}
                            style={[
                                styles.input,
                                environmentPending && styles.inputDisabled,
                                environmentError && styles.inputError,
                            ]}
                        />
                        <ActionButton
                            text={environmentPending ? "Updating..." : "Set Environment"}
                            onPress={handleSetEnvironment}
                            disabled={environmentPending}
                            accessory={environmentPending ? <ActivityIndicator color="#fff" size="small" /> : null}
                        />
                        {environmentMessage ? (
                            <Text style={styles.successMessage}>{environmentMessage}</Text>
                        ) : null}
                        {environmentError ? (
                            <Text style={styles.errorMessage}>{environmentError}</Text>
                        ) : null}
                    </View>
                    <View style={styles.environmentSection}>
                        <Text style={styles.inputLabel}>Check Consent</Text>
                        <TextInput
                            value={checkConsentCategory}
                            onChangeText={(value) => {
                                setCheckConsentCategory(value);
                                setCheckConsentMessage(null);
                            }}
                            placeholder="Analytics"
                            autoCapitalize="none"
                            autoCorrect={false}
                            style={styles.input}
                        />
                        <ActionButton
                            text="Check Consent"
                            onPress={handleCheckConsent}
                            disabled={!checkConsentCategory.trim()}
                        />
                        {checkConsentMessage ? (
                            <Text style={styles.value}>{checkConsentMessage}</Text>
                        ) : null}
                    </View>
                    <View style={styles.environmentSection}>
                        <Text style={styles.inputLabel}>Get Consent</Text>
                        <TextInput
                            value={consentCategory}
                            onChangeText={(value) => {
                                setConsentCategory(value);
                                setConsentQueryMessage(null);
                            }}
                            placeholder="Analytics, Advertising"
                            autoCapitalize="none"
                            autoCorrect={false}
                            style={styles.input}
                        />
                        <ActionButton text="Get Consent" onPress={handleGetConsent} />
                        {consentQueryMessage ? (
                            <Text style={styles.value}>{consentQueryMessage}</Text>
                        ) : null}
                    </View>
                    <View style={styles.environmentSection}>
                        <Text style={styles.inputLabel}>Set Consent</Text>
                        <TextInput
                            value={consentUpdateInput}
                            onChangeText={(value) => {
                                setConsentUpdateInput(value);
                                setConsentUpdateMessage(null);
                            }}
                            placeholder="Analytics: true, Marketing: false"
                            autoCapitalize="none"
                            autoCorrect={false}
                            style={styles.input}
                        />
                        <ActionButton
                            text="Set Consent"
                            onPress={handleSetConsent}
                            disabled={!consentUpdateInput.trim()}
                        />
                        {consentUpdateMessage ? (
                            <Text style={styles.value}>{consentUpdateMessage}</Text>
                        ) : null}
                    </View>
                    <ActionButton text="Clear Consent" onPress={handleClearConsent} danger />
                </View>
            </View>

            {/* Log */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>Log</Text>
                {log.map((entry, i) => (
                    <Text key={i} style={styles.logEntry}>
                        {entry}
                    </Text>
                ))}
            </View>
        </ScrollView>
    );
}

// ---------------------------------------------------------------------------
// Root — wraps everything with EnforceProvider
// ---------------------------------------------------------------------------
export default function App() {
    useEffect(() => {
        if (Platform.OS !== "web") return;
        void Enforce.configure({
            clientName: CLIENT_NAME,
            publishPath: PUBLISH_PATH,
            environment: ENVIRONMENT,
            debug: true,
            dataRetentionPeriod: 60000,
            version: "1",
            defaultConsent: { Analytics: true, Marketing: false, Functional: true },
        }).catch((e: unknown) => {
            console.error('[CheqEnforce] configure failed on web', e);
        });
    }, []);

    if (Platform.OS === "web") {
        return <View style={{ flex: 1, backgroundColor: "#fff" }} />;
    }

    return (
        <EnforceProvider>
            <InnerApp />
        </EnforceProvider>
    );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function ActionButton({
    text,
    onPress,
    danger,
    disabled,
    accessory,
}: {
    text: string;
    onPress: () => void;
    danger?: boolean;
    disabled?: boolean;
    accessory?: React.ReactNode;
}) {
    return (
        <Pressable
            style={({ pressed }) => [
                styles.button,
                danger && styles.buttonDanger,
                disabled && styles.buttonDisabled,
                pressed && !disabled && styles.buttonPressed,
            ]}
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
        >
            <View style={styles.buttonContent}>
                {accessory}
                <Text style={[styles.buttonText, danger && styles.buttonTextDanger]}>
                    {text}
                </Text>
            </View>
        </Pressable>
    );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
    page: {
        flex: 1,
        backgroundColor: "#f5f5f7",
    },
    pageContent: {
        paddingTop: 56,
        paddingHorizontal: 16,
        paddingBottom: 80,
        gap: 16,
    },
    card: {
        backgroundColor: "#fff",
        borderRadius: 12,
        padding: 16,
        gap: 10,
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
    },
    cardTitle: {
        fontSize: 16,
        fontWeight: "700",
        color: "#111",
        marginBottom: 4,
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    label: {
        fontSize: 14,
        color: "#333",
    },
    value: {
        fontSize: 14,
        color: "#555",
    },
    badge: {
        fontSize: 12,
        fontWeight: "600",
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
        overflow: "hidden",
    },
    badgeOn: {
        backgroundColor: "#d4edda",
        color: "#155724",
    },
    badgeOff: {
        backgroundColor: "#f8d7da",
        color: "#721c24",
    },
    actions: {
        gap: 10,
    },
    environmentSection: {
        gap: 8,
    },
    inputLabel: {
        fontSize: 13,
        fontWeight: "600",
        color: "#333",
    },
    input: {
        borderWidth: 1,
        borderColor: "#cfd4dc",
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 12,
        fontSize: 14,
        color: "#111",
        backgroundColor: "#fff",
    },
    inputDisabled: {
        backgroundColor: "#f3f4f6",
        color: "#777",
    },
    inputError: {
        borderColor: "#dc3545",
    },
    successMessage: {
        fontSize: 13,
        color: "#1f7a1f",
    },
    errorMessage: {
        fontSize: 13,
        color: "#b42318",
    },
    button: {
        backgroundColor: "#1a73e8",
        borderRadius: 8,
        paddingVertical: 12,
        paddingHorizontal: 16,
        alignItems: "center",
    },
    buttonContent: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    buttonDanger: {
        backgroundColor: "#fff",
        borderWidth: 1,
        borderColor: "#dc3545",
    },
    buttonDisabled: {
        opacity: 0.75,
    },
    buttonPressed: {
        opacity: 0.7,
    },
    buttonText: {
        color: "#fff",
        fontWeight: "600",
        fontSize: 15,
    },
    buttonTextDanger: {
        color: "#dc3545",
    },
    logEntry: {
        fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
        fontSize: 11,
        color: "#444",
        lineHeight: 16,
    },
});
