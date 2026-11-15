import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { FuelType, UserRole, UserStatus } from '../../src/generated/prisma/enums';
import { i18n } from '../../src/i18n';

const t = i18n.getFixedT('sk', 'expenses');
let database: PrismaClient;

test.use({ timezoneId: 'America/New_York', actionTimeout: 10_000 });

test.beforeAll(() => {
    database = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.E2E_DATABASE_URL! }) });
});

test.afterAll(async () => {
    await database.$disconnect();
});

async function session(context: BrowserContext) {
    const username = `guiexpense${randomUUID().replaceAll('-', '').slice(0, 14)}`;
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

async function createCategory(page: Page, name: string) {
    await page.getByRole('button', { name: t('categories.add'), exact: true }).click();
    await page.getByRole('dialog').locator('input[name="name"]').fill(name);
    await page
        .getByRole('dialog')
        .getByRole('button', { name: t('categories.save'), exact: true })
        .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('table')).toContainText(name.trim());
}

test('header links to expenses, category management stays local, and forms create/edit/delete EUR expenses', async ({ page, context }) => {
    const user = await session(context);
    const car = await database.vehicle.create({
        data: { userId: user.id, manufacturer: 'Synthetic', model: 'Expense', fuelTypes: [FuelType.PETROL] }
    });
    const browserErrors: string[] = [];

    page.on('pageerror', (error) => browserErrors.push(error.message));
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: i18n.t('navigation.expenses'), exact: true }).click();
    await expect(page.getByRole('heading', { name: t('heading'), exact: true })).toBeVisible();
    await expect(page.getByRole('banner').getByText(t('categories.heading'), { exact: true })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: t('vehicle'), exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: t('add'), exact: true }).click();
    await expect(page.getByText(t('noCategories'), { exact: true })).toBeVisible();
    await page.getByRole('button', { name: t('categories.manage'), exact: true }).click();
    await createCategory(page, 'Service');

    await page.goto('/expenses/new', { waitUntil: 'networkidle' });
    await expect(page.getByRole('combobox', { name: t('vehicle'), exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: t('save'), exact: true }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await page.getByLabel(t('occurredAt')).fill('15.07.2026 14:30:00');
    await page.locator('input[name="odometer"]').fill('12300.5');
    await page.locator('input[name="totalPrice"]').fill('123.45');
    await page.locator('textarea[name="comment"]').fill('Synthetic oil change');
    await page.getByRole('button', { name: t('save'), exact: true }).click();
    await expect(page.getByRole('table')).toContainText('123,45');
    const saved = await database.expense.findFirstOrThrow({ where: { vehicleId: car.id } });

    expect(saved.occurredAt.toISOString()).toBe('2026-07-15T12:30:00.000Z');
    expect(saved.totalPrice.toNumber()).toBe(123.45);
    expect(saved.odometer.toNumber()).toBe(12300.5);

    await page.getByRole('row').filter({ hasText: 'Synthetic oil change' }).getByRole('cell').first().click();
    await page.locator('input[name="totalPrice"]').fill('125.01');
    await page.getByRole('button', { name: t('save'), exact: true }).click();
    await expect(page.getByRole('table')).toContainText('125,01');
    await page.getByRole('button', { name: t('deleteRecord'), exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText(t('deleteWarning'));
    await page
        .getByRole('dialog')
        .getByRole('button', { name: i18n.t('common.cancel'), exact: true })
        .click();
    expect(await database.expense.count({ where: { vehicleId: car.id } })).toBe(1);
    await page.getByRole('button', { name: t('deleteRecord'), exact: true }).click();
    await page
        .getByRole('dialog')
        .getByRole('button', { name: t('deleteRecord'), exact: true })
        .click();
    await expect(page.getByRole('status').filter({ hasText: t('empty') })).toHaveText(t('empty'));
    expect(await database.expense.count({ where: { vehicleId: car.id } })).toBe(0);
    expect(browserErrors).toEqual([]);
});

test('categories can be renamed, archived and restored; used categories cannot be deleted and archived ones can be retained', async ({
    page,
    context
}) => {
    const user = await session(context);
    const car = await database.vehicle.create({
        data: { userId: user.id, manufacturer: 'Synthetic', model: 'Archive', fuelTypes: [FuelType.PETROL] }
    });
    const category = await database.expenseCategory.create({ data: { userId: user.id, name: 'Servcie' } });
    const expense = await database.expense.create({
        data: {
            userId: user.id,
            vehicleId: car.id,
            categoryId: category.id,
            occurredAt: new Date('2026-07-15T12:00:00.123Z'),
            odometer: 12000,
            totalPrice: 100
        }
    });

    await page.goto('/expenses/categories', { waitUntil: 'networkidle' });
    await page.getByRole('row').filter({ hasText: 'Servcie' }).getByRole('cell').first().click();
    await page.getByRole('dialog').locator('input[name="name"]').fill('Service');
    await page
        .getByRole('dialog')
        .getByRole('button', { name: t('categories.save'), exact: true })
        .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
        page
            .getByRole('row')
            .filter({ hasText: 'Service' })
            .getByRole('button', { name: t('categories.delete'), exact: true })
    ).toBeDisabled();
    await page
        .getByRole('row')
        .filter({ hasText: 'Service' })
        .getByRole('button', { name: t('categories.archive'), exact: true })
        .click();
    await expect(page.getByRole('table')).toContainText(t('categories.archived'));
    await page.getByRole('button', { name: t('categories.add'), exact: true }).click();
    await page.getByRole('dialog').locator('input[name="name"]').fill(' service ');
    await page
        .getByRole('dialog')
        .getByRole('button', { name: t('categories.save'), exact: true })
        .click();
    await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(t('errors.categoryDuplicate'));
    await page
        .getByRole('dialog')
        .getByRole('button', { name: i18n.t('common.cancel'), exact: true })
        .click();
    await createCategory(page, 'Brakes');

    await page.goto(`/expenses/${expense.id}`, { waitUntil: 'networkidle' });
    await expect(page.getByText(t('archivedHelp'), { exact: true })).toBeVisible();
    await page.locator('textarea[name="comment"]').fill('Retained category');
    await page.getByRole('button', { name: t('save'), exact: true }).click();
    await expect(page.getByRole('table')).toContainText(t('archivedLabel', { name: 'Service' }));
    expect((await database.expense.findUniqueOrThrow({ where: { id: expense.id } })).occurredAt.toISOString()).toBe(
        '2026-07-15T12:00:00.123Z'
    );
    await page.getByRole('button', { name: t('add'), exact: true }).click();
    await page.getByRole('combobox', { name: t('category'), exact: false }).click();
    await expect(page.getByRole('option', { name: t('archivedLabel', { name: 'Service' }), exact: true })).toHaveCount(0);
    await expect(page.getByRole('option', { name: 'Brakes', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.goto('/expenses/categories', { waitUntil: 'networkidle' });
    await page
        .getByRole('row')
        .filter({ hasText: 'Service' })
        .getByRole('button', { name: t('categories.restore'), exact: true })
        .click();
    await expect(page.getByRole('row').filter({ hasText: 'Service' })).toContainText(t('categories.active'));
    await page
        .getByRole('row')
        .filter({ hasText: 'Brakes' })
        .getByRole('button', { name: t('categories.delete'), exact: true })
        .click();
    await page
        .getByRole('dialog')
        .getByRole('button', { name: t('categories.delete'), exact: true })
        .click();
    await expect(page.getByRole('table')).not.toContainText('Brakes');
});

test('mobile expense list paginates, filters vehicles/categories and keeps actions accessible', async ({ page, context, browser }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const user = await session(context);
    const first = await database.vehicle.create({
        data: { userId: user.id, manufacturer: 'Synthetic', model: 'First', fuelTypes: [FuelType.PETROL] }
    });
    await database.vehicle.create({
        data: { userId: user.id, manufacturer: 'Synthetic', model: 'Second', fuelTypes: [FuelType.DIESEL] }
    });
    const category = await database.expenseCategory.create({ data: { userId: user.id, name: 'Service' } });
    const emptyCategory = await database.expenseCategory.create({ data: { userId: user.id, name: 'Insurance' } });

    await database.expense.createMany({
        data: Array.from({ length: 26 }, (_, index) => ({
            userId: user.id,
            vehicleId: first.id,
            categoryId: category.id,
            totalPrice: 12.34,
            odometer: 12300,
            occurredAt: new Date(Date.UTC(2026, 0, index + 1)),
            comment: `Synthetic expense ${index + 1}`
        }))
    });
    await page.goto(`/expenses?vehicleId=${first.id}`, { waitUntil: 'networkidle' });
    const mobileRows = page.locator('.tope-ui-table-mobile').getByRole('listitem');
    await expect(mobileRows).toHaveCount(25);
    await page.getByTitle(i18n.t('users.nextPage')).press('Enter');
    await expect(mobileRows).toHaveCount(1);
    await mobileRows
        .first()
        .getByRole('button', { name: t('actions'), exact: true })
        .click();
    await expect(page.getByRole('button', { name: t('deleteRecord'), exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await choose(page, t('categoryFilter'), emptyCategory.name);
    await expect(page.getByRole('status').filter({ hasText: t('empty') })).toHaveText(t('empty'));
    await choose(page, t('vehicle'), 'Synthetic Second');
    await expect(page.getByRole('status').filter({ hasText: t('empty') })).toHaveText(t('empty'));
    await page.getByRole('button', { name: t('add'), exact: true }).click();
    await expect(page.getByRole('combobox', { name: t('vehicle'), exact: false })).toBeVisible();
    await expect(page.locator('input[name="totalPrice"]')).toHaveAttribute('type', 'number');

    const anonymous = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const anonymousPage = await anonymous.newPage();

    await anonymousPage.goto('/expenses/categories', { waitUntil: 'networkidle' });
    await expect(anonymousPage).toHaveURL(/\/login/);
    await anonymous.close();
});
