import { UserErrorCode } from '../src/users/user-errors';
import { FuelErrorCode } from '../src/fuel/fuel-errors';
import { ESLint } from 'eslint';
import { FuelType } from '../src/generated/prisma/enums';
import { VehicleErrorCode } from '../src/vehicles/vehicle-errors';
import { expect, test } from 'vitest';
import { UserAction } from '../src/users/user-action';
import { AuthErrorCode } from '../src/auth/auth-errors';
import { ResultKind } from '../src/common/result-kind';
import { EmailDeliveryStatus } from '../src/email/email-delivery-status';
import { ServerFunctionOperation } from '../src/server-functions/server-function-operations';
import { LogOperation } from '../src/log-operations.server';
import { HttpMethod, HttpStatus } from '../src/common/http';

// Fixed serialized text protects the external wire contract during refactors.
test('named constants preserve the serialized account protocol', () => {
    expect(
        JSON.stringify({
            action: UserAction.DELETE,
            kind: ResultKind.ERROR,
            code: AuthErrorCode.AUTH_REQUIRED,
            delivery: EmailDeliveryStatus.SENT,
            operation: ServerFunctionOperation.LOGIN,
            method: HttpMethod.POST,
            status: HttpStatus.UNAUTHORIZED
        })
    ).toBe('{"action":"delete","kind":"error","code":"AUTH_REQUIRED","delivery":"sent","operation":"login","method":"POST","status":401}');
});

test.each(['src/domain-value-guard-check.ts', 'tests/domain-value-guard-check.test.ts'])(
    'lint requires canonical domain values in %s',
    async (filePath) => {
        const eslint = new ESLint();
        const samples = [
            `const code = ${JSON.stringify(UserErrorCode.ADMIN_LAST_ACTIVE)}; void code;`,
            `const code = ${JSON.stringify(FuelErrorCode.ODOMETER_ORDER)}; void code;`,
            ...Object.values(FuelType).map((value) => `const fuel = ${JSON.stringify(value)}; void fuel;`),
            `const code = ${JSON.stringify(VehicleErrorCode.NOT_FOUND)}; void code;`,
            `const action = ${JSON.stringify(UserAction.DELETE)}; void action;`,
            `export type Action = ${JSON.stringify(UserAction.APPROVE)};`,
            `const action = \`${UserAction.BLOCK}\`; void action;`,
            `const code = ${JSON.stringify(AuthErrorCode.AUTH_REQUIRED)}; void code;`,
            `const outcome = { kind: ${JSON.stringify(ResultKind.ERROR)} }; void outcome;`,
            `export type Outcome = { kind: ${JSON.stringify(ResultKind.UPDATED)} };`,
            `const outcome = {}; if (outcome.kind === ${JSON.stringify(ResultKind.INVALID)}) { void outcome; }`,
            `const outcome = { delivery: ${JSON.stringify(EmailDeliveryStatus.SENT)} }; void outcome;`,
            `const operation = ${JSON.stringify(ServerFunctionOperation.LOGIN)}; void operation;`,
            ...Object.values(LogOperation).map((value) => `const operation = ${JSON.stringify(value)}; void operation;`),
            `const method = ${JSON.stringify(HttpMethod.POST)}; void method;`,
            `setResponseStatus(${HttpStatus.UNAUTHORIZED});`
        ];

        for (const code of samples) {
            const [result] = await eslint.lintText(code, { filePath });

            expect(
                result.messages.some((message) => message.ruleId === 'no-restricted-syntax'),
                code
            ).toBe(true);
        }

        const [valid] = await eslint.lintText(
            `
        import { UserAction } from '../users/user-action';
        import { AuthErrorCode } from '../auth/auth-errors';
        import { ResultKind } from '../common/result-kind';
        const malformedInput = 'invalid';
        const outcome = { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED };
        void [UserAction.DELETE, outcome, malformedInput];
    `,
            { filePath }
        );

        expect(valid.errorCount).toBe(0);
    }
);
