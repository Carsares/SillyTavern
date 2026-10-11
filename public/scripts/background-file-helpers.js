/**
 * Retargets global and chat-scoped references after a system background is renamed.
 * @param {{name?: string, url?: string}} backgroundSettings Global background settings.
 * @param {Record<string, any>} chatMetadata Current chat metadata.
 * @param {string} metadataKey Chat metadata key for the locked background.
 * @param {string} oldName Previous background file name.
 * @param {string} newName Final background file name.
 * @param {string} oldUrl Previous CSS background URL.
 * @param {string} newUrl Final CSS background URL.
 * @returns {{globalChanged: boolean, chatChanged: boolean}} Updated reference flags.
 */
export function replaceRenamedBackgroundReferences(backgroundSettings, chatMetadata, metadataKey, oldName, newName, oldUrl, newUrl) {
    const globalChanged = backgroundSettings.name === oldName || backgroundSettings.url === oldUrl;
    if (globalChanged) {
        backgroundSettings.name = newName;
        backgroundSettings.url = newUrl;
    }

    const chatChanged = chatMetadata[metadataKey] === oldUrl;
    if (chatChanged) {
        chatMetadata[metadataKey] = newUrl;
    }

    return { globalChanged, chatChanged };
}
