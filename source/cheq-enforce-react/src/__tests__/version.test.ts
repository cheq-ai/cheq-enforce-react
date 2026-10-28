import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { buildGatewayVersion, SDK_PLATFORM, SDK_VERSION } from '../version';

const pkg = JSON.parse(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8')
) as { version: string };

describe('version', () => {
    it('SDK_VERSION matches the package.json version', () => {
        expect(SDK_VERSION).toBe(pkg.version);
    });

    it('SDK_PLATFORM is "react"', () => {
        expect(SDK_PLATFORM).toBe('react');
    });

    it('builds the combined gateway version string', () => {
        expect(buildGatewayVersion('2.3.802')).toBe(`2.3.802-react-${SDK_VERSION}`);
    });

    it('preserves hyphenated remote versions', () => {
        expect(buildGatewayVersion('2.3.802-rc.1')).toBe(`2.3.802-rc.1-react-${SDK_VERSION}`);
    });
});
