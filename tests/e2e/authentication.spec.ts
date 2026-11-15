import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { test, expect, type Page, type BrowserContext, type APIRequestContext } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { UserRole, UserStatus } from '../../src/generated/prisma/enums';
import { UserAction } from '../../src/users/user-action';
import { AuthErrorCode } from '../../src/auth/auth-errors';
import { HttpStatus } from '../../src/common/http';
import { hashPassword } from '../../src/auth/password.server';
import { i18n } from '../../src/i18n';
import { z } from 'zod';

const t = i18n.getFixedT('sk', 'auth');
const password = 'Password123!';
let database: PrismaClient;

test.beforeAll(() => {
    const connectionString = process.env.E2E_DATABASE_URL;

    if (!connectionString) throw new Error('Missing disposable E2E database.');

    database = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
});

test.afterAll(async () => {
    await database?.$disconnect();
});

test.beforeEach(async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' });
});

function synthetic(prefix: string) {
    const username = `${prefix}${randomUUID().replaceAll('-', '').slice(0, 12)}`;

    return { username, email: `${username}@example.test`, password };
}

async function checkPasswordVisibility(page: Page, name: string) {
    const input = page.locator(`input[name="${name}"]`);
    const value = await input.inputValue();
    const wrapper = input.locator('..');
    const maskedFields = await page.locator('input[type="password"]').count();

    await expect(input).toHaveAttribute('type', 'password');
    await expect(input).not.toHaveAttribute('autocomplete');
    await expect(wrapper.getByRole('button', { name: t('passwordVisibility.show'), exact: true })).toHaveAttribute('type', 'button');
    await wrapper.getByRole('button', { name: t('passwordVisibility.show'), exact: true }).click();
    await expect(input).toHaveAttribute('type', 'text');
    await expect(page.locator('input[type="password"]')).toHaveCount(maskedFields - 1);
    await expect(input).toHaveValue(value);
    await wrapper.getByRole('button', { name: t('passwordVisibility.hide'), exact: true }).click();
    await expect(input).toHaveAttribute('type', 'password');
    await expect(input).toHaveValue(value);
    await expect(page.locator('input[type="password"]')).toHaveCount(maskedFields);
}

async function login(page: Page, identifier: string, secret = password) {
    await page.goto('/login', { waitUntil: 'networkidle' });
    await page.locator('input[name="identifier"]').fill(identifier);
    await page.locator('input[name="password"]').fill(secret);
    await checkPasswordVisibility(page, 'password');
    await page.getByRole('button', { name: t('login.submit'), exact: true }).click();
}

async function register(page: Page, input: ReturnType<typeof synthetic>) {
    await page.goto('/register', { waitUntil: 'networkidle' });
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: t('registration.submit'), exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: t('validation.email.invalid') })).toBeVisible();
    await expect(page.getByText('validation.email.invalid', { exact: true })).toHaveCount(0);
    await page.locator('input[name="email"]').fill(input.email);
    await page.locator('input[name="username"]').fill(input.username);
    await page.locator('input[name="password"]').fill(input.password);
    await page.locator('input[name="confirmPassword"]').fill(input.password);
    await checkPasswordVisibility(page, 'password');
    await expect(page.locator('input[name="confirmPassword"]')).toHaveAttribute('type', 'password');
    await checkPasswordVisibility(page, 'confirmPassword');
    await page.getByRole('button', { name: t('registration.submit'), exact: true }).click();
}

async function seededSession(context: BrowserContext, role: UserRole = UserRole.USER) {
    const input = synthetic('seed');
    const user = await database.user.create({
        data: { email: input.email, username: input.username, passwordHash: await hashPassword(password), role, status: UserStatus.ACTIVE }
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

async function rowAction(page: Page, username: string, action: UserAction) {
    const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: username, exact: true }) });

    await row.getByRole('button', { name: t(`users.actions.${action}`), exact: true }).click();
}

const messagesSchema = z.array(z.object({ id: z.string(), to: z.array(z.object({ address: z.string() })) }));

async function emailLink(request: APIRequestContext, email: string, path: string) {
    let link: string | undefined;

    await expect
        .poll(async () => {
            const messages = messagesSchema.parse(await (await request.get('http://127.0.0.1:1080/email')).json());

            for (const message of messages.filter((message) => message.to.some((recipient) => recipient.address === email))) {
                const detail = z
                    .object({ text: z.string() })
                    .parse(await (await request.get(`http://127.0.0.1:1080/email/${message.id}`)).json());

                link = detail.text.split(/\s+/).find((part) => part.startsWith('http') && part.includes(`/${path}#token=`));

                if (link) return true;
            }

            return false;
        })
        .toBe(true);

    if (!link) throw new Error('Missing test email link');

    return link;
}

