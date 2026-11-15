import { randomBytes } from 'node:crypto';

// Test-only key material. Never use a real environment's pepper in fixtures.
process.env.PASSWORD_PEPPER = randomBytes(32).toString('hex');
process.env.ARGON2_MEMORY = '65536';
process.env.ARGON2_PASSES = '3';
process.env.ARGON2_PARALLELISM = '1';
