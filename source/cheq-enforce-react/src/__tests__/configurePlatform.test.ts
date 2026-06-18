// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { EnforceConfig } from '../Types';

const BASE_CONFIG: EnforceConfig = {
    clientName: 'acme',
    publishPath: 'prod',
    environment: 'English',
};

describe('injectCheqBootstrapScript', () => {
    let injectCheqBootstrapScript: (config: EnforceConfig) => void;

    beforeEach(async () => {
        vi.resetModules();
        document.head.innerHTML = '';
        const mod = await import('../configurePlatform');
        injectCheqBootstrapScript = mod.injectCheqBootstrapScript;
    });

    it('injects exactly one script element on first call', () => {
        injectCheqBootstrapScript(BASE_CONFIG);
        expect(document.head.querySelectorAll('script')).toHaveLength(1);
    });

    it('does not inject a second element when called twice with the same config (module-level cache)', () => {
        injectCheqBootstrapScript(BASE_CONFIG);
        injectCheqBootstrapScript(BASE_CONFIG);
        expect(document.head.querySelectorAll('script')).toHaveLength(1);
    });

    it('does not inject a second element when a matching script already exists in the DOM', async () => {
        const expectedSrc = `https://nexus.ensighten.com/${encodeURIComponent('acme')}/${encodeURIComponent('prod')}/Bootstrap.js`;
        const existing = document.createElement('script');
        existing.setAttribute('src', expectedSrc);
        document.head.appendChild(existing);

        // Fresh module instance (injectedScriptSrc = null) but DOM already has the script
        vi.resetModules();
        const mod = await import('../configurePlatform');
        mod.injectCheqBootstrapScript(BASE_CONFIG);

        expect(document.head.querySelectorAll('script')).toHaveLength(1);
    });

    it('encodes special characters in clientName', () => {
        injectCheqBootstrapScript({ ...BASE_CONFIG, clientName: 'acme corp' });
        const script = document.head.querySelector('script');
        expect(script).not.toBeNull();
        expect(script!.getAttribute('src')).toContain('acme%20corp');
    });

    it('encodes special characters in publishPath', () => {
        injectCheqBootstrapScript({ ...BASE_CONFIG, publishPath: 'prod/v1' });
        const script = document.head.querySelector('script');
        expect(script).not.toBeNull();
        expect(script!.getAttribute('src')).toContain('prod%2Fv1');
    });

    it('uses the production host when debug is false', () => {
        injectCheqBootstrapScript({ ...BASE_CONFIG, debug: false });
        const script = document.head.querySelector('script');
        expect(script!.getAttribute('src')).toContain('nexus.ensighten.com');
        expect(script!.getAttribute('src')).not.toContain('nexus-test.ensighten.com');
    });

    it('uses the test host when debug is true', () => {
        injectCheqBootstrapScript({ ...BASE_CONFIG, debug: true });
        const script = document.head.querySelector('script');
        expect(script!.getAttribute('src')).toContain('nexus-test.ensighten.com');
    });
});
