import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(
    readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string };

export default defineConfig({
    define: {
        // Mirrors the tsup build-time injection.
        __SDK_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
        alias: {
            // Test-only stub so components can render under happy-dom.
            // The build resolves the real react-native peer dependency.
            'react-native': fileURLToPath(
                new URL('./src/__tests__/mocks/react-native.tsx', import.meta.url)
            ),
        },
    },
    test: {
        environment: 'happy-dom',
        setupFiles: ['src/__tests__/setup.ts'],
        include: ['src/**/*.test.{ts,tsx}'],
    },
});
