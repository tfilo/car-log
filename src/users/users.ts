import type { z } from 'zod';
import { createServerFn } from '@tanstack/react-start';
import { HttpMethod } from '../common/http';
import { ServerFunctionOperation } from '../server-functions/server-function-operations';
import type { UserListResponse, ManageUserResponse, DeleteAccountResponse } from './user.types';
import { userListSchema, manageUserSchema, deleteMyAccountSchema } from './user-schema';
import { listManagedUsers, manageUserAccount, deleteOwnUserAccount } from './users.server';
import { validateUserInput, executeUserOperation } from './user-response.server';

export const listUsers = createServerFn({ method: HttpMethod.GET })
    .validator((input: z.input<typeof userListSchema>) => validateUserInput(userListSchema, input))
    .handler(({ data }): Promise<UserListResponse> => executeUserOperation(data, listManagedUsers, ServerFunctionOperation.LIST_USERS));

export const manageUser = createServerFn({ method: HttpMethod.POST })
    .validator((input: z.input<typeof manageUserSchema>) => validateUserInput(manageUserSchema, input))
    .handler(({ data }): Promise<ManageUserResponse> => executeUserOperation(data, manageUserAccount, ServerFunctionOperation.MANAGE_USER));

export const deleteMyAccount = createServerFn({ method: HttpMethod.POST })
    .validator((input: z.input<typeof deleteMyAccountSchema>) => validateUserInput(deleteMyAccountSchema, input))
    .handler(({ data }): Promise<DeleteAccountResponse> =>
        executeUserOperation(data, deleteOwnUserAccount, ServerFunctionOperation.DELETE_MY_ACCOUNT)
    );
