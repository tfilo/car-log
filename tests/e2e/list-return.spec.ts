import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { FuelType, UserStatus } from '../../src/generated/prisma/enums';
import { i18n } from '../../src/i18n';

test.use({ actionTimeout: 10000 });

for (const domain of ['fuel', 'expenses'] as const) {
    test(`${domain} keeps page and filters on edit/add/back, resets after deletion, and clamps emptied pages`, async ({
        page,
        context
    }) => {
        test.setTimeout(150000);
        const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.E2E_DATABASE_URL! }) });
        const t = i18n.getFixedT('sk', domain);

        try {
            const username = `return${randomUUID().replaceAll('-', '').slice(0, 12)}`;
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
                data: { userId: user.id, manufacturer: 'Synthetic', model: 'Return', fuelTypes: [FuelType.PETROL, FuelType.ELECTRIC] }
            });
            await database.vehicle.create({
                data: { userId: user.id, manufacturer: 'Synthetic', model: 'Second', fuelTypes: [FuelType.PETROL] }
            });
            const category = await database.expenseCategory.create({ data: { userId: user.id, name: 'Service' } });
            const otherCategory = await database.expenseCategory.create({ data: { userId: user.id, name: 'Other' } });
            const rows = Array.from({ length: 27 }, (_, index) => ({
                vehicleId: car.id,
                occurredAt: new Date(Date.UTC(2026, 0, index + 1, 12)),
                odometer: 1000 + index * 10,
                totalPrice: 15
            }));

            if (domain === 'fuel') {
                await database.fuelRecord.createMany({
                    data: rows.map((row) => ({ ...row, fuelType: FuelType.PETROL, quantity: 10, unitPrice: 1.5, isFull: true }))
                });
            } else {
                await database.expense.createMany({ data: rows.map((row) => ({ ...row, userId: user.id, categoryId: category.id })) });
            }

            const listState: Record<string, string> = { vehicleId: car.id };
            if (domain === 'fuel') listState.fuelType = FuelType.PETROL;
            else listState.categoryId = category.id;

            const listUrl = `/${domain}?${new URLSearchParams(listState)}`;
            const next = async () => {
                const button = page.getByTitle(i18n.t('users.nextPage'));
                await expect(button).toBeEnabled();
                await button.press('Enter');
            };
            const openRow = async () => {
                await page
                    .getByRole('row')
                    .filter({ has: page.getByRole('cell') })
                    .first()
                    .getByRole('cell')
                    .first()
                    .click();
                await expect(page.getByRole('heading', { name: t('editHeading'), exact: true })).toBeVisible();
            };
            const back = () => page.getByRole('heading', { level: 1 }).locator('..').getByRole('button').click();
            const returnState = () => JSON.parse(new URL(page.url()).searchParams.get('returnTo')!);

            async function expectList(index: number) {
                await expect(page).toHaveURL(
                    (url) => url.pathname.replace(/\/$/, '') === `/${domain}` && url.searchParams.get('page') === String(index)
                );
                for (const [key, value] of Object.entries(listState)) expect(new URL(page.url()).searchParams.get(key)).toBe(value);
                await expect(page.getByRole('table')).toBeVisible();
                await expect(page.getByRole('dialog')).toHaveCount(0);
                await expect(page.getByRole('table').locator('..')).toHaveAttribute('aria-busy', 'false');
            }

            await page.goto(listUrl, { waitUntil: 'networkidle' });
            await next();
            await expect(page.getByRole('row')).toHaveCount(3);
            await openRow();
            await expect(page.getByRole('heading', { name: t('editHeading'), exact: true })).toBeVisible();
            expect(returnState()).toEqual({ ...listState, page: 1 });
            await page.locator(`input[name="${domain === 'fuel' ? 'priceAmount' : 'totalPrice'}"]`).fill('16');
            await page.getByRole('button', { name: t('save'), exact: true }).click();
            await expectList(1);
            await expect(page.getByRole('row')).toHaveCount(3);

            await page.getByRole('button', { name: t('add'), exact: true }).click();
            expect(returnState()).toEqual({ ...listState, page: 1 });
            await page.getByLabel(t('occurredAt')).fill('01.02.2026 14:00:00');
            await page.locator('input[name="odometer"]').fill('2000');
            if (domain === 'fuel') await page.locator('input[name="quantity"]').fill('10');
            await page.locator(`input[name="${domain === 'fuel' ? 'priceAmount' : 'totalPrice'}"]`).fill('20');
            await page.getByRole('button', { name: t('save'), exact: true }).click();
            await expectList(1);
            await expect(page.getByRole('row')).toHaveCount(4);

            await page.getByRole('button', { name: t('add'), exact: true }).click();
            await back();
            await expectList(1);
            await openRow();
            await back();
            await expectList(1);

            // Delete from the edit screen, then directly from page two of the list.
            await openRow();
            await page.getByRole('button', { name: t('deleteRecord'), exact: true }).click();
            await page
                .getByRole('dialog')
                .getByRole('button', { name: t('deleteRecord'), exact: true })
                .click();
            await expectList(0);
            await expect(page.getByRole('row')).toHaveCount(26);
            await next();
            await page
                .getByRole('row')
                .filter({ has: page.getByRole('cell') })
                .first()
                .getByRole('button', { name: t('deleteRecord'), exact: true })
                .click();
            await page
                .getByRole('dialog')
                .getByRole('button', { name: t('deleteRecord'), exact: true })
                .click();
            await expectList(0);
            await expect(page.getByRole('row')).toHaveCount(26);

            // Move the remaining second-page record out of the original filter.
            await next();
            await expect(page.getByRole('row')).toHaveCount(2);
            await openRow();
            const label = domain === 'fuel' ? t('fuelType') : t('category');
            await page.getByRole('combobox', { name: label, exact: false }).click();
            await page
                .getByRole('option', {
                    name: domain === 'fuel' ? i18n.t(`vehicles:fuels.${FuelType.ELECTRIC}`) : otherCategory.name,
                    exact: true
                })
                .click();
            await page.getByRole('button', { name: t('save'), exact: true }).click();
            await expectList(1);
            await expect(page.getByRole('row')).toHaveCount(26);
            await page.getByRole('button', { name: t('add'), exact: true }).click();
            expect(returnState()).toEqual({ ...listState, page: 0 });
        } finally {
            await database.$disconnect();
        }
    });
}