test('registration, generic login failures, profile update, logout and protected routes', async ({ page }) => {
    const errors: string[] = [];

    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/profile', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/login$/);

    const admin = synthetic('first');

    await register(page, admin);
    await expect(page.getByRole('status').filter({ hasText: t('registration.active') })).toContainText(t('registration.active'));
    await login(page, admin.username);
    await expect(page.getByRole('heading', { name: t('home.heading'), exact: true })).toBeVisible();
    await expect(page.getByRole('banner')).toBeVisible();
    await page.getByRole('button', { name: t('navigation.profile'), exact: true }).click();
    await page.locator('input[name="firstName"]').fill('Synthetic');
    await page.getByRole('button', { name: t('profile.save'), exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: t('profile.saved') })).toContainText(t('profile.saved'));
    await page.getByRole('button', { name: t('navigation.logout'), exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('main header')).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/login$/);

    const pending = synthetic('pending');

    await register(page, pending);
    await expect(page.getByRole('status').filter({ hasText: t('registration.pending') })).toContainText(t('registration.pending'));
    await login(page, pending.email);
    await expect(page.getByRole('alert')).toContainText(t('errors.invalidCredentials'));
    await login(page, 'unknownaccount');
    await expect(page.getByRole('alert')).toContainText(t('errors.invalidCredentials'));
    expect(errors).toEqual([]);
});

