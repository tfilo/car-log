import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { FuelType, UserStatus } from '../../src/generated/prisma/enums';
import { i18n } from '../../src/i18n';

const t = i18n.getFixedT('sk', 'auth');

test('profile exports a downloadable ZIP and imports it into an empty account', async ({ page, context }) => {
    const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.E2E_DATABASE_URL! }) });
    try {
        const accounts = [];
        for (let i = 0; i < 2; i++) {
            const username = `transfer${randomUUID().replaceAll('-', '').slice(0, 12)}`;
            const user = await database.user.create({
                data: { username, email: `${username}@example.test`, passwordHash: 'synthetic-unused', status: UserStatus.ACTIVE }
            });
            const token = randomBytes(32).toString('base64url');
            await database.session.create({
                data: {
                    userId: user.id,
                    tokenHash: createHash('sha256').update(token).digest('hex'),
                    expiresAt: new Date(Date.now() + 86400000)
                }
            });
            accounts.push({ user, token });
        }
        await database.vehicle.create({
            data: { userId: accounts[0].user.id, manufacturer: 'Synthetic', model: 'Transfer', fuelTypes: [FuelType.PETROL] }
        });
        await context.addCookies([
            { name: 'car_log_session', value: accounts[0].token, url: test.info().project.use.baseURL!, httpOnly: true, sameSite: 'Lax' }
        ]);
        await page.goto('/profile', { waitUntil: 'networkidle' });
        await expect(page.getByRole('button', { name: t('transfer.import'), exact: true })).toBeDisabled();
        await page.getByRole('button', { name: t('transfer.export'), exact: true }).click();
        const link = page.getByRole('link', { name: t('transfer.download') });
        await expect(link).toBeVisible();
        const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
        const bytes = await readFile((await download.path())!);
        expect(bytes.subarray(0, 2).toString()).toBe('PK');
        await context.addCookies([
            { name: 'car_log_session', value: accounts[1].token, url: test.info().project.use.baseURL!, httpOnly: true, sameSite: 'Lax' }
        ]);
        await page.goto('/profile', { waitUntil: 'networkidle' });
        await page.getByLabel(t('transfer.file')).setInputFiles({ name: 'car-log.zip', mimeType: 'application/zip', buffer: bytes });
        await page.getByRole('button', { name: t('transfer.import'), exact: true }).click();
        await expect(page.getByRole('status').filter({ hasText: t('transfer.imported', { date: '' }).trim() })).toBeVisible();
        await expect(page.getByRole('button', { name: t('transfer.import'), exact: true })).toBeDisabled();
        expect(await database.vehicle.count({ where: { userId: accounts[1].user.id } })).toBe(1);
        await page.reload({ waitUntil: 'networkidle' });
        await expect(page.getByRole('status').filter({ hasText: t('transfer.imported', { date: '' }).trim() })).toBeVisible();
        const asset = await page.locator('script[src]').first().getAttribute('src');
        if (asset) expect((await page.request.get(asset)).ok()).toBe(true);
    } finally {
        await database.$disconnect();
    }
});
