import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { FuelType, UserRole, UserStatus } from '../../src/generated/prisma/enums';
import { FuelUnit } from '../../src/fuel/fuel-values';
import { i18n } from '../../src/i18n';

const t = i18n.getFixedT('sk', 'fuel');
let database: PrismaClient;

test.use({ timezoneId: 'America/New_York', actionTimeout: 10_000 });

test.beforeAll(() => {
    database = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.E2E_DATABASE_URL! }) });
});

test.afterAll(async () => {
    await database.$disconnect();
});

async function session(context: BrowserContext) {
    const username = `guifuel${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const user = await database.user.create({
        data: {
            username,
            email: `${username}@example.test`,
            passwordHash: 'synthetic-unused',
            status: UserStatus.ACTIVE,
            role: UserRole.USER
        }
    });
    const token = randomBytes(32).toString('base64url');
    await database.session.create({
        data: { userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 86_400_000) }
    });
    await context.addCookies([
        { name: 'car_log_session', value: token, url: test.info().project.use.baseURL!, httpOnly: true, sameSite: 'Lax' }
    ]);

    return user;
}

async function choose(page: Page, label: string, option: string) {
    await page.getByRole('combobox', { name: label, exact: false }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
}

async function fields(page: Page, date: string, odometer: string, quantity: string, cost: string) {
    await page.getByLabel(t('occurredAt')).fill(date);
    await page.locator('input[name="odometer"]').fill(odometer);
    await page.locator('input[name="quantity"]').fill(quantity);
    await page.locator('input[name="priceAmount"]').fill(cost);
}

test('home hides the single vehicle selector and creates/edits/deletes fuel and charging with numeric prices', async ({
    page,
    context
}) => {
    const user = await session(context);
    const vehicle = await database.vehicle.create({
        data: { userId: user.id, manufacturer: 'Synthetic', model: 'Hybrid', fuelTypes: [FuelType.PETROL, FuelType.ELECTRIC] }
    });
    const browserErrors: string[] = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));

    await page.goto('/fuel', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: t('heading'), exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: t('vehicle'), exact: true })).toHaveCount(0);
    await expect(page.getByText('Synthetic Hybrid', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: t('allFuels'), exact: true })).toBeVisible();
    await page.getByRole('button', { name: t('add'), exact: true }).click();
    await expect(page.getByRole('combobox', { name: t('vehicle'), exact: true })).toHaveCount(0);
    await expect(page.getByText('Synthetic Hybrid', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: t('save'), exact: true }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await fields(page, '15.07.2026 14:30:00', '1000', '40.125', '72.23');
    await expect(page.locator('input[name="isFull"]')).toBeChecked();
    await page.getByRole('button', { name: t('save'), exact: true }).click();
    await expect(page).toHaveURL(/\/?vehicleId=/);
    await expect(page.getByRole('table')).toContainText('72,23');

    const first = await database.fuelRecord.findFirstOrThrow({ where: { vehicleId: vehicle.id } });
    expect(first.occurredAt.toISOString()).toBe('2026-07-15T12:30:00.000Z');
    expect(first.quantity.toNumber()).toBe(40.125);

    await page.getByRole('button', { name: t('add'), exact: true }).click();
    await fields(page, '16.07.2026 14:30:00', '1500', '40', '1.8');
    await choose(page, t('priceType'), t('unitPriceOption'));
    // Switching modes converts the previous amount; enter the actual unit price afterwards.
    await page.locator('input[name="priceAmount"]').fill('1.8');
    await expect(page.locator('input[name="isFull"]')).toBeChecked();
    await expect(page.getByRole('status').filter({ hasText: '72,00' })).toContainText('72,00');
    await page.getByRole('button', { name: t('save'), exact: true }).click();
    await expect(page.getByRole('table')).toContainText('8 L/100 km');
    const newestRow = page.getByRole('row').filter({ hasText: '16.07.2026' });
    await expect(
        newestRow
            .getByRole('cell')
            .last()
            .getByRole('button', { name: t('deleteRecord'), exact: true })
    ).toBeVisible();
    await newestRow.getByRole('cell').first().click();
    await page.locator('input[name="odometer"]').fill('1000');
    await page.getByRole('button', { name: t('save'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(t('errors.odometerOrder'));
    await page.locator('input[name="odometer"]').fill('1600');
    await page.getByRole('button', { name: t('save'), exact: true }).click();
    await expect(page.getByRole('table')).toContainText('6,67 L/100 km');

    await page.getByRole('button', { name: t('add'), exact: true }).click();
    await choose(page, t('fuelType'), i18n.t(`fuels.${FuelType.ELECTRIC}`, { ns: 'vehicles' }));
    await expect(page.getByLabel(t('quantity', { unit: FuelUnit.KILOWATT_HOUR }))).toBeVisible();
    await expect(page.getByText(t('evHelp'), { exact: true })).toBeVisible();
    await fields(page, '16.07.2026 14:30:00', '1600', '25.5', '0');
    await page.getByRole('button', { name: t('save'), exact: true }).click();
    await expect(page.getByRole('table')).toContainText('25,5 kWh');
    await choose(page, t('fuelFilter'), i18n.t(`fuels.${FuelType.ELECTRIC}`, { ns: 'vehicles' }));
    await expect(page.getByRole('row')).toHaveCount(2);
    const electric = page.getByRole('row').filter({ hasText: '25,5 kWh' });
    await electric.getByRole('button', { name: t('deleteRecord'), exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText(t('deleteWarning'));
    await page
        .getByRole('dialog')
        .getByRole('button', { name: t('deleteRecord'), exact: true })
        .click();
    await expect(page.getByRole('row')).toHaveCount(1);
    expect(await database.fuelRecord.count({ where: { vehicleId: vehicle.id } })).toBe(2);
    expect(browserErrors).toEqual([]);
});

test('home selects between multiple cars, paginates, and keeps the table within a mobile viewport', async ({ page, context }) => {
    const user = await session(context);
    const first = await database.vehicle.create({
        data: { userId: user.id, manufacturer: 'Synthetic', model: 'First', fuelTypes: [FuelType.CNG] }
    });
    const second = await database.vehicle.create({
        data: { userId: user.id, manufacturer: 'Synthetic', model: 'Second', fuelTypes: [FuelType.ELECTRIC] }
    });
    await database.fuelRecord.createMany({
        data: Array.from({ length: 26 }, (_, index) => ({
            vehicleId: first.id,
            fuelType: FuelType.CNG,
            occurredAt: new Date(Date.UTC(2026, 0, index + 1, 12)),
            odometer: 1000 + index * 500,
            quantity: 20,
            totalPrice: 30,
            unitPrice: 1.5,
            isFull: true
        }))
    });

    await page.goto(`/fuel?vehicleId=${first.id}&fuelType=${FuelType.PETROL}`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('combobox', { name: t('vehicle'), exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: t('fuelFilter'), exact: true })).toHaveCount(0);
    await expect(page.getByText(t('fuelFilter'), { exact: true })).toHaveCount(0);
    await expect(page.getByRole('row')).toHaveCount(26);
    await expect(page.getByTitle(i18n.t('users.nextPage'))).toBeEnabled();
    await page.getByTitle(i18n.t('users.nextPage')).press('Enter');
    await expect(page.getByRole('row')).toHaveCount(2);
    await choose(page, t('vehicle'), 'Synthetic Second');
    await expect(page.getByRole('row')).toHaveCount(1);
    await page.getByRole('button', { name: t('add'), exact: true }).click();
    await expect(page.getByRole('button', { name: 'Synthetic Second', exact: true })).toBeVisible();
    await expect(page.getByLabel(t('quantity', { unit: FuelUnit.KILOWATT_HOUR }))).toBeVisible();
    await page.getByRole('heading', { level: 1 }).locator('..').getByRole('button').click();
    await choose(page, t('vehicle'), 'Synthetic First');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const mobileRows = page.locator('.tope-ui-table-mobile').getByRole('listitem');
    await expect(mobileRows).toHaveCount(25);
    await mobileRows
        .first()
        .getByText(i18n.t(`vehicles:fuels.${FuelType.CNG}`), { exact: false })
        .first()
        .click();
    await expect(page.getByRole('heading', { name: t('editHeading'), exact: true })).toBeVisible();
    expect(second.id).not.toBe(first.id);
});

test('clock changes are validated in the actual date-time form', async ({ page, context }) => {
    const user = await session(context);
    await database.vehicle.create({ data: { userId: user.id, manufacturer: 'Synthetic', model: 'Clock', fuelTypes: [FuelType.PETROL] } });
    await page.goto('/fuel/new', { waitUntil: 'networkidle' });
    await fields(page, '29.03.2026 02:30:00', '1000', '40', '60');
    await page.getByRole('button', { name: t('save'), exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: t('validation.occurredAt') })).toBeVisible();
    await page.getByLabel(t('occurredAt')).fill('25.10.2026 02:30:00');
    await page.locator('input[name="quantity"]').focus();
    await choose(page, t('timeChoice'), t('timeOccurrence', { count: 2 }));
    await page.getByRole('button', { name: t('save'), exact: true }).click();
    await expect(page.getByRole('table')).toBeVisible();
    expect((await database.fuelRecord.findFirstOrThrow({ where: { vehicle: { userId: user.id } } })).occurredAt.toISOString()).toBe(
        '2026-10-25T01:30:00.000Z'
    );
});
