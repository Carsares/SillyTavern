import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';

const tempRoots = [];
let listGroupsHandler;

beforeAll(async () => {
    const { router } = await import('../src/endpoints/groups.js');
    listGroupsHandler = router.stack.find(layer => layer.route?.path === '/all').route.stack.at(-1).handle;
});

afterEach(() => {
    jest.restoreAllMocks();
    for (const root of tempRoots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

function createDirectories() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-group-chat-count-'));
    tempRoots.push(root);
    const directories = {
        groups: path.join(root, 'groups'),
        groupChats: path.join(root, 'group chats'),
    };
    fs.mkdirSync(directories.groups);
    fs.mkdirSync(directories.groupChats);
    return directories;
}

describe('group list chat counts', () => {
    test('counts only registered chats that have a chat file', () => {
        const directories = createDirectories();
        const group = {
            id: '1791642338506',
            name: 'Counted Group',
            members: ['alice.png'],
            chat_id: 'Modern 2026-10-11T00-00-00-000Z',
            // The first ID was registered at creation but never written to disk
            chats: ['1791642338506', 'Modern 2026-10-11T00-00-00-000Z', 'Second chat'],
        };
        fs.writeFileSync(path.join(directories.groups, `${group.id}.json`), JSON.stringify(group));
        fs.writeFileSync(path.join(directories.groupChats, 'Modern 2026-10-11T00-00-00-000Z.jsonl'), '{"chat_metadata":{}}');
        fs.writeFileSync(path.join(directories.groupChats, 'Second chat.jsonl'), '{"chat_metadata":{}}');
        // A file of another group must not be counted
        fs.writeFileSync(path.join(directories.groupChats, 'Unrelated chat.jsonl'), '{"chat_metadata":{}}');

        const response = { send: jest.fn() };
        listGroupsHandler({ user: { directories } }, response);

        const [groups] = response.send.mock.calls[0];
        expect(groups).toHaveLength(1);
        expect(groups[0].chats).toEqual(group.chats);
        expect(groups[0].chat_count).toBe(2);
        expect(groups[0].chat_size).toBeGreaterThan(0);
    });

    test('reports zero chats for a group without chat files', () => {
        const directories = createDirectories();
        fs.writeFileSync(path.join(directories.groups, 'empty.json'), JSON.stringify({ id: 'empty', name: 'Empty', members: [], chats: ['empty'] }));

        const response = { send: jest.fn() };
        listGroupsHandler({ user: { directories } }, response);

        const [groups] = response.send.mock.calls[0];
        expect(groups[0].chat_count).toBe(0);
        expect(groups[0].chat_size).toBe(0);
    });
});
