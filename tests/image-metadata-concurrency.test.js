import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, test } from '@jest/globals';

const tempRoots = [];
let assignImagesToFolder;
let createFolder;
let deleteFolder;
let readMetadataIndex;
let writeMetadataIndex;

beforeAll(async () => {
    const { setConfigFilePath } = await import('../src/util.js');
    setConfigFilePath(fileURLToPath(new URL('../config.yaml', import.meta.url)));
    ({
        assignImagesToFolder,
        createFolder,
        deleteFolder,
        readMetadataIndex,
        writeMetadataIndex,
    } = await import('../src/endpoints/image-metadata.js'));
});

afterEach(() => {
    for (const root of tempRoots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

function createUserDataRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-image-metadata-'));
    tempRoots.push(root);
    return root;
}

describe('image metadata concurrency', () => {
    test('preserves every folder created concurrently for one user', async () => {
        const root = createUserDataRoot();
        const names = Array.from({ length: 20 }, (_, index) => `folder-${index}`);

        await Promise.all(names.map(name => createFolder(root, name)));

        const index = await readMetadataIndex(root);
        expect(index.folders.map(folder => folder.name).toSorted()).toEqual(names.toSorted());
    });

    test('does not let an assignment based on an old snapshot revive a deleted folder', async () => {
        const root = createUserDataRoot();
        const relativePath = path.join('backgrounds', 'background.png');
        const backgroundPath = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(backgroundPath), { recursive: true });
        fs.writeFileSync(backgroundPath, 'image');
        await writeMetadataIndex(root, {
            version: 1,
            folders: [{ id: 'folder', name: 'Folder', thumbnailFile: '' }],
            images: { 'backgrounds/background.png': { folderIds: ['folder'] } },
        });

        const deletion = deleteFolder(root, 'folder');
        const assignment = assignImagesToFolder(root, 'folder', [relativePath]);
        const [deleteResult, assignResult] = await Promise.allSettled([deletion, assignment]);

        expect(deleteResult.status).toBe('fulfilled');
        expect(assignResult.status).toBe('rejected');
        const index = await readMetadataIndex(root);
        expect(index.folders).toEqual([]);
        expect(index.images['backgrounds/background.png'].folderIds).toEqual([]);
    });
});
