# CHEQ Enforce React

Consent management SDK for React and React Native applications. This package enables CHEQ's privacy notice and consent modal capabilities, with persistent consent storage across web and mobile platforms.

## Installation

```bash
npm install cheq-enforce-react
```

## Requirements

- React 17 or higher
- For React Native: Expo or bare React Native project

## Quick Start

```javascript
import { Enforce, EnforceProvider } from "cheq-enforce-react";

// Wrap your app with EnforceProvider to enable the banner and modal UI
export default function App() {
    return (
        <EnforceProvider>
            <YourApp />
        </EnforceProvider>
    );
}

// Configure the SDK — call this once on app start
await Enforce.configure({
    clientName: "your_client_name",
    publishPath: "your_publish_path",
    environment: "English",
});
```

## Configuration

```javascript
await Enforce.configure({
    clientName: "your_client_name",         // required
    publishPath: "your_publish_path",       // required
    environment: "English",                 // required
    debug: false,                           // enable verbose logging
    dataRetentionPeriod: 31_536_000_000,    // ms until stored consent expires (default: 1 year)
    autoShow: true,                         // auto-show banner/modal if no consent stored (default: true)
    version: "1",                           // bump to invalidate previously stored consent
    defaultConsent: {                       // fallback values used when network is unavailable
        Analytics: true,
        Marketing: false,
        Functional: true,
    },
});
```

## Reading Consent

### React hook (recommended)

Use `useConsent()` inside any component wrapped by `<EnforceProvider>`. It re-renders automatically whenever consent changes.

```javascript
import { useConsent } from "cheq-enforce-react";

function MyComponent() {
    const { consent, checkConsent, loading } = useConsent();

    if (loading) return <LoadingSpinner />;

    return (
        <View>
            <Text>Analytics: {consent.Analytics ? "allowed" : "denied"}</Text>
            <Text>Marketing allowed: {String(checkConsent("Marketing"))}</Text>
        </View>
    );
}
```

### Imperative API

```javascript
// Get all consent categories
const consent = await Enforce.getConsent();
// { Analytics: true, Marketing: false }

// Get a single category
const result = await Enforce.getConsent("Analytics");
// { Analytics: true }

// Get multiple categories
const result = await Enforce.getConsent(["Analytics", "Marketing"]);
// { Analytics: true, Marketing: false }

// Check a single category — returns a boolean directly
const allowed = await Enforce.checkConsent("Analytics");
// true
```

Missing categories default to `false` rather than throwing.

## Writing Consent

```javascript
// Set one or more categories — merges with existing stored consent
await Enforce.setConsent({ Analytics: true, Marketing: false });

// Clear all stored consent
await Enforce.clearConsent();
```

## Listening for Consent Changes

```javascript
// Fires with the full consent map whenever consent is set or loaded
Enforce.onConsent((consent) => {
    console.log("Consent updated:", consent);
});
```

Multiple handlers can be registered; each is called independently.

## Banner and Modal

The banner and modal are rendered automatically by `<EnforceProvider>` based on your remote configuration. You can also trigger them manually:

```javascript
Enforce.showBanner();
Enforce.showModal();
```

## Switching Environments

Change the active environment after initial configure. The SDK validates the new environment by fetching its remote config before committing the change.

```javascript
try {
    await Enforce.setEnvironment("French");
} catch (e) {
    console.error("Environment not found or unavailable");
}
```

The previous environment and config are preserved if the request fails.

## Offline / Network Failure Behaviour

When `configure()` cannot reach the remote config endpoint, the SDK falls back in this order:

1. **Stored consent** — if valid (not expired, version matches), it is used as-is and consent handlers are notified.
2. **`defaultConsent`** — if provided in config and no valid stored consent exists, it is used as a runtime-only fallback. It is never written to storage.
3. **Empty** — `getConsent()` returns `{}` and `checkConsent()` returns `false`.

The fallback is cleared on the next successful `configure()` call.

## API Reference

### `Enforce`

| Method | Description |
|--------|-------------|
| `configure(config)` | Initialise the SDK and fetch remote config |
| `setEnvironment(env)` | Switch to a different environment |
| `getConsent(selection?)` | Return consent categories (all, single string, or string array) |
| `checkConsent(category)` | Return `true` if the given category is consented to |
| `setConsent(categories)` | Persist consent for one or more categories |
| `clearConsent()` | Remove all stored consent |
| `onConsent(handler)` | Register a callback fired on consent load or update |
| `showBanner()` | Show the privacy notice banner |
| `showModal()` | Show the consent modal |

### `EnforceConfig`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `clientName` | `string` | required | Your CHEQ client identifier |
| `publishPath` | `string` | required | Publication path in the CHEQ API |
| `environment` | `string` | required | Environment label (e.g. `"English"`) |
| `debug` | `boolean` | `false` | Enable verbose debug logging |
| `dataRetentionPeriod` | `number` | `31_536_000_000` | Consent validity period in milliseconds |
| `autoShow` | `boolean` | `true` | Auto-show banner/modal when no valid consent exists |
| `version` | `string` | `"1"` | Bump to invalidate previously stored consent |
| `defaultConsent` | `Record<string, boolean>` | — | Fallback consent when the network is unavailable |

### `useConsent()`

| Return value | Type | Description |
|--------------|------|-------------|
| `consent` | `Record<string, boolean>` | Full consent map; empty object if none stored |
| `checkConsent` | `(category: string) => boolean` | Synchronous check against the current consent map |
| `loading` | `boolean` | `true` while consent is being loaded on first render |

## Error Handling

The SDK throws `EnforceError` with a `kind` discriminator for programmatic handling:

```javascript
import { EnforceError } from "cheq-enforce-react";

try {
    await Enforce.setConsent({ Analytics: true });
} catch (e) {
    if (e instanceof EnforceError) {
        console.error(e.kind); // "notConfigured" | "invalidConfig" | "networkError" | "parseError"
    }
}
```

## Platform Support

- React (Web) — uses `localStorage`
- React Native (iOS) — uses `@react-native-async-storage/async-storage`
- React Native (Android) — uses `@react-native-async-storage/async-storage`
- Expo

## Optional Peer Dependencies

For React Native, install the async storage adapter:

```bash
npm install @react-native-async-storage/async-storage
```

On web, the SDK uses `localStorage` automatically. The async storage peer dependency is optional for web-only projects.

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.

## Support

For support, contact [support@cheq.ai](mailto:support@cheq.ai)
