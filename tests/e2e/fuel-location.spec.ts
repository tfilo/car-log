import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { FuelType, UserStatus } from '../../src/generated/prisma/enums';
import { i18n } from '../../src/i18n';

const t = i18n.getFixedT('sk', 'fuel');

test.use({ hasTouch: true });

test('location preference controls capture; saved maps survive edits and denial does not block saving', async ({ page, context }) => {
    const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.E2E_DATABASE_URL! }) });
    try {
        const username = `location${randomUUID().replaceAll('-', '').slice(0, 12)}`;
        const user = await database.user.create({
            data: { username, email: `${username}@example.test`, passwordHash: 'synthetic-unused', status: UserStatus.ACTIVE }
        });
        const car = await database.vehicle.create({
            data: { userId: user.id, manufacturer: 'Synthetic', model: 'Location', fuelTypes: [FuelType.PETROL] }
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
        await context.grantPermissions(['geolocation']);
        await context.setGeolocation({ latitude: 51.505, longitude: -0.09, accuracy: 12 });
        await page.addInitScript(() => {
            const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
            navigator.geolocation.getCurrentPosition = (success, error, options) => {
                document.documentElement.dataset.locationRequests = String(
                    Number(document.documentElement.dataset.locationRequests ?? 0) + 1
                );
                original(success, error, options);
            };
        });
        // Tests do not depend on the public tile service; explicitly exercise its failure fallback.
        await page.route('https://tile.openstreetmap.org/**', (route) => route.abort());
        await page.goto('/fuel/new', { waitUntil: 'networkidle' });
        expect(await page.locator('html').getAttribute('data-location-requests')).toBeNull();
        await expect(page.getByRole('region', { name: t('location.map') })).toHaveCount(0);

        await page.goto('/profile', { waitUntil: 'networkidle' });
        await page.getByText(i18n.t('profile.storeFuelLocation'), { exact: true }).click();
        await page.getByRole('button', { name: i18n.t('profile.save'), exact: true }).click();
        await expect(page.getByRole('status').filter({ hasText: i18n.t('profile.saved') })).toBeVisible();
        expect((await database.user.findUniqueOrThrow({ where: { id: user.id } })).storeFuelLocation).toBe(true);
        await page.screenshot({ path: test.info().outputPath('profile-location.png'), fullPage: true });
        await page.goto('/fuel/new', { waitUntil: 'networkidle' });
        await expect(page.getByRole('region', { name: t('location.map') })).toBeVisible();
        await expect(page.locator('.leaflet-marker-icon')).toBeVisible();
        await expect(page.getByText(t('location.mapUnavailable'), { exact: true })).toBeVisible();
        await page.getByRole('region', { name: t('location.map') }).scrollIntoViewIfNeeded();
        const pin = page.locator('.leaflet-marker-icon');
        const bounds = (await pin.boundingBox())!;
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await page.mouse.down();
        await page.mouse.move(bounds.x + bounds.width / 2 + 40, bounds.y + bounds.height / 2 - 20, { steps: 8 });
        await page.mouse.up();
        await expect(page.getByText(t('location.manuallyAdjusted'), { exact: true })).toBeVisible();
        await expect(page.getByText(t('location.accuracy', { metres: 12 }), { exact: true })).toHaveCount(0);
        await page.getByLabel(t('occurredAt')).fill('15.07.2026 12:00:00');
        await page.locator('input[name="odometer"]').fill('1000');
        await page.locator('input[name="quantity"]').fill('30');
        await page.locator('input[name="priceAmount"]').fill('45');
        await page.getByRole('button', { name: t('save'), exact: true }).click();
        await expect(page).toHaveURL(/\/fuel\/?\?/);
        const record = await database.fuelRecord.findFirstOrThrow({ where: { vehicleId: car.id } });
        expect(record.latitude).not.toBe(51.505);
        expect(record.longitude).not.toBe(-0.09);
        expect(record.locationManuallyAdjusted).toBe(true);
        expect(record.locationAccuracy).toBe(12);
        expect(record.locationCapturedAt).not.toBeNull();

        await page.goto(`/fuel/${record.id}`, { waitUntil: 'networkidle' });
        await expect(page.locator('.leaflet-marker-icon')).toBeVisible();
        expect(await page.locator('html').getAttribute('data-location-requests')).toBeNull();
        await context.setGeolocation({ latitude: 51.51, longitude: -0.1 });
        await page.locator('input[name="priceAmount"]').fill('46');
        await page.getByRole('button', { name: t('save'), exact: true }).click();
        await expect(page).toHaveURL(/\/fuel\/?\?/);
        expect((await database.fuelRecord.findUniqueOrThrow({ where: { id: record.id } })).latitude).toBe(record.latitude);
        await page.goto(`/fuel/${record.id}`, { waitUntil: 'networkidle' });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole('region', { name: t('location.map') }).scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        // Turn off automatic capture; an existing point remains manually editable.
        await database.user.update({ where: { id: user.id }, data: { storeFuelLocation: false } });
        const touchPin = (await pin.boundingBox())!;
        const touch = await context.newCDPSession(page);
        const x = touchPin.x + touchPin.width / 2;
        const y = touchPin.y + touchPin.height / 2;
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let step = 1; step <= 8; step++)
            await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + step * 5, y: y - step * 2 }] });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await touch.detach();
        await page.screenshot({ path: test.info().outputPath('saved-location-mobile.png') });
        await page.getByRole('button', { name: t('save'), exact: true }).click();
        await expect(page).toHaveURL(/\/fuel\/?\?/);
        const corrected = await database.fuelRecord.findUniqueOrThrow({ where: { id: record.id } });
        expect(corrected.latitude).not.toBe(record.latitude);
        expect(corrected.locationCapturedAt).toEqual(record.locationCapturedAt);
        expect(corrected.locationAccuracy).toBe(12);
        await page.goto(`/fuel/${record.id}`, { waitUntil: 'networkidle' });
        await expect(page.getByText(t('location.manuallyAdjusted'), { exact: true })).toBeVisible();
        expect(await page.locator('html').getAttribute('data-location-requests')).toBeNull();
        await database.user.update({ where: { id: user.id }, data: { storeFuelLocation: true } });

        await page.addInitScript(() => {
            navigator.geolocation.getCurrentPosition = (_success, error) =>
                error?.({ code: 1, message: 'Synthetic denial', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
        });
        await page.goto('/fuel/new', { waitUntil: 'networkidle' });
        await expect(page.getByRole('status').filter({ hasText: t('location.unavailable') })).toBeVisible();
        await page.getByLabel(t('occurredAt')).fill('16.07.2026 12:00:00');
        await page.locator('input[name="odometer"]').fill('1500');
        await page.locator('input[name="quantity"]').fill('30');
        await page.locator('input[name="priceAmount"]').fill('45');
        await page.getByRole('button', { name: t('save'), exact: true }).click();
        await expect(page).toHaveURL(/\/fuel\/?\?/);
        const records = await database.fuelRecord.findMany({ where: { vehicleId: car.id } });
        expect(records).toHaveLength(2);
        expect(records.find((item) => item.id !== record.id)?.latitude).toBeNull();
    } finally {
        await database.$disconnect();
    }
});
