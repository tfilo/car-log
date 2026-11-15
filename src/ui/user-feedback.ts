import { getUserErrorKey } from '../users/user-errors';
import type { UserFailure } from '../users/user.types';

export function userErrors(result: {
    code: UserFailure['code'];
    fields?: Partial<Record<string, string[]>>;
    formErrors?: string[];
}): string[] {
    const messages = [...Object.values(result.fields ?? {}).flatMap((errors) => errors ?? []), ...(result.formErrors ?? [])];

    return messages.length ? [...new Set(messages)] : [getUserErrorKey(result.code)];
}
