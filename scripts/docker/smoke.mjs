import assert from 'node:assert/strict';
import { argon2, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';

assert.notEqual(process.getuid(), 0, 'The production process must run as a non-root user.');

const hash = await promisify(argon2)('argon2id', {
    message: 'synthetic-container-check',
    nonce: randomBytes(16),
    secret: randomBytes(32),
    memory: 65536,
    passes: 3,
    parallelism: 1,
    tagLength: 32
});

assert.equal(hash.length, 32);
assert.equal(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bratislava', hour: '2-digit', hourCycle: 'h23' }).format(
        new Date('2026-07-01T00:00:00Z')
    ),
    '02'
);

const picture = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#527d91' } })
    .jpeg()
    .toBuffer();

assert.equal((await sharp(picture).metadata()).format, 'jpeg');

const directory = await mkdtemp(join(process.env.VEHICLE_IMAGE_DIR, 'smoke-'));

try {
    await writeFile(join(directory, 'synthetic.jpg'), picture);
} finally {
    await rm(directory, { recursive: true });
}

console.log('Non-root runtime, Argon2id, Bratislava timezone, Sharp JPEG and image storage checks passed.');