test('profile validates sensitive changes, rotates sessions, and supports verified email and self-deletion', async ({
    page,
    context,
    request
}) => {
    const user = await seededSession(context);

    await page.goto('/users', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/profile', { waitUntil: 'networkidle' });

    const updated = synthetic('changed');

    await page.locator('input[name="email"]').fill(updated.email);
    await page.getByRole('button', { name: t('profile.save'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(t('validation.profile.currentPasswordRequired'));
    await page.locator('input[name="currentPassword"]').fill(password);
    await page.locator('input[name="newPassword"]').fill('NewPassword123!');
    await page.locator('input[name="confirmPassword"]').fill('Different123!');
    await page.getByRole('button', { name: t('profile.save'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(t('passwordReset.passwordMismatch'));
    await page.locator('input[name="confirmPassword"]').fill('NewPassword123!');
    await checkPasswordVisibility(page, 'newPassword');
    await checkPasswordVisibility(page, 'confirmPassword');
    await checkPasswordVisibility(page, 'currentPassword');

    const oldCookie = (await context.cookies()).find((cookie) => cookie.name === 'car_log_session')!.value;

    await page.getByRole('button', { name: t('profile.save'), exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: t('profile.saved') })).toContainText(t('profile.saved'));
    expect((await context.cookies()).find((cookie) => cookie.name === 'car_log_session')!.value).not.toBe(oldCookie);
    await expect.poll(async () => database.user.findUnique({ where: { id: user.id } }).then((row) => row?.email)).toBe(updated.email);

    const verificationURL = await emailLink(request, updated.email, 'verify-email');

    await page.goto(verificationURL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: t('emailVerification.button'), exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: t('emailVerification.verified') })).toContainText(
        t('emailVerification.verified')
    );
    await page.goto('/profile', { waitUntil: 'networkidle' });
    await expect(page.getByText(t('profile.emailVerified'), { exact: true })).toBeVisible();
    await page.getByRole('button', { name: t('account.delete'), exact: true }).click();

    const dialog = page.getByRole('dialog');

    await dialog.getByRole('button', { name: t('account.delete'), exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(t('errors.accountConfirmationMismatch'));
    await dialog.locator('input').fill(user.username);
    await dialog.getByRole('button', { name: t('account.delete'), exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await database.user.findUnique({ where: { id: user.id } })).toBeNull();
});

test('administrator table paginates, confirms actions and enforces last-admin protection', async ({ page, context }) => {
    // This test owns only synthetic rows in the disposable database.
    await database.user.deleteMany();

    const admin = await seededSession(context, UserRole.ADMIN);
    const target = synthetic('target');
    const targetUser = await database.user.create({
        data: { email: target.email, username: target.username, passwordHash: 'not-used-for-login', status: UserStatus.PENDING }
    });

    await database.user.createMany({
        data: Array.from({ length: 26 }, () => {
            const input = synthetic('extra');

            return { email: input.email, username: input.username, passwordHash: 'not-used-for-login' };
        })
    });
    await page.goto('/users', { waitUntil: 'networkidle' });
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('button', { name: t('users.nextPage'), exact: true })).toBeEnabled();
    // Keyboard activation also avoids the development tools' floating trigger.
    await page.getByRole('button', { name: t('users.nextPage'), exact: true }).press('Enter');
    await expect(page.getByRole('cell', { name: admin.username, exact: true })).toBeVisible();
    await rowAction(page, admin.username, UserAction.BLOCK);
    await page
        .getByRole('dialog')
        .getByRole('button', { name: t('common.confirm'), exact: true })
        .click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(t('errors.adminLastActive'));
    await page
        .getByRole('dialog')
        .getByRole('button', { name: t('common.cancel'), exact: true })
        .click();
    await rowAction(page, targetUser.username, UserAction.APPROVE);
    await page
        .getByRole('dialog')
        .getByRole('button', { name: t('common.confirm'), exact: true })
        .click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    expect((await database.user.findUniqueOrThrow({ where: { id: targetUser.id } })).status).toBe(UserStatus.ACTIVE);

    for (const action of [UserAction.BLOCK, UserAction.UNBLOCK, UserAction.SET_ROLE, UserAction.DELETE]) {
        await expect(page.getByRole('button', { name: t('users.nextPage'), exact: true })).toBeEnabled();
        await page.getByRole('button', { name: t('users.nextPage'), exact: true }).press('Enter');
        await rowAction(page, targetUser.username, action);

        const dialog = page.getByRole('dialog');

        if (action === UserAction.SET_ROLE) {
            await dialog.getByRole('combobox').click();
            await page.getByRole('option', { name: t(`users.roles.${UserRole.ADMIN}`), exact: true }).click();
        }

        if (action === UserAction.DELETE) await dialog.locator('input').fill(targetUser.username);

        await dialog.getByRole('button', { name: t('common.confirm'), exact: true }).click();
        await expect(dialog).not.toBeVisible();
    }

    expect(await database.user.findUnique({ where: { id: targetUser.id } })).toBeNull();
    await page.goto('/profile', { waitUntil: 'networkidle' });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('banner')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('slow navigation blurs the previous page while keeping the header usable', async ({ page, context }) => {
    await seededSession(context);

    for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
        await page.goto('/profile', { waitUntil: 'networkidle' });

        let release = () => {};
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });

        await page.route('**/_serverFn/**', async (route) => {
            await pending;
            await route.continue();
        });

        try {
            await page
                .getByRole('banner')
                .getByRole('button', { name: t('navigation.vehicles'), exact: true })
                .click();
            await expect(page.getByRole('status').filter({ hasText: t('common.loading') })).toBeVisible();
            await expect(page.locator('main')).toHaveAttribute('aria-busy', 'true');
            await expect(page.locator('main [inert]')).toBeVisible();
            await expect(page.getByText(t('profile.heading'), { exact: true })).toBeVisible();
            await expect(page.getByRole('banner').getByRole('button', { name: t('navigation.profile'), exact: true })).toBeEnabled();
            await page.screenshot({ path: test.info().outputPath(`loading-${width}.png`) });
        } finally {
            release();
        }

        await expect(page.getByRole('heading', { name: i18n.t('heading', { ns: 'vehicles' }), exact: true })).toBeVisible();
        await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
        await expect(page.getByText(t('common.loading'), { exact: true })).toHaveCount(0);
        await expect(page.getByRole('banner').getByRole('button', { name: t('navigation.vehicles'), exact: true })).toHaveAttribute(
            'aria-current',
            'page'
        );
        await page.unroute('**/_serverFn/**');
    }
});

test('header highlights the resolved section including child pages', async ({ page, context }) => {
    await seededSession(context, UserRole.ADMIN);

    for (const [path, section] of [
        ['/', 'home'],
        ['/fuel', 'fuel'],
        ['/fuel/new', 'fuel'],
        ['/vehicles/new', 'vehicles'],
        ['/expenses/categories', 'expenses'],
        ['/statistics', 'statistics'],
        ['/users', 'users']
    ]) {
        await page.goto(path, { waitUntil: 'networkidle' });

        const header = page.getByRole('banner');

        await expect(header.locator('[aria-current="page"]')).toHaveCount(1);
        await expect(header.getByRole('button', { name: t(`navigation.${section}`), exact: true })).toHaveAttribute('aria-current', 'page');
    }
});

test('verified users can request a reset by username and use the emailed token only once', async ({ page, context, request }) => {
    const user = await seededSession(context);

    await database.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    await context.clearCookies();
    await page.goto('/forgot-password', { waitUntil: 'networkidle' });
    await page.locator('input[name="identifier"]').fill(user.username);
    await page.getByRole('button', { name: t('passwordReset.requestButton'), exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: t('passwordReset.requested') })).toContainText(t('passwordReset.requested'));

    const resetURL = await emailLink(request, user.email, 'reset-password');

    await page.goto(resetURL, { waitUntil: 'networkidle' });
    await page.locator('input[name="newPassword"]').fill('ResetPassword123!');
    await page.locator('input[name="confirmPassword"]').fill('Different123!');
    await page.getByRole('button', { name: t('passwordReset.button'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(t('passwordReset.passwordMismatch'));
    await page.locator('input[name="confirmPassword"]').fill('ResetPassword123!');
    await checkPasswordVisibility(page, 'newPassword');
    await checkPasswordVisibility(page, 'confirmPassword');
    await page.locator('input[name="confirmPassword"]').press('Enter');
    await expect(page.getByRole('status').filter({ hasText: t('passwordReset.reset') })).toContainText(t('passwordReset.reset'));
    expect(new URL(page.url()).hash).toBe('');
    await page
        .getByRole('heading', { name: t('passwordReset.heading'), exact: true })
        .locator('..')
        .getByRole('button')
        .click();
    await expect(page).toHaveURL(/\/login$/);
    // Reopen the email link in a fresh page visit, rather than a same-document hash change.
    await page.goto('/login', { waitUntil: 'networkidle' });
    await page.goto(resetURL, { waitUntil: 'networkidle' });
    await page.locator('input[name="newPassword"]').fill('ResetAgain123!');
    await page.locator('input[name="confirmPassword"]').fill('ResetAgain123!');
    await page.getByRole('button', { name: t('passwordReset.button'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(t('errors.passwordResetTokenInvalid'));
    await login(page, user.email, 'ResetPassword123!');
    await expect(page.getByRole('heading', { name: t('home.heading'), exact: true })).toBeVisible();
});

test('blocking revokes an open browser session and unblocking does not restore it', async ({ page, context }) => {
    const user = await seededSession(context);

    await page.goto('/profile', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: t('profile.heading'), exact: true })).toBeVisible();
    await database.user.update({ where: { id: user.id }, data: { status: UserStatus.BLOCKED } });
    await page.getByRole('button', { name: t('navigation.home'), exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('banner')).toHaveCount(0);
    await database.user.update({ where: { id: user.id }, data: { status: UserStatus.ACTIVE } });
    await page.goto('/profile', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/login$/);
});

test('not-found and temporary request failures retain a usable document shell', async ({ page, context }) => {
    await page.goto('/missing-page', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: t('common.notFound'), exact: true })).toBeVisible();
    await page
        .getByRole('heading', { name: t('common.notFound'), exact: true })
        .locator('..')
        .getByRole('button')
        .click();
    await expect(page).toHaveURL(/\/login$/);
    await seededSession(context);
    await page.goto('/profile', { waitUntil: 'networkidle' });
    await page.route('**/_serverFn/**', (route) =>
        route.fulfill({ status: HttpStatus.SERVICE_UNAVAILABLE, contentType: 'text/plain', body: AuthErrorCode.AUTH_UNAVAILABLE })
    );
    await page.getByRole('button', { name: t('navigation.home'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(t('errors.authUnavailable'));
    await page.unroute('**/_serverFn/**');
    await page.getByRole('button', { name: t('common.retry'), exact: true }).click();
    await expect(page.getByRole('heading', { name: t('home.heading'), exact: true })).toBeVisible();
});

for (const [path, heading, destination] of [
    ['/register', 'registration.heading', '/login'],
    ['/forgot-password', 'passwordReset.requestHeading', '/login'],
    ['/reset-password#token=synthetic', 'passwordReset.heading', '/forgot-password'],
    ['/verify-email#token=synthetic', 'emailVerification.heading', '/login']
]) {
    test(`page heading back button handles a direct visit to ${path}`, async ({ page }) => {
        await page.goto(path, { waitUntil: 'networkidle' });
        const header = page.getByRole('heading', { name: t(heading), exact: true }).locator('..');

        await header.getByRole('button').click();
        await expect(page).toHaveURL(new RegExp(`${destination}$`));
    });
}
