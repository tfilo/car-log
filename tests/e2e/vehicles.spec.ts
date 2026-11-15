import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { UserRole, UserStatus, FuelType } from '../../src/generated/prisma/enums';
import { HttpMethod, HttpStatus } from '../../src/common/http';
import { i18n } from '../../src/i18n';

const t = i18n.getFixedT('sk', 'vehicles');
let database: PrismaClient;

test.beforeAll(() => {
    if (!process.env.E2E_DATABASE_URL) throw new Error('Missing disposable database.');

    database = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.E2E_DATABASE_URL }) });
});

test.afterAll(async () => {
    await database?.$disconnect();
});

async function session(context: BrowserContext, role: UserRole = UserRole.USER) {
    const username = `vehicle${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const user = await database.user.create({
        data: { email: `${username}@example.test`, username, passwordHash: 'synthetic-not-for-login', role, status: UserStatus.ACTIVE }
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

async function selectFuel(page: Page, type: FuelType) {
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: t(`fuels.${type}`), exact: true }).click();
}

test('vehicle GUI creates, edits, uploads JPEG through tope-ui FileInput, removes pictures and confirms deletion', async ({
    page,
    context
}) => {
    const user = await session(context);
    const browserErrors: string[] = [];

    page.on('pageerror', (error) => browserErrors.push(error.message));

    await page.goto('/vehicles', { waitUntil: 'networkidle' });
    await expect(page.getByText(t('empty'), { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: t('currentPage'), exact: true })).toHaveText('0');
    await expect(page.getByRole('button', { name: t('currentPage'), exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: t('previous'), exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: t('next'), exact: true })).toBeDisabled();
    await page.locator('fieldset').screenshot({ path: test.info().outputPath('vehicles-empty-pagination.png') });
    await page.getByRole('button', { name: t('add'), exact: true }).click();
    await page
        .getByRole('heading', { name: t('createHeading'), exact: true })
        .locator('..')
        .getByRole('button')
        .click();
    await expect(page).toHaveURL(/\/vehicles\/?$/);
    await page.getByRole('button', { name: t('add'), exact: true }).click();
    await page.getByRole('button', { name: t('save'), exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: t('validation.manufacturer') })).toBeVisible();
    await page.locator('input[name="manufacturer"]').fill('Synthetic');
    await page.locator('input[name="model"]').fill('Hybrid');
    await page.locator('input[name="licensePlate"]').fill('test-123');
    await page.getByLabel(t('fields.registrationDate'), { exact: true }).fill('29.03.2020');
    await page.locator('input[name="model"]').focus();
    await selectFuel(page, FuelType.PETROL);
    await selectFuel(page, FuelType.ELECTRIC);

    const picture = await readFile(new URL('../fixtures/vehicle.jpg', import.meta.url));

    await page
        .locator('input[type="file"][name="picture"]')
        .setInputFiles({ name: 'synthetic.jpg', mimeType: 'image/jpeg', buffer: picture });
    await expect(page.getByText('synthetic.jpg', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: t('save'), exact: true }).click();
    await expect(page).toHaveURL(/\/vehicles\/?$/);
    const vehicleCard = page.getByRole('button', { name: /^Synthetic Hybrid/ });

    await expect(vehicleCard).toContainText('TEST-123');
    await expect(vehicleCard).toContainText(t(`fuels.${FuelType.PETROL}`));
    await expect(vehicleCard).toContainText(t(`fuels.${FuelType.ELECTRIC}`));
    await expect(page.locator('a[href^="/vehicles/"]')).toHaveCount(0);

    const car = await database.vehicle.findFirstOrThrow({ where: { userId: user.id }, include: { picture: true } });

    expect(car.registrationDate?.toISOString().slice(0, 10)).toBe('2020-03-29');
    expect(car.fuelTypes).toEqual([FuelType.PETROL, FuelType.ELECTRIC]);
    expect(car.picture).not.toBeNull();

    const photo = await context.request.get(`/api/vehicle-pictures/${car.id}`);

    expect(photo.status()).toBe(HttpStatus.OK);
    expect(photo.headers()['content-type']).toBe('image/jpeg');
    expect(photo.headers()['cache-control']).toBe('no-store');

    // CSRF failures do not replace or remove a picture.
    const forbidden = await context.request.delete(`/api/vehicle-pictures/${car.id}`, {
        headers: { Origin: 'https://invalid.example.test' }
    });

    expect(forbidden.status()).toBe(HttpStatus.FORBIDDEN);

    const corrupted = await context.request.post(`/api/vehicle-pictures/${car.id}`, {
        headers: { Origin: test.info().project.use.baseURL!, 'Content-Type': 'image/jpeg' },
        data: Buffer.from('<svg/>')
    });

    expect(corrupted.status()).toBe(HttpStatus.BAD_REQUEST);

    const cookie = (await context.cookies()).map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    const tooLarge = {
        method: HttpMethod.POST,
        headers: { Origin: test.info().project.use.baseURL!, Cookie: cookie },
        duplex: 'half' as const,
        body: new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(10 * 1024 * 1024));
                controller.enqueue(new Uint8Array(1));
                controller.close();
            }
        })
    };
    const oversized = await fetch(`${test.info().project.use.baseURL}/api/vehicle-pictures/${car.id}`, tooLarge);

    expect(oversized.status).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    expect((await database.vehicle.findUniqueOrThrow({ where: { id: car.id } })).pictureId).toBe(car.pictureId);

    await page.getByRole('button', { name: /^Synthetic (Hybrid|Updated)/ }).click();
    await expect(page.getByRole('img')).toBeVisible();
    await page.locator('input[name="model"]').fill('Updated');
    await page.getByRole('button', { name: t('picture.remove'), exact: true }).click();
    await expect(page.getByRole('img')).toHaveCount(0);

    expect((await context.request.get(`/api/vehicle-pictures/${car.id}`)).status()).toBe(HttpStatus.NOT_FOUND);

    await page.getByRole('button', { name: t('save'), exact: true }).click();
    await expect(page).toHaveURL(/\/vehicles\/?$/);
    await page.getByRole('button', { name: /^Synthetic (Hybrid|Updated)/ }).click();
    await page.getByRole('button', { name: t('delete.button'), exact: true }).click();

    const dialog = page.getByRole('dialog');

    await expect(dialog).toContainText('Synthetic Updated');
    await expect(dialog).toContainText(t('delete.warning'));
    await dialog.getByRole('button', { name: i18n.t('common.cancel'), exact: true }).click();
    expect(await database.vehicle.findUnique({ where: { id: car.id } })).not.toBeNull();
    await page.getByRole('button', { name: t('delete.button'), exact: true }).click();
    await dialog.getByRole('button', { name: t('delete.button'), exact: true }).click();
    await expect(page).toHaveURL(/\/vehicles\/?$/);
    expect(await database.vehicle.findUnique({ where: { id: car.id } })).toBeNull();
    expect(browserErrors).toEqual([]);
});

test('vehicle and photo access stays private even for other administrators and after account deletion', async ({
    page,
    context,
    browser
}) => {
    const owner = await session(context);
    const car = await database.vehicle.create({
        data: { userId: owner.id, manufacturer: 'Private', model: 'Vehicle', fuelTypes: [FuelType.DIESEL] }
    });
    const file = await readFile(new URL('../fixtures/vehicle.jpg', import.meta.url));
    const uploaded = await context.request.post(`/api/vehicle-pictures/${car.id}`, {
        headers: { Origin: test.info().project.use.baseURL!, 'Content-Type': 'image/jpeg' },
        data: file
    });

    expect(uploaded.status()).toBe(HttpStatus.NO_CONTENT);

    const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });

    await session(other, UserRole.ADMIN);
    expect((await other.request.get(`/api/vehicle-pictures/${car.id}`)).status()).toBe(HttpStatus.NOT_FOUND);

    const otherPage = await other.newPage();

    await otherPage.goto(`/vehicles/${car.id}`, { waitUntil: 'networkidle' });
    await expect(otherPage.getByRole('alert')).toContainText(t('errors.notFound'));
    await expect(otherPage.locator('input[name="manufacturer"]')).toHaveCount(0);
    await other.close();

    await page.goto('/profile', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: i18n.t('account.delete'), exact: true }).click();

    const dialog = page.getByRole('dialog');

    await dialog.locator('input').fill(owner.username);
    await dialog.getByRole('button', { name: i18n.t('account.delete'), exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await database.vehicle.findUnique({ where: { id: car.id } })).toBeNull();
    expect((await context.request.get(`/api/vehicle-pictures/${car.id}`)).status()).toBe(HttpStatus.UNAUTHORIZED);
});

test('vehicle pages use zero-based pagination and a failed picture can be retried without duplicating the car', async ({
    page,
    context
}) => {
    const user = await session(context);
    await database.vehicle.createMany({
        data: Array.from({ length: 13 }, (_, index) => ({
            userId: user.id,
            manufacturer: 'Synthetic',
            model: `Page ${index}`,
            fuelTypes: [FuelType.PETROL]
        }))
    });

    await page.goto('/vehicles', { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: /^Synthetic Page \d/ })).toHaveCount(12);
    await expect(page.getByRole('button', { name: t('previous'), exact: true })).toBeDisabled();
    await page.getByRole('button', { name: t('next'), exact: true }).press('Enter');
    await expect(page.getByRole('button', { name: /^Synthetic Page \d/ })).toHaveCount(1);
    await expect(page.getByRole('button', { name: t('currentPage'), exact: true })).toHaveText('2');
    await expect(page.getByRole('button', { name: t('next'), exact: true })).toBeDisabled();
    await page.getByRole('button', { name: t('previous'), exact: true }).click();
    await expect(page.getByRole('button', { name: /^Synthetic Page \d/ })).toHaveCount(12);
    await page.getByRole('button', { name: t('currentPage'), exact: true }).click();
    await page.getByRole('button', { name: '2', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Synthetic Page \d/ })).toHaveCount(1);
    await expect(page.getByRole('button', { name: t('currentPage'), exact: true })).toHaveText('2');
    await page.locator('fieldset').screenshot({ path: test.info().outputPath('vehicles-desktop-pagination.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('fieldset').screenshot({ path: test.info().outputPath('vehicles-mobile-pagination.png') });

    await page.getByRole('button', { name: t('add'), exact: true }).click();
    await page.locator('input[name="manufacturer"]').fill('Synthetic');
    await page.locator('input[name="model"]').fill('Retry');
    await selectFuel(page, FuelType.ELECTRIC);
    await page.locator('input[type="file"][name="picture"]').setInputFiles({
        name: 'broken.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from('invalid image')
    });
    await page.getByRole('button', { name: t('save'), exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: t('picture.partialSave') })).toHaveText(t('picture.partialSave'));
    await expect(page.getByRole('alert')).toHaveText(t('errors.pictureInvalid'));
    expect(await database.vehicle.count({ where: { userId: user.id, model: 'Retry' } })).toBe(1);

    await page.locator('input[type="file"][name="picture"]').setInputFiles({
        name: 'retry.jpg',
        mimeType: 'image/jpeg',
        buffer: await readFile(new URL('../fixtures/vehicle.jpg', import.meta.url))
    });
    await page.getByRole('button', { name: t('save'), exact: true }).click();
    await expect(page).toHaveURL(/\/vehicles\/?$/);
    expect(await database.vehicle.count({ where: { userId: user.id, model: 'Retry' } })).toBe(1);
    const saved = await database.vehicle.findFirstOrThrow({ where: { userId: user.id, model: 'Retry' } });
    expect(saved.pictureId).not.toBeNull();
});

test('prefetched vehicle data is reused on mount/navigation and invalidated after saving', async ({ page, context }) => {
    const user = await session(context);
    const manufacturer = 'Synthetic cache';
    const vehicle = await database.vehicle.create({
        data: { userId: user.id, manufacturer, model: 'Before', fuelTypes: [FuelType.PETROL] }
    });
    const reads: string[] = [];
    // Identify list/detail reads from GET payloads without reading bodies across navigation.
    page.on('request', (request) => {
        if (request.method() !== HttpMethod.GET || !request.url().includes('/_serverFn/')) return;

        const payload = new URL(request.url()).searchParams.get('payload') ?? '';

        if (payload.includes(vehicle.id) || payload.includes('pageSize')) {
            reads.push(request.url());
        }
    });

    await page.goto('/vehicles', { waitUntil: 'networkidle' });
    expect(reads).toHaveLength(0);

    await page.getByText(`${manufacturer} Before`, { exact: true }).click();
    await expect(page.locator('input[name="model"]')).toHaveValue('Before');
    await page.waitForLoadState('networkidle');
    expect(reads).toHaveLength(1);

    await page
        .getByRole('heading', { name: t('editHeading'), exact: true })
        .locator('..')
        .getByRole('button')
        .click();
    await expect(page).toHaveURL(/\/vehicles$/);
    await page.waitForLoadState('networkidle');
    expect(reads).toHaveLength(1);

    await page.getByText(`${manufacturer} Before`, { exact: true }).click();
    await expect(page.locator('input[name="model"]')).toHaveValue('Before');
    await page.waitForLoadState('networkidle');
    expect(reads).toHaveLength(1);

    await page.locator('input[name="model"]').fill('After');
    await page.getByRole('button', { name: t('save'), exact: true }).click();
    await expect(page).toHaveURL(/\/vehicles$/);
    await expect(page.getByText(`${manufacturer} After`, { exact: true })).toBeVisible();
    await expect(page.getByText(`${manufacturer} Before`, { exact: true })).toHaveCount(0);
});
