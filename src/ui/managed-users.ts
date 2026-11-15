import { UserRole, UserStatus } from '../generated/prisma/enums';
import { UserAction } from '../users/user-action';
import type { ManagedUser } from '../users/user.types';

// The table accepts scalar cells; preserve IDs for actions and format dates for display.
export function managedUserRow(user: ManagedUser) {
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        name: [user.firstName, user.lastName].filter(Boolean).join(' '),
        role: user.role,
        status: user.status,
        emailVerified: Boolean(user.emailVerifiedAt),
        createdAt: new Intl.DateTimeFormat('sk-SK', { dateStyle: 'short', timeZone: 'Europe/Bratislava' }).format(user.createdAt)
    };
}

export type ManagedUserRow = ReturnType<typeof managedUserRow>;

export function availableUserActions(user: Pick<ManagedUserRow, 'status'>): UserAction[] {
    return [
        ...(user.status === UserStatus.PENDING ? [UserAction.APPROVE] : []),
        user.status === UserStatus.BLOCKED ? UserAction.UNBLOCK : UserAction.BLOCK,
        UserAction.SET_ROLE,
        UserAction.DELETE
    ];
}

export const roleOptions = [UserRole.USER, UserRole.ADMIN] as const;
