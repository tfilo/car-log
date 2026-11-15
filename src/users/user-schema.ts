import { z } from 'zod';
import { UserRole } from '../generated/prisma/enums';
import { UserAction } from './user-action';

export const userListSchema = z
    .strictObject(
        {
            page: z.int({ error: 'validation.admin.page' }).min(0, 'validation.admin.page').default(0),
            pageSize: z
                .int({ error: 'validation.admin.pageSize' })
                .min(1, 'validation.admin.pageSize')
                .max(100, 'validation.admin.pageSize')
                .default(25)
        },
        { error: 'validation.account.shape' }
    )
    .default({ page: 0, pageSize: 25 });

const userId = z.uuid({ error: 'validation.admin.userId' });
const shapeError = { error: 'validation.account.shape' };

const confirmation = z
    .string({ error: 'validation.account.confirmation' })
    .min(1, 'validation.account.confirmation')
    .max(30, 'validation.account.confirmation');

export const deleteMyAccountSchema = z.strictObject({ confirmation }, shapeError);

export const manageUserSchema = z.discriminatedUnion(
    'action',
    [
        z.strictObject({ action: z.literal(UserAction.APPROVE), userId }, shapeError),
        z.strictObject({ action: z.literal(UserAction.BLOCK), userId }, shapeError),
        z.strictObject({ action: z.literal(UserAction.UNBLOCK), userId }, shapeError),
        z.strictObject(
            { action: z.literal(UserAction.SET_ROLE), userId, role: z.enum(UserRole, { error: 'validation.admin.role' }) },
            shapeError
        ),
        z.strictObject(
            {
                action: z.literal(UserAction.DELETE),
                userId,
                confirmation
            },
            shapeError
        )
    ],
    { error: 'validation.admin.action' }
);
