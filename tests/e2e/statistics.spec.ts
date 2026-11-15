import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { FuelType, UserRole, UserStatus } from '../../src/generated/prisma/enums';
import { createOwnedFuelRecord } from '../../src/fuel/fuel.server';
import { FuelPriceInput } from '../../src/fuel/fuel-values';
import { ResultKind } from '../../src/common/result-kind';
import { HttpStatus } from '../../src/common/http';
import { i18n } from '../../src/i18n';

const t = i18n.getFixedT('sk', 'statistics');
let database: PrismaClient;

test.use({ timezoneId: 'America/New_York', actionTimeout: 10_000 });

test.beforeAll(() => {
    database = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.E2E_DATABASE_URL! }) });
});

test.afterAll(async () => {
    await database.$disconnect();
});

async function session(context: BrowserContext) {
    const username = `guistats${randomUUID().replaceAll('-', '').slice(0, 16)}`;
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

    return { ...user, token };
}

async function choose(page: Page, label: string, option: string) {
    await page.getByRole('combobox', { name: label, exact: false }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
}

async function seed(user: { id: string; token: string }) {
    const car = await database.vehicle.create({
        data: { userId: user.id, manufacturer: 'Synthetic', model: 'Hybrid', fuelTypes: [FuelType.PETROL, FuelType.ELECTRIC] }
    });
    const category = await database.expenseCategory.create({ data: { userId: user.id, name: 'Synthetic service', isArchived: true } });

    for (const [day, odometer, quantity, cost] of [
        ['2026-01-31', 1000, 20, 30],
        ['2026-02-02', 1400, 40, 60],
        ['2026-02-05', 2000, 30, 60]
    ] as const) {
        const outcome = await createOwnedFuelRecord(
            user.token,
            {
                vehicleId: car.id,
                fuelType: FuelType.PETROL,
                occurredAt: day + 'T12:00:00Z',
                odometer,
                quantity,
                price: { type: FuelPriceInput.TOTAL, totalPrice: cost },
                isFull: true
            },
            database
        );
        expect(outcome.result.kind).toBe(ResultKind.CREATED);
    }
    await createOwnedFuelRecord(
        user.token,
        {
            vehicleId: car.id,
            fuelType: FuelType.ELECTRIC,
            occurredAt: '2026-02-06T12:00:00Z',
            odometer: 2000,
            quantity: 25,
            price: { type: FuelPriceInput.TOTAL, totalPrice: 7.5 },
            isFull: true
        },
        database
    );
    await database.expense.create({
        data: {
            userId: user.id,
            vehicleId: car.id,
            categoryId: category.id,
            totalPrice: 100.3,
            odometer: 2100,
            occurredAt: new Date('2026-02-10T12:00:00Z')
        }
    });

    return { car, category };
}

test('statistics server-render summaries, filter inclusive dates, render charts and keep fuels separate', async ({
    page,
    context,
    request
}) => {
    const user = await session(context);
    const { car, category } = await seed(user);
    const errors: string[] = [];

    page.on('pageerror', (error) => errors.push(error.message));
    const html = await context.request.get(`/statistics?vehicleId=${car.id}`);

    expect(html.status()).toBe(HttpStatus.OK);
    expect(await html.text()).toContain('257,80');
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: i18n.t('navigation.statistics'), exact: true }).click();
    await expect(page.getByRole('heading', { name: t('heading'), exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: t('vehicle'), exact: true })).toHaveCount(0);
    await expect(page.getByRole('figure', { name: t('costChart'), exact: true }).getByRole('application')).toBeVisible();
    await expect(page.getByRole('figure', { name: t('priceChart', { unit: 'L' }), exact: true }).getByRole('application')).toBeVisible();

    await choose(page, t('period'), t('periods.custom'));
    await page.locator('input[name="from"]').fill('01.02.2026');
    await page.locator('input[name="to"]').fill('28.02.2026');
    await page.getByRole('button', { name: t('apply'), exact: true }).click();
    await expect(page.getByText('227,80 €', { exact: true })).toBeVisible();
    await expect(page.getByText('7 L/100 km', { exact: true })).toBeVisible();
    await expect(page.getByText('1,71 €/L', { exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: t('categoryTotal'), exact: true })).toBeVisible();
    await expect(page.getByRole('table')).toContainText(t('archivedLabel', { name: category.name }));
    await expect(page.getByText(t('coverageValue', { count: 2, distance: '1\u00a0000' }), { exact: true })).toBeVisible();

    const prices = page.getByRole('figure', { name: t('priceChart', { unit: 'L' }), exact: true });
    const firstDot = prices.locator('circle.recharts-line-dot').first();

    await firstDot.hover();
    await expect(prices).toContainText('1,5 €/L');
    await choose(page, t('chartFuel'), i18n.t(`fuels.${FuelType.ELECTRIC}`, { ns: 'vehicles' }));
    await expect(page.getByRole('figure', { name: t('priceChart', { unit: 'kWh' }), exact: true }).locator('svg')).toBeVisible();
    await expect(page.getByRole('figure', { name: t('consumptionChart', { unit: 'kWh' }), exact: true })).toHaveCount(0);
    await expect(page.getByText(t('evHelp'), { exact: true }).last()).toBeVisible();
    expect(errors).toEqual([]);

    const anonymous = await request.get('/statistics');

    expect(anonymous.url()).toContain('/login');
});

