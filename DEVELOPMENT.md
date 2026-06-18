# Development Guide

This guide covers setting up the development environment, building, testing, and publishing the CHEQ Enforce React package.

## Repository Structure

```
cheq-enforce-react/
├── source/
│   └── cheq-enforce-react/      # Main NPM package source
│       ├── src/                 # TypeScript source files
│       ├── dist/                # Built output (generated)
│       ├── package.json         # Package configuration
│       ├── tsup.config.ts       # Build configuration
│       └── vitest.config.ts     # Test configuration
├── sample-app/
│   └── enforce-react-demo/      # Demo application (Expo)
├── package.json                 # Workspace root
├── README.md                    # User documentation
└── DEVELOPMENT.md               # This file
```

## Prerequisites

- Node.js 18 or higher
- npm 9 or higher
- For mobile development:
    - iOS: Xcode, CocoaPods
    - Android: Android Studio, JDK 11+

## Getting Started

```bash
# Install all workspace dependencies
npm install

# Build the package
npm run build
```

## Development Workflow

### Watch Mode

For active development with auto-rebuild:

```bash
cd source/cheq-enforce-react
npm run dev
```

### Clean Build

```bash
npm run clean
npm install
npm run build
```

## Running the Sample App

```bash
# Expo (default)
npm start

# iOS simulator
npm run start:ios

# Android emulator
npm run start:android

# Web browser
npm run start:web
```

## Package Configuration

The package (`source/cheq-enforce-react/package.json`) produces two builds via `tsup`:

| Export | File | Description |
|--------|------|-------------|
| `main` | `dist/index.cjs` | CommonJS entry |
| `module` | `dist/index.js` | ESM entry |
| `types` | `dist/index.d.ts` | TypeScript declarations |
| `react-native` | `dist/index.native.js` | React Native entry (resolves `.native.*` files) |

## Testing

```bash
cd source/cheq-enforce-react
npx vitest run
```

## Versioning

Follow [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking API changes
- **MINOR**: New features (backwards compatible)
- **PATCH**: Bug fixes (backwards compatible)

### Version Locations

Update the version in **all** of these places before releasing:

1. `source/cheq-enforce-react/package.json` — `"version"` field
2. `source/cheq-enforce-react/src/ErrorReporting.ts` — `SDK_VERSION` constant
3. `source/cheq-enforce-react/src/ConsentReporting.ts` — `REPORTING_SDK_VERSION` constant

## Release Process

Uses git flow. The NPM publish happens automatically when the tag is pushed to GitHub.

### 1. Start Release

```bash
git flow release start <VERSION> && git flow release publish
```

### 2. Update Version Numbers

Update the version in all locations listed above under "Version Locations".

### 3. Commit and Push

```bash
git add -A
git commit -m "Bump version to <VERSION>"
git push
```

### 4. Build and Test

```bash
npm run build
npm start
```

### 5. Create Pull Request

Create a PR: `release/<VERSION>` → `main`

Wait for approval before proceeding.

### 6. Finish Release

```bash
git flow release finish <VERSION> -p
```

### 7. Push to GitHub

```bash
./push-github.sh
```

This pushes `main` and tags to GitHub, which triggers the GitHub Actions workflow to publish to NPM.

### 8. Verify Publication

1. Check GitHub Actions completed: *(URL to be added)*
2. Verify package: https://www.npmjs.com/package/@cheq.ai/cheq-enforce-react
3. Test installation: `npm install @cheq.ai/cheq-enforce-react@<VERSION>`

## Testing Checklist

Before releasing, test on:

- [ ] Web (Chrome, Safari, Firefox)
- [ ] iOS Simulator
- [ ] iOS Device
- [ ] Android Emulator
- [ ] Android Device

### Test Scenarios

1. **Configure** — SDK initialises and fetches remote config successfully
2. **Banner auto-show** — Banner appears when no stored consent exists
3. **Modal** — Consent modal opens and saves selections correctly
4. **Consent persistence** — Stored consent survives app restart
5. **setConsent** — Categories merge correctly with existing stored consent
6. **clearConsent** — Removes all stored consent; banner re-appears
7. **Offline fallback** — SDK falls back to stored or default consent gracefully
8. **Environment switch** — `setEnvironment()` fetches new config and updates state
9. **useConsent hook** — Component re-renders on consent change
10. **Error handling** — Network failures surface as `EnforceError` with correct `kind`

## NPM Package Details

- **Package Name**: `@cheq.ai/cheq-enforce-react`
- **Registry**: https://registry.npmjs.org/
- **Organisation**: @cheq.ai
- **License**: Apache-2.0

## Repository Mirrors

- **Primary (Bitbucket)**: Internal development
- **GitHub Mirror**: *(URL to be added)*
