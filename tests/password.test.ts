import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { afterEach, expect, test, vi } from 'vitest';
import { hashPassword, passwordNeedsRehash, verifyPassword } from '../src/auth/password.server';

afterEach(() => {
    vi.unstubAllEnvs();
});

test('native Argon2id hashes use unique salts and require the correct password and pepper', async () => {
    const pepper = randomBytes(32);

    vi.stubEnv('PASSWORD_PEPPER', pepper.toString('hex'));

    const password = 'Password123!';
    const encoded = await hashPassword(password);
    const second = await hashPassword(password);

    expect(encoded).not.toBe(second);
    expect(encoded).not.toContain(password);
    expect(encoded).not.toContain(pepper.toString('hex'));

    const parts = encoded.split('$');

    expect(parts.slice(0, 4)).toEqual(['', 'argon2id', 'v=19', 'm=65536,t=3,p=1']);

    const salt = Buffer.from(parts[4], 'base64');
    const stored = Buffer.from(parts[5], 'base64');

    expect(salt.byteLength).toBe(16);
    expect(stored.byteLength).toBe(32);

    const derive = promisify(argon2);
    const parameters = { nonce: salt, memory: 65536, passes: 3, parallelism: 1, tagLength: 32, secret: pepper };
    const correct = await derive('argon2id', { ...parameters, message: password });
    const incorrect = await derive('argon2id', { ...parameters, message: 'WrongPassword123!' });
    const wrongPepper = await derive('argon2id', { ...parameters, message: password, secret: randomBytes(32) });
    const withoutPepper = await derive('argon2id', {
        nonce: salt,
        memory: 65536,
        passes: 3,
        parallelism: 1,
        tagLength: 32,
        message: password
    });

    expect(timingSafeEqual(stored, correct)).toBe(true);
    expect(timingSafeEqual(stored, incorrect)).toBe(false);
    expect(timingSafeEqual(stored, wrongPepper)).toBe(false);
    expect(timingSafeEqual(stored, withoutPepper)).toBe(false);
});

test.each([undefined, '', 'not-hex', 'a'.repeat(63), 'a'.repeat(65), 'z'.repeat(64)])(
    'fails closed when the pepper is missing or malformed (%#)',
    async (pepper) => {
        const encoded = await hashPassword('Password123!');

        vi.stubEnv('PASSWORD_PEPPER', pepper);
        await expect(hashPassword('Password123!')).rejects.toThrow('Set PASSWORD_PEPPER');
        await expect(verifyPassword('Password123!', encoded)).rejects.toThrow('Set PASSWORD_PEPPER');
    }
);

test('verifies independently salted hashes and compares the exact password without trimming or case changes', async () => {
    const first = await hashPassword('Password123!');
    const second = await hashPassword('Password123!');

    expect(await verifyPassword('Password123!', first)).toBe(true);
    expect(await verifyPassword('Password123!', second)).toBe(true);
    expect(await verifyPassword('WrongPassword123!', first)).toBe(false);
    expect(await verifyPassword('password123!', first)).toBe(false);
    expect(await verifyPassword(' Password123!', first)).toBe(false);
    expect(await verifyPassword('Password123! ', first)).toBe(false);
});

test('rejects the correct password when the configured pepper changes', async () => {
    const encoded = await hashPassword('Password123!');

    vi.stubEnv('PASSWORD_PEPPER', randomBytes(32).toString('hex'));
    expect(await verifyPassword('Password123!', encoded)).toBe(false);
});

test('does not accept legacy unpeppered hashes', async () => {
    const salt = randomBytes(16);
    const hash = await promisify(argon2)('argon2id', {
        message: 'Password123!',
        nonce: salt,
        memory: 65536,
        passes: 3,
        parallelism: 1,
        tagLength: 32
    });
    const encoded = `$argon2id$v=19$m=65536,t=3,p=1$${salt.toString('base64').replace(/=+$/, '')}$${hash.toString('base64').replace(/=+$/, '')}`;

    expect(await verifyPassword('Password123!', encoded)).toBe(false);
});

const prefix = '$argon2id$v=19$m=65536,t=3,p=1$';
const validShape = `${prefix}${'A'.repeat(22)}$${'A'.repeat(43)}`;

test.each([
    '',
    'not-a-hash',
    validShape.replace('argon2id', 'argon2i'),
    validShape.replace('v=19', 'v=20'),
    validShape.replace('m=65536', 'm=19455'),
    validShape.replace('m=65536', 'm=262145'),
    validShape.replace('t=3', 't=1'),
    validShape.replace('t=3', 't=11'),
    validShape.replace('p=1', 'p=5'),
    `${prefix}$${'A'.repeat(43)}`,
    `${prefix}${'A'.repeat(21)}$${'A'.repeat(43)}`,
    `${prefix}${'A'.repeat(22)}$${'A'.repeat(42)}`,
    `${prefix}${'A'.repeat(21)}!$${'A'.repeat(43)}`,
    `${prefix}${'A'.repeat(21)}B$${'A'.repeat(43)}`,
    `${prefix}${'A'.repeat(22)}$${'A'.repeat(42)}B`,
    validShape + '=',
    validShape + '$extra',
    validShape + '\n'
])('rejects malformed or unsupported hashes without throwing (%#)', async (encoded) => {
    expect(await verifyPassword('Password123!', encoded)).toBe(false);
});

test('retains older profiles across multiple policy changes and identifies upgrades', async () => {
    const first = await hashPassword('Password123!');

    expect(passwordNeedsRehash(first)).toBe(false);

    vi.stubEnv('ARGON2_MEMORY', '32768');
    vi.stubEnv('ARGON2_PASSES', '2');
    vi.stubEnv('ARGON2_PARALLELISM', '2');
    expect(await verifyPassword('Password123!', first)).toBe(true);
    expect(passwordNeedsRehash(first)).toBe(true);

    const second = await hashPassword('Password123!');

    expect(second).toContain('$m=32768,t=2,p=2$');
    expect(passwordNeedsRehash(second)).toBe(false);

    vi.stubEnv('ARGON2_MEMORY', '98304');
    vi.stubEnv('ARGON2_PASSES', '4');
    expect(await verifyPassword('Password123!', first)).toBe(true);
    expect(await verifyPassword('Password123!', second)).toBe(true);
    expect(passwordNeedsRehash(first)).toBe(true);
    expect(passwordNeedsRehash(second)).toBe(true);
});

test('uses the recommended defaults when optional cost settings are unset', async () => {
    vi.stubEnv('ARGON2_MEMORY', undefined);
    vi.stubEnv('ARGON2_PASSES', undefined);
    vi.stubEnv('ARGON2_PARALLELISM', undefined);
    expect(await hashPassword('Password123!')).toContain('$m=65536,t=3,p=1$');
});

test.each([
    ['ARGON2_MEMORY', '19455'],
    ['ARGON2_MEMORY', '262145'],
    ['ARGON2_MEMORY', '65536junk'],
    ['ARGON2_PASSES', '1'],
    ['ARGON2_PASSES', '11'],
    ['ARGON2_PASSES', '2.5'],
    ['ARGON2_PARALLELISM', '0'],
    ['ARGON2_PARALLELISM', '5'],
    ['ARGON2_PARALLELISM', ''],
    ['ARGON2_MEMORY', '-1'],
    ['ARGON2_MEMORY', '1e5']
])('rejects invalid hashing configuration %s=%s', async (name, value) => {
    vi.stubEnv(name, value);
    await expect(hashPassword('Password123!')).rejects.toThrow();
});
