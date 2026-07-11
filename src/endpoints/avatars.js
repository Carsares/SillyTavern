import path from 'node:path';
import fs from 'node:fs';

import express from 'express';
import sanitize from 'sanitize-filename';
import { Jimp } from '../jimp.js';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { getImages, tryParse } from '../util.js';
import { getFileNameValidationFunction } from '../middleware/validateFileName.js';
import { applyAvatarCropResize } from './characters.js';
import { invalidateThumbnail } from './thumbnails.js';
import cacheBuster from '../middleware/cacheBuster.js';
import { KeyedPromiseQueue } from '../keyed-promise-queue.js';

export const router = express.Router();

// Serializes upload/delete per avatar file so a Jimp.read yield can't interleave the two operations
const AVATAR_FILE_QUEUE = new KeyedPromiseQueue();

router.post('/get', function (request, response) {
    const images = getImages(request.user.directories.avatars);
    response.send(images);
});

router.post('/delete', getFileNameValidationFunction('avatar'), async function (request, response) {
    if (!request.body) return response.sendStatus(400);

    if (request.body.avatar !== sanitize(request.body.avatar)) {
        console.error('Malicious avatar name prevented');
        return response.sendStatus(403);
    }

    const fileName = path.join(request.user.directories.avatars, sanitize(request.body.avatar));

    try {
        // Serialize per-file so a concurrent upload of the same avatar can't interleave with this delete
        const deleted = await AVATAR_FILE_QUEUE.run(path.resolve(fileName), async () => {
            if (fs.existsSync(fileName)) {
                fs.unlinkSync(fileName);
                invalidateThumbnail(request.user.directories, 'persona', sanitize(request.body.avatar));
                return true;
            }
            return false;
        });

        if (deleted) {
            return response.send({ result: 'ok' });
        }

        return response.sendStatus(404);
    } catch (err) {
        // Async handler: keep the pre-serialization 500 contract instead of hanging the request
        console.error('Error deleting user avatar:', err);
        return response.sendStatus(500);
    }
});

router.post('/upload', getFileNameValidationFunction('overwrite_name'), async (request, response) => {
    if (!request.file) return response.sendStatus(400);

    try {
        const pathToUpload = path.join(request.file.destination, request.file.filename);
        const crop = tryParse(request.query.crop);
        const rawImg = await Jimp.read(pathToUpload);
        const image = await applyAvatarCropResize(rawImg, crop);

        const filename = sanitize(request.body.overwrite_name || `${Date.now()}.png`);
        const pathToNewFile = path.join(request.user.directories.avatars, filename);

        // Serialize per-file so a concurrent delete of the same avatar can't interleave with this write
        await AVATAR_FILE_QUEUE.run(path.resolve(pathToNewFile), async () => {
            // Remove previous thumbnail and bust cache if overwriting
            if (request.body.overwrite_name) {
                invalidateThumbnail(request.user.directories, 'persona', sanitize(request.body.overwrite_name));
                cacheBuster.bust(request, response);
            }
            writeFileAtomicSync(pathToNewFile, image);
            fs.unlinkSync(pathToUpload);
        });

        return response.send({ path: filename });
    } catch (err) {
        console.error('Error uploading user avatar:', err);
        return response.status(400).send('Is not a valid image');
    }
});
