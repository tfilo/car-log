import { ConfigurationError } from '../logging.server';
import 'dotenv/config';
import nodemailer from 'nodemailer';
import Handlebars from 'handlebars';
import auth from '../i18n/locales/sk/auth.json';
import template from './verification.hbs?raw';

const EmailPurpose = { VERIFICATION: 'emailVerification', PASSWORD_RESET: 'passwordReset' } as const;

type EmailPurpose = (typeof EmailPurpose)[keyof typeof EmailPurpose];

const renderVerification = Handlebars.compile(template, { strict: true });

export type VerificationMessage = { email: string; token: string };

export type VerificationSender = (message: VerificationMessage) => Promise<void>;

function accountLink(path: string, token: string): string {
    let base: URL;

    try {
        base = new URL(process.env.APP_URL ?? '');
    } catch {
        throw new ConfigurationError('APP_URL must be a valid trusted public origin.');
    }

    if (base.username || base.password || base.search || base.hash || base.pathname !== '/')
        throw new ConfigurationError('APP_URL must be the trusted public application origin.');

    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) {
        throw new ConfigurationError('APP_URL requires HTTPS outside local development.');
    }

    const link = new URL(path, base);

    // Fragments are not sent to the server or included in HTTP referrers.
    link.hash = new URLSearchParams({ token }).toString();

    return link.href;
}

export function verificationLink(token: string): string {
    return accountLink('/verify-email', token);
}

export function passwordResetLink(token: string): string {
    return accountLink('/reset-password', token);
}

export const sendVerificationEmail: VerificationSender = (message) => sendAccountEmail(message, EmailPurpose.VERIFICATION);

export const sendPasswordResetEmail: VerificationSender = (message) => sendAccountEmail(message, EmailPurpose.PASSWORD_RESET);

async function sendAccountEmail({ email, token }: VerificationMessage, purpose: EmailPurpose) {
    const host = process.env.SMTP_HOST;
    const from = process.env.MAIL_FROM;
    const port = Number(process.env.SMTP_PORT ?? '587');
    const secure = process.env.SMTP_SECURE === 'true';

    if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65535)
        throw new ConfigurationError('Configure SMTP_HOST, SMTP_PORT and MAIL_FROM.');

    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASSWORD;

    if (Boolean(user) !== Boolean(pass)) throw new ConfigurationError('SMTP_USER and SMTP_PASSWORD must be configured together.');

    const link = purpose === EmailPurpose.VERIFICATION ? verificationLink(token) : passwordResetLink(token);
    const copy = auth[purpose];
    const local = ['localhost', '127.0.0.1', '::1'].includes(host);
    const transport = nodemailer.createTransport({
        host,
        port,
        secure,
        requireTLS: !local && !secure,
        auth: user && pass ? { user, pass } : undefined,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
        disableFileAccess: true,
        disableUrlAccess: true
    });

    await transport.sendMail({
        from,
        to: email,
        subject: copy.subject,
        text: `${copy.body}\n\n${link}\n\n${copy.expiry}\n\n${copy.footer}`,
        html: renderVerification({ ...copy, link })
    });
}
