import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version: string };

// Bakes the package version into the bundles so the runtime-reported SDK
// version can never drift from package.json.
const define = { __SDK_VERSION__: JSON.stringify(pkg.version) };

export default defineConfig([
    // Web/default build
    {
        entry: ["src/index.ts"],
        format: ["esm", "cjs"],
        dts: true,
        outDir: "dist",
        clean: true,
        external: ["react", "react-native"],
        define,
    },

    // React Native build
    {
        entry: ["src/index.ts"],
        format: ["esm"],
        dts: false,
        outDir: "dist",
        outExtension: () => ({ js: ".native.js" }),
        platform: "neutral",
        clean: false,
        external: ["react", "react-native", "@react-native-async-storage/async-storage"],
        define,

        esbuildOptions(options) {
            // Prefer .native.* implementations
            options.resolveExtensions = [
                ".native.ts",
                ".native.tsx",
                ".ts",
                ".tsx",
                ".js",
                ".jsx",
                ".json",
            ];
        },
    },
]);