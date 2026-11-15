export const UserAction = {
    APPROVE: 'approve',
    BLOCK: 'block',
    UNBLOCK: 'unblock',
    SET_ROLE: 'setRole',
    DELETE: 'delete'
} as const;

export type UserAction = (typeof UserAction)[keyof typeof UserAction];
