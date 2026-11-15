import { expect, test } from 'vitest';
import { z } from 'zod';
import { translatedSchema } from '../src/i18n/form-schema';
import { i18n } from '../src/i18n';
import { registrationSchema } from '../src/auth/registration-schema';

test('localized validators preserve nested issue paths without changing shared Zod messages', async () => {
    const schema = z.object({ rows: z.array(z.object({ name: z.string().min(1, 'validation.name.invalid') })) });
    const input = { rows: [{ name: '' }] };
    const result = await translatedSchema(schema, i18n.t)['~standard'].validate(input);

    expect(result.issues).toEqual([{ path: ['rows', 0, 'name'], message: i18n.t('validation.name.invalid') }]);

    const original = schema.safeParse(input);

    expect(original.success).toBe(false);

    if (!original.success) expect(original.error.issues[0].message).toBe('validation.name.invalid');
});

test('localized validators retain successful Zod transforms and typed output', async () => {
    const schema = registrationSchema.pick({ email: true });
    const result = await translatedSchema(schema, i18n.t)['~standard'].validate({ email: ' SYNTHETIC@EXAMPLE.TEST ' });

    expect(result).toEqual({ value: { email: 'synthetic@example.test' } });
});
