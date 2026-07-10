/**
 * Uploads a replacement attachment before removing the original file.
 * @param {() => Promise<string|undefined>} uploadReplacement Uploads and links the replacement file.
 * @param {() => Promise<boolean>} removeOriginal Removes the original file and link.
 * @returns {Promise<{url: string, originalRemoved: boolean}>} Replacement result.
 */
export async function replaceAttachmentFile(uploadReplacement, removeOriginal) {
    const url = await uploadReplacement();
    if (!url) {
        return { url: '', originalRemoved: false };
    }

    const originalRemoved = await removeOriginal();
    return { url, originalRemoved };
}

/**
 * Persists reference removal before cleaning up the physical attachment file.
 * @param {() => Promise<boolean>} removeReference Persists the reference removal.
 * @param {() => Promise<boolean>} removeFile Cleans up the physical file.
 * @returns {Promise<{referenceRemoved: boolean, fileRemoved: boolean}>} Removal result.
 */
export async function removeAttachmentFile(removeReference, removeFile) {
    const referenceRemoved = await removeReference();
    if (!referenceRemoved) {
        return { referenceRemoved: false, fileRemoved: false };
    }

    return { referenceRemoved: true, fileRemoved: await removeFile() };
}
