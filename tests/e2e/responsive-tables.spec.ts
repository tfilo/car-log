import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { FuelType, UserRole, UserStatus } from '../../src/generated/prisma/enums';
import { i18n } from '../../src/i18n';

// All screenshots and checks use a disposable database and synthetic accounts.
test('all tables have compact mobile rows and independent actions', async ({ page, context }) => {
    const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.E2E_DATABASE_URL! }) });

    try {
        const username = `responsive${randomUUID().replaceAll('-', '').slice(0, 12)}`;
        const user = await database.user.create({
            data: {
                username,
                email: `${username}@example.test`,
                passwordHash: 'synthetic-unused',
                role: UserRole.ADMIN,
                status: UserStatus.ACTIVE
            }
        });
        const pendingUsername = `pending${randomUUID().replaceAll('-', '').slice(0, 12)}`;
        await database.user.create({
            data: {
                username: pendingUsername,
                email: `${pendingUsername}@example.test`,
                passwordHash: 'synthetic-unused',
                status: UserStatus.PENDING
            }
        });
        const token = randomBytes(32).toString('base64url');
        await database.session.create({
            data: {
                userId: user.id,
                tokenHash: createHash('sha256').update(token).digest('hex'),
                expiresAt: new Date(Date.now() + 86_400_000)
            }
        });
        await context.addCookies([
            { name: 'car_log_session', value: token, url: test.info().project.use.baseURL!, httpOnly: true, sameSite: 'Lax' }
        ]);
        const vehicle = await database.vehicle.create({
            data: {
                userId: user.id,
                manufacturer: 'Synthetic',
                model: 'Family',
                fuelTypes: [FuelType.PETROL, FuelType.ELECTRIC]
            }
        });
        const category = await database.expenseCategory.create({ data: { userId: user.id, name: 'Service' } });
        const fuel = await database.fuelRecord.create({
            data: {
                vehicleId: vehicle.id,
                fuelType: FuelType.PETROL,
                occurredAt: new Date('2026-11-10T17:30:00Z'),
                odometer: 12450,
                quantity: 40,
                totalPrice: 64.8,
                unitPrice: 1.62,
                isFull: true
            }
        });
        await database.fuelRecord.create({
            data: {
                vehicleId: vehicle.id,
                fuelType: FuelType.ELECTRIC,
                occurredAt: new Date('2026-11-08T19:15:00Z'),
                odometer: 12310,
                quantity: 24,
                totalPrice: 8.4,
                unitPrice: 0.35,
                isFull: true
            }
        });
        const expense = await database.expense.create({
            data: {
                userId: user.id,
                vehicleId: vehicle.id,
                categoryId: category.id,
                occurredAt: new Date('2026-11-07T11:00:00Z'),
                odometer: 12200,
                totalPrice: 129.9,
                comment: 'Synthetic maintenance record'
            }
        });

        for (const width of [1280, 390]) {
            await page.setViewportSize({ width, height: 960 });
            await page.goto('/', { waitUntil: 'networkidle' });
            await expect(page.getByRole('heading', { name: i18n.t('home.heading'), exact: true })).toBeVisible();
            await expect(page.getByText('12 450 km', { exact: true })).toBeVisible();
            await page.screenshot({ path: test.info().outputPath(`home-${width}.png`) });
        }

        for (const [path, name] of [
            ['/fuel', 'fuel'],
            ['/expenses', 'expenses'],
            ['/expenses/categories', 'categories'],
            ['/users', 'users'],
            ['/statistics', 'statistics']
        ]) {
            for (const [device, width, height] of [
                ['desktop', 1280, 960],
                ['mobile', 390, 844]
            ] as const) {
                await page.setViewportSize({ width, height });
                await page.goto(path, { waitUntil: 'networkidle' });
                if (device === 'desktop') {
                    await expect(page.getByRole('table')).toBeVisible();
                    if (name !== 'statistics') {
                        const actionCells = page
                            .getByRole('row')
                            .filter({ has: page.getByRole('cell') })
                            .locator('td:last-child');
                        await expect(actionCells.first()).toHaveCSS('position', 'sticky');
                        await expect(actionCells.first()).toHaveCSS('border-left-width', '1px');
                        const aligned = await actionCells.evaluateAll((cells) =>
                            cells.every((cell) => {
                                const group = cell.firstElementChild!;
                                const right = cell.getBoundingClientRect().right - parseFloat(getComputedStyle(cell).paddingRight);
                                return Math.abs(right - group.getBoundingClientRect().right) <= 1;
                            })
                        );
                        expect(aligned).toBe(true);
                    }
                } else {
                    await expect(page.getByRole('table')).toBeHidden();
                    await expect(page.locator('.tope-ui-table-mobile').getByRole('listitem').first()).toBeVisible();
                    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
                }
                await page.screenshot({ path: test.info().outputPath(`${name}-${device}.png`) });
                if (name === 'statistics') {
                    await page
                        .locator('.tope-ui-table-mobile')
                        .locator('..')
                        .locator('..')
                        .screenshot({ path: test.info().outputPath(`statistics-table-${device}.png`) });
                }
                if (device === 'mobile' && (name === 'fuel' || name === 'users')) {
                    const menu = page.locator('.tope-ui-table-mobile').getByRole('listitem').first().getByRole('button');
                    await expect(menu.locator('svg')).toHaveCount(0);
                    await menu.click();
                    await page.screenshot({ path: test.info().outputPath(`${name}-mobile-actions.png`) });
                    await page.keyboard.press('Escape');
                }
            }
        }

        await page.goto('/fuel', { waitUntil: 'networkidle' });
        await page.locator('.tope-ui-table-mobile').getByRole('listitem').first().click();
        await expect(page).toHaveURL((url) => url.pathname === `/fuel/${fuel.id}`);
        await page.goto('/expenses', { waitUntil: 'networkidle' });
        await page
            .locator('.tope-ui-table-mobile')
            .getByRole('listitem')
            .first()
            .getByRole('button', { name: i18n.t('expenses:actions'), exact: true })
            .click();
        await page.getByRole('button', { name: i18n.t('expenses:deleteRecord'), exact: true }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page).toHaveURL(/\/expenses\/?$/);
        expect(await database.expense.findUnique({ where: { id: expense.id } })).not.toBeNull();
        await page.goto('/expenses/categories', { waitUntil: 'networkidle' });
        await page.locator('.tope-ui-table-mobile').getByRole('listitem').first().click();
        await expect(page.getByRole('dialog').locator('input[name="name"]')).toHaveValue(category.name);
        await page.setViewportSize({ width: 1280, height: 960 });
        await page.goto('/fuel', { waitUntil: 'networkidle' });
        await page.getByRole('cell', { name: '64,80 €', exact: true }).click();
        await expect(page).toHaveURL((url) => url.pathname === `/fuel/${fuel.id}`);
        await page.goto('/users', { waitUntil: 'networkidle' });
        await expect(page.getByRole('button', { name: i18n.t('users.actionsHeading'), exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: i18n.t('users.actions.setRole'), exact: true }).first()).toBeVisible();
    } finally {
        await database.$disconnect();
    }
});
