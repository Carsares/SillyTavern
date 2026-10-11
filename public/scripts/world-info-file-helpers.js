/**
 * Creates independent debounced timers for each key.
 * @param {(key: string, ...args: any[]) => any} callback Debounced callback.
 * @param {(error: unknown, key: string, ...args: any[]) => void} errorHandler Callback error handler.
 * @param {number} timeout Debounce timeout in milliseconds.
 * @returns {{schedule: (key: string, ...args: any[]) => void, cancel: (key: string) => boolean, flush: (key: string) => Promise<void>}} Keyed debouncer.
 */
export function createKeyedDebouncer(callback, errorHandler, timeout) {
    const pending = new Map();

    const invoke = async (key, args) => {
        try {
            await callback(key, ...args);
        } catch (error) {
            errorHandler(error, key, ...args);
        }
    };

    return {
        schedule(key, ...args) {
            clearTimeout(pending.get(key)?.timer);
            const timer = setTimeout(() => {
                pending.delete(key);
                void invoke(key, args);
            }, timeout);
            pending.set(key, { timer, args });
        },
        cancel(key) {
            const item = pending.get(key);
            if (!item) {
                return false;
            }

            clearTimeout(item.timer);
            pending.delete(key);
            return true;
        },
        async flush(key) {
            const item = pending.get(key);
            if (!item) {
                return;
            }

            clearTimeout(item.timer);
            pending.delete(key);
            await invoke(key, item.args);
        },
    };
}

/**
 * Tracks World Info files that are being deleted or have been deleted.
 * @returns {{beginDelete: (name: string) => boolean, markDeleted: (name: string) => void, cancelDelete: (name: string) => void, canSave: (name: string, recreate?: boolean) => boolean, restore: (name: string) => void}} Delete barrier.
 */
export function createWorldInfoDeleteBarrier() {
    const states = new Map();

    return {
        beginDelete(name) {
            if (states.has(name)) {
                return false;
            }

            states.set(name, 'deleting');
            return true;
        },
        markDeleted(name) {
            if (states.get(name) === 'deleting') {
                states.set(name, 'deleted');
            }
        },
        cancelDelete(name) {
            if (states.get(name) === 'deleting') {
                states.delete(name);
            }
        },
        canSave(name, recreate = false) {
            const state = states.get(name);
            return !state || recreate && state === 'deleted';
        },
        restore(name) {
            if (states.get(name) === 'deleted') {
                states.delete(name);
            }
        },
    };
}

/**
 * Runs a create-style save and handles an expected conflict without rejecting.
 * @param {() => Promise<void>} save Save operation.
 * @param {() => Promise<void> | void} onConflict Conflict handler.
 * @returns {Promise<boolean>} Whether the save succeeded.
 */
export async function tryCreateWorldInfo(save, onConflict) {
    try {
        await save();
        return true;
    } catch (error) {
        if (error?.status !== 409) {
            throw error;
        }

        await onConflict();
        return false;
    }
}

/**
 * Retargets persona lorebook links and returns the affected persona ids.
 * @param {Record<string, {lorebook?: string}> | undefined} personaDescriptions Persona descriptors keyed by avatar id.
 * @param {string} oldName Previous World Info name.
 * @param {string} newName New World Info name.
 * @returns {string[]} Updated persona ids.
 */
export function replaceWorldInfoInPersonaDescriptions(personaDescriptions, oldName, newName) {
    const updatedAvatarIds = [];

    for (const [avatarId, descriptor] of Object.entries(personaDescriptions ?? {})) {
        if (descriptor?.lorebook !== oldName) {
            continue;
        }

        descriptor.lorebook = newName;
        updatedAvatarIds.push(avatarId);
    }

    return updatedAvatarIds;
}

/**
 * Retargets a selected World Info name while keeping the selection unique.
 * @param {string[]} selectedWorlds Selected World Info names.
 * @param {string} oldName Previous World Info name.
 * @param {string} newName New World Info name.
 * @returns {string[]} Updated selected World Info names.
 */
export function replaceWorldInfoInSelectedWorlds(selectedWorlds, oldName, newName) {
    return selectedWorlds.map(name => name === oldName ? newName : name).filter((name, index, names) => names.indexOf(name) === index);
}

/**
 * Determines whether embedded world info import still needs a confirmation.
 * An overwrite must always be confirmed, even if the generic import prompt was already shown.
 * @param {boolean} skipPopup Whether the generic import confirmation was already shown.
 * @param {string|undefined} existingName Existing world info name that would be overwritten.
 * @returns {boolean} Whether a confirmation is required.
 */
export function needsEmbeddedWorldInfoConfirmation(skipPopup, existingName) {
    return !skipPopup || Boolean(existingName);
}

/**
 * Removes a world info name from every auxiliary character link.
 * @param {object[]} charLore Character lore link records.
 * @param {string} worldInfoName Deleted world info name.
 * @returns {object[]} Updated link records.
 */
export function removeWorldInfoFromCharLore(charLore, worldInfoName) {
    return charLore.map(record => {
        if (!Array.isArray(record.extraBooks) || !record.extraBooks.includes(worldInfoName)) {
            return record;
        }

        const extraBooks = record.extraBooks.filter(name => name !== worldInfoName);
        return extraBooks.length > 0 ? { ...record, extraBooks } : null;
    }).filter(Boolean);
}