test('mobile statistics support multiple vehicles, validate custom filters and show honest empty states', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const user = await session(context);
    const { car } = await seed(user);
    const singleFuelCar = await database.vehicle.create({
        data: { userId: user.id, manufacturer: 'Synthetic', model: 'Empty', fuelTypes: [FuelType.CNG] }
    });
    await page.goto(`/statistics?vehicleId=${car.id}`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('figure', { name: t('costChart'), exact: true }).getByRole('application')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await choose(page, t('period'), t('periods.custom'));
    await page.locator('input[name="from"]').fill('02.02.2026');
    await page.locator('input[name="to"]').fill('01.02.2026');
    await page.getByRole('button', { name: t('apply'), exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: t('validation.dateOrder') })).toBeVisible();
    await choose(page, t('vehicle'), 'Synthetic Empty');
    await choose(page, t('period'), t('periods.all'));
    await page.getByRole('button', { name: t('apply'), exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: t('empty') })).toHaveText(t('empty'));
    await expect(page.getByText(t('unavailable'), { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('figure')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await database.fuelRecord.create({
        data: {
            vehicleId: singleFuelCar.id,
            fuelType: FuelType.CNG,
            occurredAt: new Date('2026-02-01T12:00:00Z'),
            odometer: 1000,
            quantity: 20,
            totalPrice: 30,
            unitPrice: 1.5,
            isFull: true
        }
    });
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('figure', { name: t('priceChart', { unit: 'kg' }), exact: true }).locator('svg')).toBeVisible();
    await expect(page.getByRole('combobox', { name: t('chartFuel'), exact: true })).toHaveCount(0);
    await expect(page.getByText(t('chartFuel'), { exact: true })).toHaveCount(0);
});

test('statistics never expose another user vehicle, and accounts with no cars can navigate to vehicle creation', async ({
    page,
    context
}) => {
    const user = await session(context);

    await page.goto('/statistics', { waitUntil: 'networkidle' });
    await expect(page.getByText(t('noVehicles'), { exact: true })).toBeVisible();
    await page.getByRole('button', { name: t('addVehicle'), exact: true }).click();
    await expect(page).toHaveURL(/\/vehicles\/new/);

    const other = await database.user.create({
        data: {
            username: 'other' + randomUUID().replaceAll('-', '').slice(0, 16),
            email: randomUUID() + '@example.test',
            passwordHash: 'synthetic-unused',
            role: UserRole.ADMIN,
            status: UserStatus.ACTIVE
        }
    });
    const car = await database.vehicle.create({
        data: { userId: other.id, manufacturer: 'Private', model: 'Hidden', fuelTypes: [FuelType.DIESEL] }
    });

    await page.goto(`/statistics?vehicleId=${car.id}`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('alert')).toHaveText(t('errors.vehicleNotFound'));
    await expect(page.getByText('Private Hidden', { exact: true })).toHaveCount(0);
    expect(user.id).not.toBe(other.id);
});
