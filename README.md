# CHEQ Enforce React

Consent management SDK for React and React Native applications. This package enables CHEQ's privacy notice and consent modal capabilities, with persistent consent storage across web and mobile platforms.

## Installation

```bash
npm install @cheq.ai/cheq-enforce-react
```

## Requirements

- React 17 or higher
- For React Native: Expo or bare React Native project

## Quick Start

```javascript
import { Enforce, EnforceProvider } from "@cheq.ai/cheq-enforce-react";

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
    theme: require("./enforce_theme.json"), // optional custom consent-UI theme (native only)
});
```

## Reading Consent

### React hook (recommended)

Use `useConsent()` inside any component wrapped by `<EnforceProvider>`. It re-renders automatically whenever consent changes.

```javascript
import { useConsent } from "@cheq.ai/cheq-enforce-react";

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
await Enforce.showBanner();
await Enforce.showModal();
```

Manual triggers re-fetch the remote configuration first so the UI presents the latest translations and button configuration. If the refresh fails (e.g. offline), the previously fetched configuration is used — showing the UI never fails on a network error.

## Theming (React Native)

Customize the appearance of the banner and modal by passing a `theme` to `configure()` — either as an object or from a bundled JSON file (conventionally named `enforce_theme.json`):

```javascript
await Enforce.configure({
    clientName: "your_client_name",
    publishPath: "your_publish_path",
    environment: "English",
    theme: require("./enforce_theme.json"),
});
```

Theming is **native only**: on web the consent UI is not rendered by this SDK, so the theme is ignored (a debug log notes this).

### Theme structure

Every key is optional — `{}` is a valid theme and renders the default appearance. All unset values fall back to the SDK's current default styling.

```json
{
    "banner": {
        "logoUrl": "https://example.com/logo.png",
        "logoImage": "",
        "logoAlignment": "center",
        "backgroundColor": "#FFFFFF",
        "separatorColor": "#E5E5E5",
        "overlayColor": "#00000080",
        "summary": {
            "description": { "fontName": "", "fontSize": 14, "fontWeight": "regular", "textAlignment": "natural", "textColor": "#333333" }
        },
        "buttons": {
            "order": ["acceptAll", "rejectAll", "openModal", "close"],
            "acceptAll": { "backgroundColor": "#1A73E8", "textColor": "#FFFFFF" },
            "rejectAll": {},
            "openModal": {},
            "close": {},
            "global": { "borderRadius": 8, "fontSize": 15 }
        }
    },
    "modal": {
        "presentationStyle": "card",
        "logoUrl": "",
        "logoImage": "",
        "logoAlignment": "center",
        "backgroundColor": "#FFFFFF",
        "separatorColor": "#E0E0E0",
        "overlayColor": "#00000080",
        "summary": {
            "title": { "fontSize": 18, "fontWeight": "bold" },
            "description": { "fontSize": 13 }
        },
        "buttons": {
            "order": ["acceptAll", "rejectAll", "save", "close"],
            "acceptAll": {},
            "rejectAll": {},
            "save": {},
            "close": {},
            "global": {}
        },
        "categories": {
            "toggleOnColor": "#1A73E8",
            "toggleOffColor": "#D9D9D9",
            "separatorColor": "#E0E0E0",
            "title": { "fontSize": 14, "fontWeight": "semibold" },
            "description": { "fontSize": 12 }
        }
    }
}
```

Button style keys: `backgroundColor`, `textColor`, `fontName`, `fontSize`, `fontWeight`, `borderColor`, `borderWidth`, `borderRadius`. Text style keys: `fontName`, `fontSize`, `fontWeight` (`"regular" | "medium" | "semibold" | "bold"`), `textAlignment` (`"left" | "center" | "right" | "justified" | "natural"`), `textColor`.

### Resolution rules

- **Buttons resolve per property**: specific button → `buttons.global` → SDK default. A button can take its `backgroundColor` from `acceptAll` and its `borderRadius` from `global`.
- **Everything else**: value → SDK default.
- **Colors** are hex strings: `#RGB`, `#RRGGBB`, or `#RRGGBBAA` with alpha last; the leading `#` is optional.
- **Invalid values never break the UI** — a bad hex color or unknown enum value is logged (requires `debug: true`) and the default is used. Only a structurally invalid theme document (wrong types) rejects `configure()` with an `EnforceError` of kind `"invalidConfig"`.
- **Empty strings mean "not set"** and fall through like an omitted key.
- **Unknown keys are ignored** for forward compatibility.
- **`buttons.order`** renders the named buttons first, in the given order; unlisted buttons follow in the default order. Which buttons *appear* always comes from your remote configuration — the theme only orders and styles them.
- **Separators are opt-in**: `banner.separatorColor` draws a divider between the banner text and its buttons, `modal.separatorColor` underneath the modal description, and `modal.categories.separatorColor` between category rows (never after the last one). When a separator key is omitted or blank, no divider is drawn.
- Themed UI is **light-mode based**; system appearance settings are not consulted.
- Defaults equal this SDK's current appearance (e.g. `rejectAll` is primary-styled so accepting and rejecting are equally prominent). Style buttons explicitly when you need an exact look.

