export const MAX_USER_NAME_CODE_POINTS = 128;
export const MAX_USER_AVATAR_DATA_URL_BYTES = 2 * 1024 * 1024;

/**
 * Checks whether a user display name is non-empty and within its persisted size budget.
 * @param {unknown} name User display name
 * @returns {name is string} Whether the name is valid
 */
export function isValidUserName(name) {
    if (typeof name !== 'string' || !name) {
        return false;
    }

    let codePoints = 0;
    const characters = name[Symbol.iterator]();
    while (!characters.next().done) {
        if (++codePoints > MAX_USER_NAME_CODE_POINTS) {
            return false;
        }
    }

    return true;
}
