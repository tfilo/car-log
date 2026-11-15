import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { FuelType, UserStatus } from '../../src/generated/prisma/enums';
import { i18n } from '../../src/i18n';

const t = i18n.getFixedT('sk', 'statistics');

test('statistics clusters saved places, opens records and follows vehicle and date filters', async ({ page, context }) => {
    const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.E2E_DATABASE_URL! }) });
    try {
        const username = `places${randomUUID().replaceAll('-', '').slice(0, 12)}`;
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
        await context.addCookies([
            { name: 'car_log_session', value: token, url: test.info().project.use.baseURL!, httpOnly: true, sameSite: 'Lax' }
        ]);
        const car = await database.vehicle.create({
            data: { userId: user.id, manufacturer: 'Synthetic', model: 'Places', fuelTypes: [FuelType.PETROL, FuelType.ELECTRIC] }
        });
        const second = await database.vehicle.create({
            data: { userId: user.id, manufacturer: 'Synthetic', model: 'Empty', fuelTypes: [FuelType.PETROL] }
        });
        await database.fuelRecord.createMany({
            data: Array.from({ length: 5 }, (_, index) => ({
                vehicleId: car.id,
                fuelType: FuelType.PETROL,
                occurredAt: new Date(Date.UTC(2026, 0, index + 1)),
                odometer: 1000 + index * 500,
                quantity: 30,
                totalPrice: 45,
                unitPrice: 1.5,
                isFull: true,
                latitude: 51.505 + index * 0.000001,
                longitude: -0.09,
                locationAccuracy: 12,
                locationCapturedAt: new Date('2026-01-01T12:00:00Z')
            }))
        });
        const electric = await database.fuelRecord.create({
            data: {
                vehicleId: car.id,
                fuelType: FuelType.ELECTRIC,
                occurredAt: new Date('2026-02-01T12:00:00Z'),
                odometer: 3500,
                quantity: 20,
                totalPrice: 8,
                unitPrice: 0.4,
                isFull: true,
                latitude: 51.51,
                longitude: -0.11,
                locationAccuracy: 12,
                locationCapturedAt: new Date('2026-02-01T12:00:00Z')
            }
        });
        // A record without GPS must not produce a marker.
        await database.fuelRecord.create({
            data: {
                vehicleId: car.id,
                fuelType: FuelType.ELECTRIC,
                occurredAt: new Date('2026-02-02T12:00:00Z'),
                odometer: 3600,
                quantity: 10,
                totalPrice: 4,
                unitPrice: 0.4,
                isFull: true
            }
        });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('https://tile.openstreetmap.org/**', (route) => route.abort());
        await page.goto(`/statistics?vehicleId=${car.id}`, { waitUntil: 'networkidle' });
        const map = page.getByRole('region', { name: t('places.map'), exact: true });
        await expect(map).toBeVisible();
        await expect(page.getByText(t('places.help', { count: 6 }), { exact: true })).toBeVisible();
        await expect(map.locator('.fuel-place-cluster')).toHaveText('5');
        await expect(map.locator('.fuel-place-dot')).toHaveCount(1);
        await map.locator('..').screenshot({ path: test.info().outputPath('cluster-desktop.png') });
        await map.getByRole('button', { name: i18n.t(`vehicles:fuels.${FuelType.ELECTRIC}`), exact: true }).click();
        await expect(map.getByRole('button', { name: t('places.openRecord'), exact: true })).toBeVisible();
        await map.getByRole('button', { name: t('places.openRecord'), exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/fuel/${electric.id}$`));
        await page.goto(`/statistics?vehicleId=${car.id}`, { waitUntil: 'networkidle' });
        await map.locator('.fuel-place-cluster').click();
        await expect(map.getByRole('button', { name: i18n.t(`vehicles:fuels.${FuelType.PETROL}`), exact: true })).toHaveCount(5);
        await page.setViewportSize({ width: 390, height: 844 });
        await map.scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await map.locator('..').screenshot({ path: test.info().outputPath('cluster-mobile.png') });
        await page.goto(`/statistics?vehicleId=${car.id}&period=custom&from=2026-02-01&to=2026-02-01`, { waitUntil: 'networkidle' });
        await expect(map.locator('.fuel-place-dot')).toHaveCount(1);
        await expect(map.locator('.fuel-place-cluster')).toHaveCount(0);
        await expect(page.getByText(t('places.help', { count: 1 }), { exact: true })).toBeVisible();
        await page.goto(`/statistics?vehicleId=${second.id}`, { waitUntil: 'networkidle' });
        await expect(page.getByText(t('places.empty'), { exact: true })).toBeVisible();
        await expect(map).toHaveCount(0);
        expect(errors).toEqual([]);
    } finally {
        await database.$disconnect();
    }
});
