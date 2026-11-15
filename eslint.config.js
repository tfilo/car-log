import { UserErrorCode } from './src/users/user-errors.ts';
import { StatisticsErrorCode } from './src/statistics/statistics-errors.ts';
import { ExpenseErrorCode } from './src/expenses/expense-errors.ts';
import { FuelErrorCode } from './src/fuel/fuel-errors.ts';
import { VehicleErrorCode } from './src/vehicles/vehicle-errors.ts';
import { UserAction } from './src/users/user-action.ts';
import { AuthErrorCode } from './src/auth/auth-errors.ts';
import { ResultKind } from './src/common/result-kind.ts';
import { EmailDeliveryStatus } from './src/email/email-delivery-status.ts';
import { ServerFunctionOperation } from './src/server-functions/server-function-operations.ts';
import { LogOperation } from './src/log-operations.server.ts';
import { HttpMethod, HttpStatus } from './src/common/http.ts';
import js from '@eslint/js';
import path from 'node:path';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import eslintPluginTailwindcss from 'eslint-plugin-tailwindcss';
import { defineConfig, globalIgnores } from 'eslint/config';
import pluginQuery from '@tanstack/eslint-plugin-query';

// Keep lint's vocabulary aligned with the actual runtime constants.
function valuePattern(values) {
    return values.map((value) => RegExp.escape(String(value))).join('|');
}

function literalRestrictions(values, name) {
    const pattern = valuePattern(values);
    const message = `Use ${name} members instead of repeating their literal values.`;

    return [
        { selector: `Literal[value=/^(${pattern})$/]`, message },
        { selector: `TemplateElement[value.raw=/^(${pattern})$/]`, message }
    ];
}

function taggedValueRestrictions(field, values, name) {
    const literal = `Literal[value=/^(${valuePattern(values)})$/]`;
    const message = `Use ${name} members for ${field} values.`;

    return [
        `Property[key.name='${field}'] ${literal}`,
        `Property[key.value='${field}'] ${literal}`,
        `BinaryExpression:has(MemberExpression[property.name='${field}']) ${literal}`,
        `TSPropertySignature[key.name='${field}'] ${literal}`,
        `CallExpression[callee.property.name=/^(toBe|toEqual|toContain)$/]:has(MemberExpression[property.name='${field}']) > ${literal}`
    ].map((selector) => ({ selector, message }));
}

export default defineConfig([
    globalIgnores(['dist', 'node_modules', '.tanstack', 'src/routeTree.gen.ts', 'src/generated/prisma']),
    eslintPluginTailwindcss.configs['flat/recommended'] || eslintPluginTailwindcss.configs.recommended,
    {
        settings: {
            // Define the tailwindcss settings with the MANDATORY `cssConfigPath`
            tailwindcss: {
                cssConfigPath: path.resolve(import.meta.dirname, 'src/theme.css')
            }
        },
        rules: {
            'tailwindcss/no-custom-classname': [
                'error',
                {
                    whitelist: ['tope-ui-.*']
                }
            ],
            'tailwindcss/no-unnecessary-arbitrary-value': 'off',
            'no-duplicate-imports': 'error'
        }
    },
    {
        files: ['**/*.{ts,tsx}'],
        extends: [
            js.configs.recommended,
            tseslint.configs.recommended,
            reactHooks.configs.flat.recommended,
            reactRefresh.configs.vite,
            pluginQuery.configs['flat/recommended']
        ],
        languageOptions: {
            ecmaVersion: 2020,
            globals: globals.browser
        }
    },
    {
        files: ['src/**/*.{js,jsx,ts,tsx}', 'tests/**/*.{js,jsx,ts,tsx}'],
        ignores: [
            'src/users/user-action.ts',
            'src/users/user-errors.ts',
            'src/auth/auth-errors.ts',
            'src/vehicles/vehicle-errors.ts',
            'src/fuel/fuel-errors.ts',
            'src/expenses/expense-errors.ts',
            'src/statistics/statistics-errors.ts',
            'src/common/result-kind.ts',
            'src/email/email-delivery-status.ts',
            'src/server-functions/server-function-operations.ts',
            'src/log-operations.server.ts',
            'src/common/http.ts'
        ],
        rules: {
            'no-restricted-syntax': [
                'error',
                ...literalRestrictions(['USER', 'ADMIN', 'PENDING', 'ACTIVE', 'BLOCKED'], 'UserRole/UserStatus'),
                ...literalRestrictions(['PETROL', 'DIESEL', 'LPG', 'CNG', 'ELECTRIC'], 'FuelType'),
                ...literalRestrictions(Object.values(UserAction), 'UserAction'),
                ...literalRestrictions(Object.values(AuthErrorCode), 'AuthErrorCode'),
                ...literalRestrictions(Object.values(UserErrorCode), 'UserErrorCode'),
                ...literalRestrictions(Object.values(VehicleErrorCode), 'VehicleErrorCode'),
                ...literalRestrictions(Object.values(FuelErrorCode), 'FuelErrorCode'),
                ...literalRestrictions(Object.values(ExpenseErrorCode), 'ExpenseErrorCode'),
                ...literalRestrictions(Object.values(StatisticsErrorCode), 'StatisticsErrorCode'),
                ...literalRestrictions(Object.values(ServerFunctionOperation), 'ServerFunctionOperation'),
                ...literalRestrictions(Object.values(LogOperation), 'LogOperation'),
                ...literalRestrictions(Object.values(HttpMethod), 'HttpMethod'),
                ...taggedValueRestrictions('kind', Object.values(ResultKind), 'ResultKind'),
                ...taggedValueRestrictions('delivery', Object.values(EmailDeliveryStatus), 'EmailDeliveryStatus'),
                ...taggedValueRestrictions('verificationDelivery', Object.values(EmailDeliveryStatus), 'EmailDeliveryStatus'),
                {
                    selector: `FunctionDeclaration[id.name='deliverVerification'] ReturnStatement > Literal[value=/^(${valuePattern(Object.values(EmailDeliveryStatus))})$/]`,
                    message: 'Use EmailDeliveryStatus members for delivery outcomes.'
                },
                ...Object.entries(HttpStatus).map(([name, status]) => ({
                    selector: `CallExpression[callee.name=/^(setResponseStatus|serverFunctionError)$/] Literal[value=${status}]`,
                    message: `Use HttpStatus.${name} instead of its numeric value.`
                }))
            ]
        }
    },
    {
        files: [
            'src/auth/**/*.ts',
            'src/server-functions/**/*.ts',
            'src/common/request-security.server.ts',
            'src/users/**/*.ts',
            'src/email/**/*.ts',
            'src/vehicles/**/*.server.ts',
            'src/vehicles/vehicles.ts',
            'src/fuel/**/*.server.ts',
            'src/fuel/fuel.ts',
            'src/expenses/**/*.server.ts',
            'src/expenses/expenses.ts',
            'src/statistics/**/*.server.ts',
            'src/statistics/statistics.ts'
        ],
        rules: {
            '@typescript-eslint/explicit-module-boundary-types': 'error'
        }
    }
]);
