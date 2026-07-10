import fs from 'node:fs';

/**
 * Removes the current Multer temporary file and clears it from the request.
 * @param {import('express').Request} request Request object
 */
export function removeUploadedFile(request) {
    if (!request.file?.path) {
        return;
    }

    try {
        fs.rmSync(request.file.path, { force: true });
        request.file = undefined;
    } catch (error) {
        console.warn('Failed to remove temporary upload:', error);
    }
}

/**
 * Removes a Multer temporary file after the response has finished or the connection closes.
 * Endpoint handlers may remove or move the file earlier; force makes the final cleanup idempotent.
 * @param {import('express').Request} request Request object
 * @param {import('express').Response} response Response object
 * @param {import('express').NextFunction} next Next middleware
 */
export default function uploadCleanupMiddleware(request, response, next) {
    let cleanupStarted = false;
    const cleanup = () => {
        if (cleanupStarted || !request.file?.path) {
            return;
        }

        cleanupStarted = true;
        removeUploadedFile(request);
    };

    response.once('finish', cleanup);
    response.once('close', cleanup);
    next();
}
