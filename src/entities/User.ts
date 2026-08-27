/**
 * Le pseudo (username) est unique localement
 */
export interface User {
    readonly id: string;
    readonly username: string;
}

export interface CreateUserParams {
    id: string;
    username: string;
}

export function createUser(params: CreateUserParams): User {
    return {
        id: params.id,
        username: params.username,
    };
}

/** Règle métier: un pseudo valide. */
export function isValidUsername(username: string): boolean {
    return /^[a-zA-Z0-9_\-]{3,20}$/.test(username);
}