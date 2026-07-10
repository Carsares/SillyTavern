import { test, expect } from '@playwright/test';
import { createBackgroundFolderActions } from '../public/modern/actions/background-folders.js';
import { createCharacterDataHelpers } from '../public/modern/actions/character-data.js';
import { createChatBackupActions } from '../public/modern/actions/chat-backups.js';
import { createChatContextLoaderActions } from '../public/modern/actions/chat-context-loaders.js';
import { buildOpenAiPresetFromSettings, useOpenAiPresetFields } from '../public/modern/actions/openai-preset-fields.js';
import { createRemoteResourceActions } from '../public/modern/actions/remote-resources.js';
import { createWorldbookEntryListHelpers } from '../public/modern/actions/worldbook-entry-list.js';

function sortChats(chats) {
    return [...chats].sort((left, right) => new Date(right.last_mes || 0).getTime() - new Date(left.last_mes || 0).getTime());
}

test.describe('Modern action helpers', () => {
    test('filters, sorts, pages, and selects worldbook entries', () => {
        const state = {
            worldEntryList: { worldbookId: '', query: '', sort: 'order', page: 1, selectedKeys: [] },
        };
        let renderCount = 0;
        const helpers = createWorldbookEntryListHelpers({
            state,
            render: () => renderCount++,
            getWorldEntryTitle: (entry, entryKey) => entry?.comment || `Entry ${entryKey}`,
            formatSearchText: value => String(value ?? '').toLowerCase(),
        });

        expect(helpers.getWorldEntryListState('Lore')).toMatchObject({ worldbookId: 'Lore', page: 1 });
        state.worldEntryList.page = 3;
        helpers.updateWorldEntryListField('query', 'BETA');

        const entries = Object.entries({
            2: { key: ['alpha'], comment: 'alpha entry', content: 'Alpha content', order: 2, disable: false },
            1: { key: ['beta'], comment: 'beta entry', content: 'Beta content', order: 1, disable: true },
        });

        expect(state.worldEntryList.page).toBe(1);
        expect(helpers.getVisibleWorldEntries(entries, state.worldEntryList).map(([entryKey]) => entryKey)).toEqual(['1']);

        helpers.updateWorldEntryListField('query', '');
        helpers.updateWorldEntryListField('sort', 'status');
        expect(helpers.getVisibleWorldEntries(entries, state.worldEntryList).map(([entryKey]) => entryKey)).toEqual(['2', '1']);

        helpers.toggleWorldEntrySelection(1, true);
        expect(state.worldEntryList.selectedKeys).toEqual(['1']);
        helpers.toggleWorldEntrySelection(1, false);
        expect(state.worldEntryList.selectedKeys).toEqual([]);
        expect(renderCount).toBeGreaterThan(0);
    });

    test('converts character forms and payloads without losing nested fields', () => {
        const helpers = createCharacterDataHelpers();
        const character = {
            avatar: 'alice.png',
            name: 'Alice Fallback',
            data: {
                name: 'Alice',
                description: 'Visible description',
                personality: 'Helpful',
                scenario: 'Scenario',
                first_mes: 'Hello',
                alternate_greetings: ['Alt 1', 'Alt 2'],
                tags: ['modern', 'fixture'],
                creator: 'Modern E2E',
                character_version: '1.0',
                extensions: {
                    world: 'ModernLore',
                    talkativeness: 0.7,
                    fav: true,
                    depth_prompt: {
                        prompt: 'Depth prompt',
                        depth: 6,
                        role: 'user',
                    },
                },
            },
        };

        const form = helpers.characterToForm(character);
        expect(form).toMatchObject({
            name: 'Alice',
            tags: 'modern, fixture',
            world: 'ModernLore',
            alternate_greetings: 'Alt 1\n---\nAlt 2',
            depth_prompt_prompt: 'Depth prompt',
            depth_prompt_depth: '6',
            depth_prompt_role: 'user',
            talkativeness: '0.7',
            favorite: true,
        });

        form.name = 'Alice Edited';
        form.tags = 'edited, fixture';
        form.alternate_greetings = 'Hi\n---\nAgain';
        const createPayload = helpers.characterCreatePayload(form);
        expect(createPayload).toMatchObject({
            ch_name: 'Alice Edited',
            tags: ['edited', 'fixture'],
            alternate_greetings: ['Hi', 'Again'],
            depth_prompt_depth: 6,
            fav: 'true',
        });

        const mergePayload = helpers.characterMergePayload('alice.png', form);
        expect(mergePayload).toMatchObject({
            avatar: 'alice.png',
            name: 'Alice Edited',
            tags: ['edited', 'fixture'],
            data: {
                name: 'Alice Edited',
                alternate_greetings: ['Hi', 'Again'],
                tags: ['edited', 'fixture'],
                extensions: {
                    world: 'ModernLore',
                    talkativeness: 0.7,
                    fav: true,
                    depth_prompt: {
                        prompt: 'Depth prompt',
                        depth: 6,
                        role: 'user',
                    },
                },
            },
        });
    });

    test('builds and applies OpenAI preset fields with connection binding rules', () => {
        const settings = {
            chat_completion_source: 'siliconflow',
            siliconflow_model: 'active-model',
            siliconflow_endpoint: 'us',
            temp_openai: 0.4,
            openai_max_tokens: 512,
            top_p_openai: 0.9,
            freq_pen_openai: 0.1,
            pres_pen_openai: 0.2,
            reverse_proxy: 'https://proxy.example',
        };

        expect(buildOpenAiPresetFromSettings({
            settings,
            preset: { existing: true },
            chatCompletionModelFields: { siliconflow: 'siliconflow_model' },
        })).toMatchObject({
            existing: true,
            temperature: 0.4,
            openai_max_tokens: 512,
            top_p: 0.9,
            frequency_penalty: 0.1,
            presence_penalty: 0.2,
            chat_completion_source: 'siliconflow',
            siliconflow_model: 'active-model',
            siliconflow_endpoint: 'us',
            reverse_proxy: 'https://proxy.example',
        });

        const unboundSettings = {
            bind_preset_to_connection: false,
            temp_openai: 1,
            siliconflow_model: 'keep-model',
        };
        useOpenAiPresetFields(unboundSettings, {
            temperature: 0.22,
            siliconflow_model: 'preset-model',
            extensions: { memory: true },
        });
        expect(unboundSettings).toMatchObject({
            bind_preset_to_connection: false,
            temp_openai: 0.22,
            siliconflow_model: 'keep-model',
            extensions: { memory: true },
        });

        const boundSettings = {
            bind_preset_to_connection: true,
            siliconflow_model: 'old-model',
        };
        useOpenAiPresetFields(boundSettings, { siliconflow_model: 'preset-model' });
        expect(boundSettings.siliconflow_model).toBe('preset-model');
    });

    test('loads cached chat lists, searches current context, and stores chat metadata', async () => {
        const entity = { avatar: 'alice.png', name: 'Alice', data: { name: 'Alice' } };
        const state = {
            selected: { character: 'alice.png' },
            chatLists: {},
            loadingChats: {},
            errors: [],
            chatSearch: { avatar: '', contextKey: '', query: 'beta', searchedQuery: '', loading: false, results: [] },
            chatMessages: {},
            chatMetadata: {},
        };
        const requests = [];
        const helpers = createChatContextLoaderActions({
            state,
            apiFetch: async (url, options = {}) => {
                requests.push({ url, body: options.body });
                if (url === '/api/characters/chats') {
                    return [
                        { file_name: 'old.jsonl', file_id: 'old', last_mes: '2026-01-01T00:00:00Z' },
                        { file_name: 'new.jsonl', file_id: 'new', last_mes: '2026-01-02T00:00:00Z' },
                    ];
                }
                if (url === '/api/chats/search') {
                    return [{ file_name: 'beta.jsonl', file_id: 'beta', last_mes: '2026-01-03T00:00:00Z' }];
                }
                if (url === '/api/chats/get') {
                    return [
                        { chat_metadata: { mood: 'focused' } },
                        { name: 'Alice', is_user: false, mes: 'hello' },
                    ];
                }
                throw new Error(`Unexpected URL ${url}`);
            },
            render: () => {},
            showToast: () => {},
            getChatCacheKey: (contextKey, chatId) => `${contextKey}::${chatId}`,
            getChatContextKey: item => item?.avatar || '',
            getSelectedChatEntity: () => entity,
            isGroupChatMode: () => false,
            sortChats,
        });

        await expect(helpers.loadCharacterChats(entity)).resolves.toHaveLength(2);
        await expect(helpers.loadCharacterChats(entity)).resolves.toHaveLength(2);
        expect(requests.filter(request => request.url === '/api/characters/chats')).toHaveLength(1);
        expect(state.chatLists['alice.png'].map(chat => chat.file_id)).toEqual(['new', 'old']);

        await helpers.searchSelectedChats();
        expect(state.chatSearch).toMatchObject({
            avatar: 'alice.png',
            contextKey: 'alice.png',
            query: 'beta',
            searchedQuery: 'beta',
            loading: false,
        });
        expect(state.chatSearch.results[0].file_id).toBe('beta');

        await expect(helpers.loadChatMessages(entity, 'beta')).resolves.toHaveLength(1);
        expect(state.chatMetadata['alice.png::beta']).toEqual({ mood: 'focused' });
        expect(state.chatMessages['alice.png::beta'][0]).toMatchObject({ mes: 'hello' });
    });

    test('imports remote characters without requesting a filename-preserving replacement', async () => {
        const importedBodies = [];
        const state = {
            selected: { character: 'alice.png', chat: 'existing-chat' },
            worldDetails: {},
            remoteResources: {
                results: [{
                    providerId: 'fixture-provider',
                    providerName: 'Fixture Provider',
                    id: 'remote-alice',
                    resourceType: 'character',
                    title: 'Remote Alice',
                    sourceUrl: 'https://example.invalid/remote-alice',
                    metadata: {},
                }],
                records: [],
                operation: { key: '', running: false },
            },
        };
        const actions = createRemoteResourceActions({
            state,
            apiFetch: async (url, options = {}) => {
                if (url === '/api/characters/import') {
                    importedBodies.push(options.body);
                    return { file_name: 'remote-alice-1.png' };
                }
                if (url === '/api/remote-resources/records') {
                    return { id: 'record-1', ...options.body };
                }
                throw new Error(`Unexpected URL ${url}`);
            },
            apiFetchResponse: async url => {
                expect(url).toBe('/api/remote-resources/download');
                return new Response(JSON.stringify({ data: { name: 'Remote Alice' } }), {
                    headers: {
                        'content-type': 'application/json',
                        'content-disposition': 'attachment; filename="Remote Alice.json"',
                    },
                });
            },
            loadData: async () => {},
            render: () => {},
            showToast: () => {},
            callLegacyBridge: async () => {},
            loadWorldDetail: async () => {},
        });

        await actions.importRemoteResource(0);

        expect(importedBodies).toHaveLength(1);
        expect(importedBodies[0].get('avatar')).toBeInstanceOf(File);
        expect(importedBodies[0].get('avatar').name).toBe('Remote Alice.json');
        expect(importedBodies[0].get('file_type')).toBe('json');
        expect(importedBodies[0].has('preserved_name')).toBe(false);
        expect(state.selected).toEqual({ character: 'remote-alice-1.png', chat: '' });
        expect(state.remoteResources.records[0]).toMatchObject({
            providerId: 'fixture-provider',
            localType: 'character',
            localId: 'remote-alice-1.png',
            action: 'import',
        });
    });

    test('previews, restores, and deletes chat backups through backup helper', async () => {
        const state = {
            chatBackups: {
                items: [],
                loading: false,
                open: false,
                previewName: '',
                previewText: '',
                restoring: '',
                deleteConfirm: '',
                deleting: false,
            },
        };
        const requests = [];
        const importedFiles = [];
        const helpers = createChatBackupActions({
            state,
            apiFetch: async (url, options = {}) => {
                requests.push({ url, body: options.body });
                if (url === '/api/backups/chat/get') {
                    return [{ file_name: 'backup.jsonl', last_mes: '2026-01-01T00:00:00Z' }];
                }
                if (url === '/api/backups/chat/delete') {
                    return { ok: true };
                }
                throw new Error(`Unexpected URL ${url}`);
            },
            apiFetchResponse: async () => new Response([
                JSON.stringify({ name: 'User', mes: 'backup hello', send_date: 1 }),
                JSON.stringify({ name: 'Alice', mes: 'backup reply', send_date: 2 }),
            ].join('\n')),
            render: () => {},
            showToast: () => {},
            formatDate: value => `date:${value}`,
            getChatContextKey: () => 'alice.png',
            getChatEntityName: () => 'Alice',
            getSelectedChatEntity: () => ({ avatar: 'alice.png', name: 'Alice' }),
            importModernChatFiles: async files => importedFiles.push(...files.map(file => file.name)),
            isGroupChatMode: () => false,
            sortChats,
        });

        await helpers.toggleChatBackups();
        expect(state.chatBackups.open).toBe(true);
        expect(state.chatBackups.items).toHaveLength(1);

        await helpers.viewChatBackup('backup.jsonl');
        expect(state.chatBackups.previewName).toBe('backup.jsonl');
        expect(state.chatBackups.previewText).toContain('backup reply');

        await helpers.restoreChatBackup('backup.jsonl');
        expect(importedFiles).toEqual(['backup.jsonl']);
        expect(state.chatBackups.restoring).toBe('');

        helpers.beginChatBackupDelete('backup.jsonl');
        await helpers.confirmChatBackupDelete();
        expect(requests).toContainEqual({ url: '/api/backups/chat/delete', body: { name: 'backup.jsonl' } });
        expect(state.chatBackups.items).toEqual([]);
    });

    test('creates, renames, deletes, and assigns background folders through folder helper', async () => {
        const state = {
            backgroundFolders: { folders: [], imageFolderMap: {} },
            backgroundVisibleCount: 8,
            backgroundFolderFilter: '',
            backgroundFolderAssignment: '',
            backgroundFolderCreating: { active: true, name: 'Folder A', running: false },
            backgroundFolderRenaming: { id: '', name: '', running: false },
            backgroundFolderDeleteConfirm: { id: '', running: false },
            backgroundSelection: { filenames: ['one.png', 'two.png'] },
        };
        const requests = [];
        const getBackgroundFolderById = id => state.backgroundFolders.folders.find(folder => folder.id === id) || null;
        const helpers = createBackgroundFolderActions({
            state,
            apiFetch: async (url, options = {}) => {
                requests.push({ url, body: options.body });
                if (url === '/api/image-metadata/folders/create') {
                    state.backgroundFolders.folders.push({ id: 'folder-a', name: options.body.name });
                    return { id: 'folder-a', name: options.body.name };
                }
                if (url === '/api/image-metadata/folders/update') {
                    getBackgroundFolderById(options.body.id).name = options.body.name;
                    return { ok: true };
                }
                if (url === '/api/image-metadata/folders/delete') {
                    state.backgroundFolders.folders = state.backgroundFolders.folders.filter(folder => folder.id !== options.body.id);
                    return { ok: true };
                }
                if (url === '/api/image-metadata/folders/assign') {
                    return { ok: true };
                }
                throw new Error(`Unexpected URL ${url}`);
            },
            loadData: async () => {},
            render: () => {},
            showToast: () => {},
            backgroundPageSize: 8,
            formatNumber: value => String(value),
            getBackgroundFolderById,
        });

        await helpers.createBackgroundFolder();
        expect(state.backgroundFolderFilter).toBe('folder-a');
        expect(state.backgroundFolderAssignment).toBe('folder-a');

        helpers.beginBackgroundFolderRename('folder-a');
        state.backgroundFolderRenaming.name = 'Folder B';
        await helpers.confirmBackgroundFolderRename();
        expect(getBackgroundFolderById('folder-a').name).toBe('Folder B');

        await helpers.assignSelectedBackgroundsToFolder();
        expect(requests.at(-1)).toEqual({
            url: '/api/image-metadata/folders/assign',
            body: { id: 'folder-a', paths: ['backgrounds/one.png', 'backgrounds/two.png'] },
        });

        helpers.beginBackgroundFolderDelete('folder-a');
        await helpers.confirmBackgroundFolderDelete();
        expect(state.backgroundFolderFilter).toBe('');
        expect(state.backgroundFolderAssignment).toBe('');
        expect(getBackgroundFolderById('folder-a')).toBeNull();
    });
});
