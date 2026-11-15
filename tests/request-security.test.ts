import { afterEach, expect, test, vi } from 'vitest';
import { applicationOrigin } from '../src/common/request-security.server';

afterEach(() => vi.unstubAllEnvs());

test('the configured public origin is used over an internal HTTP hop', () => {
    vi.stubEnv('APP_URL', 'https://app.example.test');

    const request = new Request('http://internal:3000', { headers: { 'X-Forwarded-Host': 'attacker.example' } });

    expect(applicationOrigin(request)).toBe('https://app.example.test');
});
