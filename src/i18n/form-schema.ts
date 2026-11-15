import type { StandardSchemaV1 } from '@tanstack/react-form';
import type { TFunction } from 'i18next';
import type { z } from 'zod';

// Translate synchronous Zod issues before TanStack Form stores them.
// tope-ui owns touched state, field subscriptions, and rendering the messages.
export function translatedSchema<Input, Output>(schema: z.ZodType<Output, Input>, t: TFunction): StandardSchemaV1<Input, Output> {
    return {
        '~standard': {
            version: 1,
            vendor: 'car-log',
            validate: (value) => {
                const result = schema.safeParse(value);

                return result.success
                    ? { value: result.data }
                    : { issues: result.error.issues.map((issue) => ({ message: t(issue.message), path: issue.path })) };
            }
        }
    };
}
