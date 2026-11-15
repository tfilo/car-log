import { ConfigurationError } from '../logging.server';
import 'dotenv/config';
import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(argon2);

type HashParameters = { memory: number; passes: number; parallelism: number };

function supportedParameters(parameters: HashParameters): boolean {
    return (
        parameters.memory >= 19456 &&
        parameters.memory <= 262144 &&
        parameters.passes >= 2 &&
        parameters.passes <= 10 &&
        parameters.parallelism >= 1 &&
        parameters.parallelism <= 4
    );
}

function readInteger(name: string, fallback: number): number {
    const value = process.env[name] ?? String(fallback);

    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new ConfigurationError(`${name} must be a positive integer.`);
    }

    return Number(value);
}

function getParameters(): HashParameters {
    const parameters = {
        memory: readInteger('ARGON2_MEMORY', 65536),
        passes: readInteger('ARGON2_PASSES', 3),
        parallelism: readInteger('ARGON2_PARALLELISM', 1)
    };

    if (!supportedParameters(parameters)) {
        throw new ConfigurationError('Argon2 settings must use memory 19456–262144 KiB, passes 2–10, and parallelism 1–4.');
    }

    return parameters;
}

function getPepper(): Buffer {
    const pepper = process.env.PASSWORD_PEPPER;

    if (!pepper || !/^[a-fA-F0-9]{64}$/.test(pepper)) {
        throw new ConfigurationError('Set PASSWORD_PEPPER to a random 32-byte secret encoded as 64 hexadecimal characters.');
    }

    return Buffer.from(pepper, 'hex');
}

function encodeBase64(value: Buffer): string {
    return value.toString('base64').replace(/=+$/, '');
}

function parseHash(encodedHash: string) {
    const match = /^\$argon2id\$v=19\$m=([1-9]\d{0,5}),t=([1-9]\d?),p=([1-9])\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/.exec(encodedHash);

    if (!match || match[0] !== encodedHash) return null;

    const parameters = { memory: Number(match[1]), passes: Number(match[2]), parallelism: Number(match[3]) };

    if (!supportedParameters(parameters)) return null;

    const salt = Buffer.from(match[4], 'base64');
    const key = Buffer.from(match[5], 'base64');

    if (encodeBase64(salt) !== match[4] || encodeBase64(key) !== match[5]) return null;

    return { parameters, salt, key };
}

export async function hashPassword(password: string): Promise<string> {
    const parameters = getParameters();
    const pepper = getPepper();
    const salt = randomBytes(16);
    const hash = await deriveKey('argon2id', {
        ...parameters,
        tagLength: 32,
        message: password,
        nonce: salt,
        // Argon2 has a dedicated secret input; the pepper stays outside the PHC string.
        secret: pepper
    });

    // PHC format retains the algorithm version, parameters, salt, and hash.
    return `$argon2id$v=19$m=${parameters.memory},t=${parameters.passes},p=${parameters.parallelism}$${encodeBase64(salt)}$${encodeBase64(hash)}`;
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
    const pepper = getPepper();

    // Verify using the stored settings, independently of today's hashing policy.
    const stored = parseHash(encodedHash);

    if (!stored) return false;

    const actual = await deriveKey('argon2id', {
        ...stored.parameters,
        tagLength: 32,
        message: password,
        nonce: stored.salt,
        secret: pepper
    });

    return timingSafeEqual(actual, stored.key);
}

export function passwordNeedsRehash(encodedHash: string): boolean {
    const current = getParameters();
    const stored = parseHash(encodedHash);

    return (
        !stored ||
        stored.parameters.memory !== current.memory ||
        stored.parameters.passes !== current.passes ||
        stored.parameters.parallelism !== current.parallelism
    );
}
