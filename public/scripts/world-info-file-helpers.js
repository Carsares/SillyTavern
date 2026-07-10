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