### Logos

- `logoImage` — a local/bundled asset: a native resource name (string) or a `require()` result (e.g. `logoImage: require("./assets/logo.png")` when building the theme in code).
- `logoUrl` — a remote image URL (raster formats such as PNG recommended). Loaded with a short timeout; if it fails, the UI renders without a logo.
- `logoImage` takes precedence over `logoUrl`.
- Logos render 40 units tall, aspect-fit; `"full"` alignment spans the container width. Over-wide logos scale down and never overflow.

## Reading the Remote Configuration

If you want to build your own consent experience instead of using the built-in banner and modal, `getConfiguration()` exposes everything fetched from your remote environment (`environment.json`) — the client/version metadata, enforcement and enable flags, translations, and the banner/modal button configuration:

```javascript
await Enforce.configure(config);

const configuration = Enforce.getConfiguration();
if (configuration) {
    const {
        clientId,
        version,
        enforcement,
        enablePrivacyNotice,
        enableConsentModal,
        translation,
        bannerConfig,
        consentModalConfig,
    } = configuration;
}
```

Only the fields above are returned (anything else in `environment.json` is left out), and each button entry in `bannerConfig` and `consentModalConfig` is a boolean saying whether that button is shown:

```javascript
configuration.bannerConfig.ensAcceptAll;              // true
configuration.consentModalConfig.ensSaveModal;        // true
configuration.translation.cookies.Analytics.title;    // "Analytics"
```

It returns `null` when the remote configuration is unavailable: before `configure()` completes, when the remote fetch failed, after a `resetEnvironment()` whose refetch has not yet succeeded, or on web (where the consent UI is not rendered by this SDK). It never returns another environment's configuration. The result is a copy, so changing it does not affect the SDK.

## Switching Environments

Change the active environment after initial configure. The SDK validates the new environment by fetching its remote config before committing the change.

```javascript
try {
    await Enforce.setEnvironment("French");
} catch (e) {
    console.error("Environment not found or unavailable");
}
```

The previous environment and config are preserved if the request fails. An empty or whitespace-only environment rejects with an `EnforceError` of kind `"invalidEnvironment"` before any network call.

A successful `setEnvironment()` is **persisted** and used on future launches instead of the `configure()` value (native only — on web the consent UI is platform-managed, so the environment is validated and returned but nothing is applied or persisted, and `getConfiguration()` keeps returning `null`). The persisted override expires together with the stored consent, or after `dataRetentionPeriod` when no consent is stored yet — an override never outlives the retention period it was set under. After it expires, launches fall back to the configured environment. `clearConsent()` does not remove it.

```javascript
// The effective environment: the active override, or the configure() value.
// Returns null before configure().
const environment = Enforce.getEnvironment();

// Discard the override and revert to the configure() environment, for this
// session and future launches.
await Enforce.resetEnvironment();
```

`resetEnvironment()` restores the configured environment's remote configuration from the copy fetched by `configure()`. If the app launched with an override applied, there is no copy, so it is refetched in the background: until that succeeds `getConfiguration()` returns `null`, while the consent UI and reporting keep using the previous configuration. Calling `resetEnvironment()` again retries a failed refetch.

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
| `setEnvironment(env)` | Switch to a different environment; persisted for future launches |
| `getEnvironment()` | Return the effective environment (override or configured), or `null` before configure |
| `resetEnvironment()` | Discard the persisted override and revert to the `configure()` environment |
| `getConfiguration()` | Return the full remote configuration (environment.json contents), or `null` when unavailable |
| `getConsent(selection?)` | Return consent categories (all, single string, or string array) |
| `checkConsent(category)` | Return `true` if the given category is consented to |
| `setConsent(categories)` | Persist consent for one or more categories |
| `clearConsent()` | Remove all stored consent |
| `onConsent(handler)` | Register a callback fired on consent load or update |
| `showBanner()` | Re-fetch the remote config, then show the privacy notice banner |
| `showModal()` | Re-fetch the remote config, then show the consent modal |

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
| `theme` | `EnforceTheme` | — | Custom consent-UI theme (native only) — see [Theming](#theming-react-native) |

### `useConsent()`

| Return value | Type | Description |
|--------------|------|-------------|
| `consent` | `Record<string, boolean>` | Full consent map; empty object if none stored |
| `checkConsent` | `(category: string) => boolean` | Synchronous check against the current consent map |
| `loading` | `boolean` | `true` while consent is being loaded on first render |

## Error Handling

The SDK throws `EnforceError` with a `kind` discriminator for programmatic handling:

```javascript
import { EnforceError } from "@cheq.ai/cheq-enforce-react";

try {
    await Enforce.setConsent({ Analytics: true });
} catch (e) {
    if (e instanceof EnforceError) {
        console.error(e.kind); // "notConfigured" | "invalidConfig" | "invalidEnvironment" | "networkError" | "parseError"
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

Apache 2.0 — see [LICENSE](https://github.com/cheq-ai/cheq-enforce-react/blob/master/LICENSE) for details.

## Support

For support, contact [support@cheq.ai](mailto:support@cheq.ai)
