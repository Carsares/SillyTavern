import express from 'express';
import fs, { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import sanitize from 'sanitize-filename';
import { CHAT_BACKUPS_PREFIX, getChatInfo } from './chats.js';
import { getConfigValue } from '../util.js';
import { collectChatBackupStats, parseOlderThanDays } from '../chat-backup-stats.js';

export const router = express.Router();

router.post('/chat/get', async (request, response) => {
    try {
        const backupModels = [];
        const backupFiles = await fsPromises
            .readdir(request.user.directories.backups, { withFileTypes: true })
            .then(d => d.filter(d => d.isFile() && path.extname(d.name) === '.jsonl' && d.name.startsWith(CHAT_BACKUPS_PREFIX)).map(d => d.name));

        for (const name of backupFiles) {
            const filePath = path.join(request.user.directories.backups, name);
            const info = await getChatInfo(filePath);
            if (!info || !info.file_name) {
                continue;
            }
            backupModels.push(info);
        }

        return response.json(backupModels);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

// Counts, sizes and ages of the chat backups, read from the directory listing only. With `olderThanDays` it also lists the
// backups last modified before that many days ago, as a preview: nothing is deleted here.
router.post('/chat/stats', async (request, response) => {
    try {
        const requestedDays = request.body?.olderThanDays;
        const olderThanDays = parseOlderThanDays(requestedDays);
        if (requestedDays !== undefined && requestedDays !== null && olderThanDays === null) {
            return response.status(400).send({ error: 'olderThanDays must be a whole number of days' });
        }

        const stats = await collectChatBackupStats(request.user.directories.backups, { olderThanDays });
        return response.json({
            ...stats,
            config: {
                enabled: !!getConfigValue('backups.chat.enabled', true, 'boolean'),
                checkIntegrity: !!getConfigValue('backups.chat.checkIntegrity', true, 'boolean'),
                numberOfBackups: Number(getConfigValue('backups.common.numberOfBackups', 50, 'number')),
                maxTotalBackups: Number(getConfigValue('backups.chat.maxTotalBackups', -1, 'number')),
                throttleInterval: Number(getConfigValue('backups.chat.throttleInterval', 10_000, 'number')),
                allowFullDataBackup: !!getConfigValue('backups.allowFullDataBackup', true, 'boolean'),
            },
        });
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/chat/delete', async (request, response) => {
    try {
        const { name } = request.body;
        const filePath = path.join(request.user.directories.backups, sanitize(name));

        if (!path.parse(filePath).base.startsWith(CHAT_BACKUPS_PREFIX)) {
            console.warn('Attempt to delete non-chat backup file:', name);
            return response.sendStatus(400);
        }

        if (!fs.existsSync(filePath)) {
            return response.sendStatus(404);
        }

        await fsPromises.unlink(filePath);
        return response.sendStatus(200);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/chat/download', async (request, response) => {
    try {
        const { name } = request.body;
        const filePath = path.join(request.user.directories.backups, sanitize(name));

        if (!path.parse(filePath).base.startsWith(CHAT_BACKUPS_PREFIX)) {
            console.warn('Attempt to download non-chat backup file:', name);
            return response.sendStatus(400);
        }

        if (!fs.existsSync(filePath)) {
            return response.sendStatus(404);
        }

        return response.download(filePath);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});
