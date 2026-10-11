import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';

import { replaceRenamedBackgroundReferences } from '../public/scripts/background-file-helpers.js';
import { setConfigFilePath } from '../src/util.js';

const temporaryDirectories = [];
let router;

beforeAll(async () => {
    setConfigFilePath(fileURLToPath(new URL('../config.yaml', import.meta.url)));
    ({ router } = await import('../src/endpoints/backgrounds.js'));
});

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function createResponse() {
    const response = {};
    response.send = jest.fn(value => value);
    response.sendStatus = jest.fn(value => value);
    return response;
}

describe('background rename safety', () => {
    test('retargets global and chat-locked references to the final server name', () => {
        const settings = { name: 'old.png', url: 'url("backgrounds/old.png")' };
        const metadata = { custom_background: 'url("backgrounds/old.png")' };

        expect(replaceRenamedBackgroundReferences(
            settings,
            metadata,
            'custom_background',
            'old.png',
            'new.png',
            'url("backgrounds/old.png")',
            'url("backgrounds/new.png")',
        )).toEqual({ globalChanged: true, chatChanged: true });
        expect(settings).toEqual({ name: 'new.png', url: 'url("backgrounds/new.png")' });
        expect(metadata.custom_background).toBe('url("backgrounds/new.png")');
    });

    test('uses one sanitized name for the file, metadata, and response', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-background-'));
        temporaryDirectories.push(root);
        const backgrounds = path.join(root, 'backgrounds');
        const thumbnailsBg = path.join(root, 'thumbnails');
        fs.mkdirSync(backgrounds);
        fs.mkdirSync(thumbnailsBg);
        fs.writeFileSync(path.join(backgrounds, 'old.png'), 'image');
        const handler = router.stack.find(layer => layer.route?.path === '/rename')?.route?.stack.at(-1)?.handle;
        const response = createResponse();

        await handler({
            body: { old_bg: 'old.png', new_bg: 'folder/new.png' },
            user: { directories: { root, backgrounds, thumbnailsBg } },
        }, response);

        expect(response.send).toHaveBeenCalledWith({ name: 'foldernew.png' });
        expect(fs.existsSync(path.join(backgrounds, 'old.png'))).toBe(false);
        expect(fs.readFileSync(path.join(backgrounds, 'foldernew.png'), 'utf8')).toBe('image');
    });
});
