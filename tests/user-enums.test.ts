import { UserAction } from '../src/users/user-action';
import { ESLint } from 'eslint';
import { expect, test } from 'vitest';
import { UserRole, UserStatus } from '../src/generated/prisma/enums';
import { manageUserSchema } from '../src/users/user-schema';
import { randomUUID } from 'node:crypto';

test.each(Object.values(UserRole))('role validation accepts generated role %s', (role) => {
    expect(manageUserSchema.parse({ action: UserAction.SET_ROLE, userId: randomUUID(), role })).toMatchObject({
        action: UserAction.SET_ROLE,
        role
    });
});

test.each(['src/enum-guard-check.ts', 'tests/enum-guard-check.test.ts'])('lint requires enum members in %s', async (filePath) => {
    const eslint = new ESLint();
    const samples = [
        ...[...Object.values(UserRole), ...Object.values(UserStatus)].map((value) => `const value = ${JSON.stringify(value)}; void value;`),
        `export type Status = ${JSON.stringify(UserStatus.ACTIVE)};`,
        `const value = \`${UserRole.ADMIN}\`; void value;`
    ];

    for (const code of samples) {
        const [result] = await eslint.lintText(code, { filePath });

        expect(result.messages.some((message) => message.ruleId === 'no-restricted-syntax')).toBe(true);
    }

    const [valid] = await eslint.lintText(
        "import { UserRole, UserStatus } from '../generated/prisma/enums'; const role = UserRole.ADMIN; const status = UserStatus.ACTIVE; void role; void status;",
        { filePath }
    );

    expect(valid.errorCount).toBe(0);
});
