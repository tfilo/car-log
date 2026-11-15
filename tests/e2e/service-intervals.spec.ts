import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { FuelType, UserStatus } from '../../src/generated/prisma/enums';
import { i18n } from '../../src/i18n';

const t = i18n.getFixedT('sk', 'expenses');

test('category intervals show independent vehicle reminders and completed service resets them', async ({ page, context }) => {
    const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.E2E_DATABASE_URL! }) });
    try {
        const username = `service${randomUUID().replaceAll('-', '').slice(0, 12)}`;
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
            data: { userId: user.id, manufacturer: 'Synthetic', model: 'Service', fuelTypes: [FuelType.PETROL] }
        });
        const secondCar = await database.vehicle.create({
            data: { userId: user.id, manufacturer: 'Synthetic', model: 'Second', fuelTypes: [FuelType.PETROL] }
        });
        const oil = await database.expenseCategory.create({ data: { userId: user.id, name: 'Synthetic oil', serviceIntervalKm: 10000 } });
        const inspection = await database.expenseCategory.create({
            data: { userId: user.id, name: 'Synthetic inspection', serviceIntervalMonths: 12 }
        });
        await database.expense.createMany({
            data: [
                {
                    userId: user.id,
                    vehicleId: car.id,
                    categoryId: oil.id,
                    odometer: 80000,
                    totalPrice: 100,
                    occurredAt: new Date('2020-01-31T11:00:00Z')
                },
                {
                    userId: user.id,
                    vehicleId: secondCar.id,
                    categoryId: oil.id,
                    odometer: 80000,
                    totalPrice: 100,
                    occurredAt: new Date('2020-01-31T11:00:00Z')
                },
                {
                    userId: user.id,
                    vehicleId: car.id,
                    categoryId: inspection.id,
                    odometer: 81000,
                    totalPrice: 50,
                    occurredAt: new Date('2020-02-28T11:00:00Z')
                }
            ]
        });
        await database.fuelRecord.create({
            data: {
                vehicleId: car.id,
                fuelType: FuelType.PETROL,
                occurredAt: new Date(),
                odometer: 89500,
                quantity: 40,
                totalPrice: 60,
                unitPrice: 1.5,
                isFull: true
            }
        });
        const privateUsername = `private${randomUUID().replaceAll('-', '').slice(0, 12)}`;
        const privateUser = await database.user.create({
            data: { username: privateUsername, email: `${privateUsername}@example.test`, passwordHash: 'synthetic-unused' }
        });
        await database.expenseCategory.create({ data: { userId: privateUser.id, name: 'Private service category', serviceIntervalKm: 1 } });
        await page.goto('/', { waitUntil: 'networkidle' });
        await expect(page.getByText('Private service category', { exact: false })).toHaveCount(0);
        const warning = page.getByRole('status').filter({ hasText: `Synthetic Service · ${oil.name}` });
        const danger = page.getByRole('status').filter({ hasText: `Synthetic Service · ${inspection.name}` });
        await expect(warning).toContainText(t('service.status.warning'));
        await expect(warning).toContainText('90 000');
        await expect(danger).toContainText(t('service.status.due'));
        await expect(page.getByRole('status').filter({ hasText: `Synthetic Second · ${oil.name}` })).toHaveCount(0);
        await page.screenshot({ path: test.info().outputPath('service-desktop.png'), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: test.info().outputPath('service-mobile.png'), fullPage: true });
        await warning.getByRole('button', { name: t('service.record'), exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`categoryId=${oil.id}`));
        await expect(page.getByRole('button', { name: oil.name, exact: true })).toBeVisible();
        await page.locator('input[name="odometer"]').fill('89500');
        await page.locator('input[name="totalPrice"]').fill('100');
        await page.getByRole('button', { name: t('save'), exact: true }).click();
        await expect(page).toHaveURL(/\/expenses\/?\?/);
        await page.goto('/', { waitUntil: 'networkidle' });
        await expect(warning).toHaveCount(0);
        await expect(danger).toBeVisible();
        await page.setViewportSize({ width: 1280, height: 960 });
        await page.goto('/expenses/categories', { waitUntil: 'networkidle' });
        const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: oil.name, exact: true }) });
        await row.getByRole('cell').first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.locator('input[name="serviceIntervalKm"]')).toHaveValue('10000');
        await dialog.locator('input[name="serviceIntervalMonths"]').fill('12');
        await dialog.screenshot({ path: test.info().outputPath('service-category.png') });
        await dialog.getByRole('button', { name: t('categories.save'), exact: true }).click();
        await expect(dialog).not.toBeVisible();
        expect((await database.expenseCategory.findUniqueOrThrow({ where: { id: oil.id } })).serviceIntervalMonths).toBe(12);
        await page
            .getByRole('row')
            .filter({ has: page.getByRole('cell', { name: inspection.name, exact: true }) })
            .getByRole('button', { name: t('categories.archive'), exact: true })
            .click();
        await page.goto('/', { waitUntil: 'networkidle' });
        await expect(danger).toHaveCount(0);
        const latestService = await database.expense.findFirstOrThrow({
            where: { vehicleId: car.id, categoryId: oil.id },
            orderBy: { occurredAt: 'desc' }
        });
        await database.expense.delete({ where: { id: latestService.id } });
        await page.reload({ waitUntil: 'networkidle' });
        await expect(warning).toContainText(t('service.status.due'));
    } finally {
        await database.$disconnect();
    }
});
