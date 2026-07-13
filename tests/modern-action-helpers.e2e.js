/* global globalThis */
import { test, expect } from '@playwright/test';
import { createBackgroundFolderActions } from '../public/modern/actions/background-folders.js';
import { createCharacterDataHelpers } from '../public/modern/actions/character-data.js';
import { createChatBackupActions } from '../public/modern/actions/chat-backups.js';
import { createChatFileActions } from '../public/modern/actions/chat-files.js';
import { createChatFileManagementActions } from '../public/modern/actions/chat-file-management.js';
import { createChatGenerationActions } from '../public/modern/actions/chat-generation.js';
import { createChatContextLoaderActions } from '../public/modern/actions/chat-context-loaders.js';
import { createGroupActions } from '../public/modern/actions/groups.js';
import { buildOpenAiPresetFromSettings, useOpenAiPresetFields } from '../public/modern/actions/openai-preset-fields.js';
import { createPersonaActions } from '../public/modern/actions/personas.js';
import { createRemoteResourceActions } from '../public/modern/actions/remote-resources.js';
import { createWorldbookDetailActions } from '../public/modern/actions/worldbook-details.js';
import { createWorldbookEntryBulkActions } from '../public/modern/actions/worldbook-entry-bulk.js';
import { createWorldbookEntryListHelpers } from '../public/modern/actions/worldbook-entry-list.js';
import { createWorldbookFileActions } from '../public/modern/actions/worldbook-files.js';
import { createDataLoader } from '../public/modern/shell/data-loader.js';

function sortChats(chats) {
    return [...chats].sort((left, right) => new Date(right.last_mes || 0).getTime() - new Date(left.last_mes || 0).getTime());
}

test.describe('Modern action helpers', () => {
    test('keeps persona state and avatar intact when deletion settings fail to save', async () => {
        const state = {
            settings: {
                power_user: {
                    personas: { 'persona.png': 'Persona' },
                    persona_descriptions: { 'persona.png': { description: 'Description' } },
                    default_persona: 'persona.png',
                },
            },
            avatarCacheBust: { 'persona.png': '1' },
            personaDeleteConfirm: { avatarId: 'persona.png' },
            personaEditing: { avatarId: '', form: {} },
        };
        const requests = [];
        const actions = createPersonaActions({
            state,
            apiFetch: async (url, options = {}) => {
                requests.push({ url, body: structuredClone(options.body) });
                throw new Error('settings save failed');
            },
            loadData: async () => {},
            render: () => {},
            showToast: () => {},
        });

        await expect(actions.confirmPersonaDelete()).rejects.toThrow('settings save failed');

        expect(requests.map(request => request.url)).toEqual(['/api/settings/save']);
        expect(requests[0].body.power_user.personas['persona.png']).toBeUndefined();
        expect(state.settings.power_user.personas['persona.png']).toBe('Persona');
        expect(state.settings.power_user.persona_descriptions['persona.png']).toEqual({ description: 'Description' });
        expect(state.settings.power_user.default_persona).toBe('persona.png');
        expect(state.avatarCacheBust['persona.png']).toBe('1');
    });

    test('persists persona removal before idempotent avatar cleanup', async () => {
        const state = {
            settings: {
                power_user: {
                    personas: { 'persona.png': 'Persona' },
                    persona_descriptions: { 'persona.png': { description: 'Description' } },
                    default_persona: 'persona.png',
                },
            },
            avatarCacheBust: { 'persona.png': '1' },
            personaDeleteConfirm: { avatarId: 'persona.png' },
            personaEditing: { avatarId: 'persona.png', form: {} },
        };
        const requests = [];
        let loadCount = 0;
        const actions = createPersonaActions({
            state,
            apiFetch: async (url, options = {}) => {
                requests.push({ url, body: structuredClone(options.body) });
                if (url === '/api/avatars/delete') {
                    const error = new Error('avatar already deleted');
                    error.status = 404;
                    throw error;
                }
                return { ok: true };
            },
            loadData: async () => loadCount++,
            render: () => {},
            showToast: () => {},
        });

        await actions.confirmPersonaDelete();

        expect(requests.map(request => request.url)).toEqual(['/api/settings/save', '/api/avatars/delete']);
        expect(requests[0].body.power_user.personas['persona.png']).toBeUndefined();
        expect(state.settings.power_user.personas['persona.png']).toBeUndefined();
        expect(state.settings.power_user.persona_descriptions['persona.png']).toBeUndefined();
        expect(state.settings.power_user.default_persona).toBeNull();
        expect(state.avatarCacheBust['persona.png']).toBeUndefined();
        expect(state.personaDeleteConfirm.avatarId).toBe('');
        expect(state.personaEditing.avatarId).toBe('');
        expect(loadCount).toBe(1);
    });

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

    test('serializes worldbook entry updates without dropping concurrent changes', async () => {
        const state = {
            worldDetails: {
                Lore: {
                    entries: {
                        1: { uid: 1, comment: 'One', disable: false },
                        2: { uid: 2, comment: 'Two', disable: false },
                    },
                },
            },
            worldEntryList: { selectedKeys: [] },
            errors: [],
        };
        let releaseFirstSave;
        const firstSaveBlocked = new Promise(resolve => {
            releaseFirstSave = resolve;
        });
        const savedDetails = [];
        const detailActions = createWorldbookDetailActions({
            state,
            apiFetch: async (url, options = {}) => {
                if (url !== '/api/worldinfo/edit') {
                    throw new Error(`Unexpected URL ${url}`);
                }
                savedDetails.push(structuredClone(options.body.data));
                if (savedDetails.length === 1) {
                    await firstSaveBlocked;
                }
                return { ok: true };
            },
            loadData: async () => {},
            showToast: () => {},
        });
        const bulkActions = createWorldbookEntryBulkActions({
            state,
            updateWorldbookDetail: detailActions.updateWorldbookDetail,
            render: () => {},
            showToast: () => {},
            formatNumber: String,
            syncWorldEntryOriginalData: () => {},
            deleteWorldEntryOriginalData: () => {},
        });

        const firstUpdate = bulkActions.toggleWorldEntry('Lore', '1');
        const secondUpdate = bulkActions.toggleWorldEntry('Lore', '2');
        releaseFirstSave();
        await Promise.all([firstUpdate, secondUpdate]);

        expect(savedDetails).toHaveLength(2);
        expect(savedDetails[0].entries['1'].disable).toBe(true);
        expect(savedDetails[0].entries['2'].disable).toBe(false);
        expect(savedDetails[1].entries['1'].disable).toBe(true);
        expect(savedDetails[1].entries['2'].disable).toBe(true);
        expect(state.worldDetails.Lore.entries['1'].disable).toBe(true);
        expect(state.worldDetails.Lore.entries['2'].disable).toBe(true);
    });

    test('waits for queued worldbook edits before deletion and blocks later edits', async () => {
        const state = {
            selected: { worldbook: 'Lore' },
            worldbooks: [{ file_id: 'Lore' }],
            worldDetails: { Lore: { entries: { 1: { uid: 1, disable: false } } } },
            settingsBundle: { world_names: ['Lore'] },
            settings: { world_info_settings: { world_info: { globalSelect: [] } } },
            worldbookDeleteConfirm: { worldbookId: 'Lore' },
            worldEntryEditing: { worldbookId: '', entryKey: '', mode: '', form: {} },
            worldEntryDeleteConfirm: { worldbookId: '', entryKey: '' },
            worldEntryBulkDeleteConfirm: { worldbookId: '' },
            worldEntryList: { worldbookId: 'Lore', query: '', sort: 'order', page: 1, selectedKeys: [] },
            worldbookCreating: { active: false, name: '' },
            errors: [],
        };
        let releaseEdit;
        const editBlocked = new Promise(resolve => {
            releaseEdit = resolve;
        });
        let markEditStarted;
        const editStarted = new Promise(resolve => {
            markEditStarted = resolve;
        });
        const requests = [];
        const apiHandlers = {
            '/api/worldinfo/edit': async () => {
                markEditStarted();
                await editBlocked;
                return { ok: true };
            },
            '/api/worldinfo/delete': async () => {
                throw new Error('delete response lost');
            },
            '/api/worldinfo/list': async () => [],
            '/api/files/sanitize-filename': async () => ({ fileName: 'Lore' }),
        };
        const apiFetch = async (url, options = {}) => {
            requests.push({ url, body: structuredClone(options.body) });
            expect(apiHandlers[url]).toBeDefined();
            return apiHandlers[url]();
        };
        const detailActions = createWorldbookDetailActions({
            state,
            apiFetch,
            loadData: async () => {},
            showToast: () => {},
        });
        const fileActions = createWorldbookFileActions({
            state,
            apiFetch,
            loadData: async () => {},
            render: () => {},
            showToast: () => {},
            downloadFile: () => {},
            loadWorldDetail: async () => {},
            deleteWorldbookFile: detailActions.deleteWorldbookFile,
            ensureWorldbookFileWriteAllowed: detailActions.ensureWorldbookFileWriteAllowed,
            restoreWorldbookFile: detailActions.restoreWorldbookFile,
            getGlobalWorldNames: () => [],
        });

        const firstEdit = detailActions.updateWorldbookDetail('Lore', detail => {
            detail.entries['1'].disable = true;
        });
        await editStarted;
        const deletion = fileActions.confirmWorldbookDelete();

        await expect(detailActions.updateWorldbookDetail('Lore', detail => {
            detail.entries['1'].comment = 'late edit';
        })).rejects.toThrow('世界书已删除或正在删除');
        expect(requests.map(request => request.url)).toEqual(['/api/worldinfo/edit']);

        state.worldbooks = [];
        state.settingsBundle.world_names = [];
        state.worldbookCreating = { active: true, name: 'Lore' };
        await expect(fileActions.saveWorldbookCreate()).rejects.toThrow('世界书正在删除');
        expect(requests.map(request => request.url)).toEqual(['/api/worldinfo/edit', '/api/files/sanitize-filename']);

        releaseEdit();
        await Promise.all([firstEdit, deletion]);

        expect(requests.map(request => request.url)).toEqual(['/api/worldinfo/edit', '/api/files/sanitize-filename', '/api/worldinfo/delete', '/api/worldinfo/list']);
        await expect(detailActions.updateWorldbookDetail('Lore', () => {})).rejects.toThrow('世界书已删除或正在删除');
        expect(requests.map(request => request.url)).toEqual(['/api/worldinfo/edit', '/api/files/sanitize-filename', '/api/worldinfo/delete', '/api/worldinfo/list']);
        expect(state.worldDetails.Lore).toBeUndefined();
        expect(state.worldbooks).toEqual([]);

        await fileActions.saveWorldbookCreate();
        expect(requests.at(-1)).toEqual({
            url: '/api/worldinfo/edit',
            body: { name: 'Lore', data: { name: 'Lore', entries: {}, extensions: {} }, overwrite: false },
        });
        state.worldDetails.Lore = { entries: {} };
        await detailActions.updateWorldbookDetail('Lore', detail => {
            detail.entries['2'] = { uid: 2, disable: false };
        });
        expect(requests.map(request => request.url)).toEqual([
            '/api/worldinfo/edit',
            '/api/files/sanitize-filename',
            '/api/worldinfo/delete',
            '/api/worldinfo/list',
            '/api/files/sanitize-filename',
            '/api/worldinfo/edit',
            '/api/worldinfo/edit',
        ]);
    });

    test('reloads authoritative worldbook data after an uncertain save failure', async () => {
        const state = {
            worldDetails: {
                Lore: {
                    entries: {
                        1: { uid: 1, disable: false },
                        2: { uid: 2, disable: false },
                    },
                },
            },
            errors: [],
        };
        let authoritativeDetail = structuredClone(state.worldDetails.Lore);
        let editCount = 0;
        let getCount = 0;
        const editPayloads = [];
        const detailActions = createWorldbookDetailActions({
            state,
            apiFetch: async (url, options = {}) => {
                if (url === '/api/worldinfo/get') {
                    getCount++;
                    return structuredClone(authoritativeDetail);
                }
                if (url === '/api/worldinfo/edit') {
                    editCount++;
                    editPayloads.push(structuredClone(options.body.data));
                    authoritativeDetail = structuredClone(options.body.data);
                    if (editCount === 1) {
                        throw new Error('response lost');
                    }
                    return { ok: true };
                }
                throw new Error(`Unexpected URL ${url}`);
            },
            loadData: async () => {},
            showToast: () => {},
        });

        const firstUpdate = detailActions.updateWorldbookDetail('Lore', detail => {
            detail.entries['1'].disable = true;
        });
        const secondUpdate = detailActions.updateWorldbookDetail('Lore', detail => {
            detail.entries['2'].disable = true;
        });
        const [firstResult, secondResult] = await Promise.allSettled([firstUpdate, secondUpdate]);

        expect(firstResult.status).toBe('rejected');
        expect(secondResult.status).toBe('fulfilled');
        expect(getCount).toBe(1);
        expect(editPayloads).toHaveLength(2);
        expect(editPayloads[1].entries['1'].disable).toBe(true);
        expect(editPayloads[1].entries['2'].disable).toBe(true);
        expect(state.worldDetails.Lore).toEqual(authoritativeDetail);
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

    test('does not let a stale chat context request replace the current selection', async () => {
        const alice = { avatar: 'alice.png', name: 'Alice' };
        const bob = { avatar: 'bob.png', name: 'Bob' };
        let selectedEntity = alice;
        let resolveAliceChats;
        const aliceChats = new Promise(resolve => {
            resolveAliceChats = resolve;
        });
        const state = {
            selected: { character: 'alice.png', chat: '' },
            chatLists: {},
            loadingChats: {},
            errors: [],
            chatSearch: { avatar: '', contextKey: '', query: '', searchedQuery: '', loading: false, results: [] },
            chatMessages: {},
            chatMetadata: {},
        };
        const messageRequests = [];
        const helpers = createChatContextLoaderActions({
            state,
            apiFetch: async (url, options = {}) => {
                if (url === '/api/characters/chats') {
                    return options.body.avatar_url === 'alice.png'
                        ? aliceChats
                        : [{ file_name: 'bob-chat.jsonl', file_id: 'bob-chat', last_mes: 2 }];
                }
                if (url === '/api/chats/get') {
                    messageRequests.push(options.body.avatar_url);
                    return [{ chat_metadata: {} }, { name: 'Bob', mes: 'current' }];
                }
                throw new Error(`Unexpected URL ${url}`);
            },
            render: () => {},
            showToast: () => {},
            getChatCacheKey: (contextKey, chatId) => `${contextKey}::${chatId}`,
            getChatContextKey: item => item?.avatar || '',
            getSelectedChatEntity: () => selectedEntity,
            isGroupChatMode: () => false,
            sortChats,
        });

        const stalePreparation = helpers.prepareChatForSelectedContext({ forceList: true });
        selectedEntity = bob;
        state.selected.character = 'bob.png';
        await helpers.prepareChatForSelectedContext({ forceList: true });
        expect(state.selected.chat).toBe('bob-chat');

        resolveAliceChats([{ file_name: 'alice-chat.jsonl', file_id: 'alice-chat', last_mes: 1 }]);
        await stalePreparation;

        expect(state.selected.chat).toBe('bob-chat');
        expect(messageRequests).toEqual(['bob.png']);
    });

    test('imports uploaded group chats into the captured context without replacing a newer selection', async () => {
        const firstGroup = { id: 'group-1', name: 'Group One', chats: ['old-chat'], chat_id: 'old-chat' };
        const secondGroup = { id: 'group-2', name: 'Group Two', chats: ['second-chat'], chat_id: 'second-chat' };
        let selectedEntity = firstGroup;
        let finishImport;
        const importReady = new Promise(resolve => {
            finishImport = resolve;
        });
        let finishMetadataSave;
        const metadataSaveReady = new Promise(resolve => {
            finishMetadataSave = resolve;
        });
        let metadataSaveStarted;
        const metadataSaveStartedPromise = new Promise(resolve => {
            metadataSaveStarted = resolve;
        });
        const state = {
            selected: { group: 'group-1', chat: 'old-chat' },
        };
        const importedTargets = [];
        const savedGroups = [];
        const refreshedEntities = [];
        const loadedChats = [];
        let clearedSearch = 0;
        const actions = createChatFileActions({
            state,
            apiFetch: async (url, options = {}) => {
                expect(url).toBe('/api/chats/group/import');
                importedTargets.push(options.body.get('avatar_url'));
                await importReady;
                return { res: 'group-import.jsonl' };
            },
            apiFetchResponse: async () => new Response(''),
            render: () => {},
            showToast: () => {},
            formatDate: String,
            formatNumber: String,
            getSelectedChatEntity: () => selectedEntity,
            getChatContextKey: (entity, groupMode = false) => groupMode ? `group:${entity?.id || ''}` : entity?.avatar || '',
            getChatEntityName: entity => entity?.name || '',
            isGroupChatMode: () => true,
            getSelectedChatList: () => [],
            getChatId: chat => String(chat?.file_id || chat?.file_name || '').replace(/\.jsonl$/i, ''),
            getChatCacheKey: (contextKey, chatId) => `${contextKey}::${chatId}`,
            getUserName: () => 'User',
            sortChats,
            clearChatSearch: () => clearedSearch++,
            loadChatMessages: async (entity, chatId) => loadedChats.push([entity, chatId]),
            refreshSelectedChatList: async (entity, options) => refreshedEntities.push([entity, options]),
            createModernChatFile: async () => '',
            updateGroupMetadata: async (group, updateMetadata) => {
                const nextMetadata = structuredClone(group);
                await updateMetadata(nextMetadata);
                savedGroups.push(nextMetadata);
                metadataSaveStarted();
                await metadataSaveReady;
                Object.assign(group, nextMetadata);
            },
            moveChatReadState: () => {},
            deleteChatReadState: () => {},
        });

        const importing = actions.importModernChatFiles([new File(['{}'], 'group.jsonl')]);
        selectedEntity = secondGroup;
        state.selected.group = 'group-2';
        state.selected.chat = 'second-chat';
        finishImport();
        await metadataSaveStartedPromise;

        expect(firstGroup).toMatchObject({ chats: ['old-chat'], chat_id: 'old-chat' });
        finishMetadataSave();
        await importing;

        expect(importedTargets).toEqual(['']);
        expect(savedGroups).toEqual([{ ...firstGroup, chats: ['old-chat', 'group-import'], chat_id: 'group-import' }]);
        expect(firstGroup).toMatchObject({ chats: ['old-chat', 'group-import'], chat_id: 'group-import' });
        expect(refreshedEntities).toEqual([[firstGroup, { groupMode: true }]]);
        expect(state.selected.chat).toBe('second-chat');
        expect(loadedChats).toEqual([]);
        expect(clearedSearch).toBe(0);
    });

    test('keeps a saved group chat file when the metadata response is uncertain', async () => {
        const previousLocalStorage = globalThis.localStorage;
        const previousWindow = globalThis.window;
        globalThis.localStorage = { getItem: () => null, setItem: () => {} };
        globalThis.window = { matchMedia: () => ({ matches: false }) };

        try {
            const { createChatContextActions } = await import('../public/modern/actions/chat-context.js');
            const group = { id: 'group-1', name: 'Group One', chats: ['old-chat'], chat_id: 'old-chat' };
            const state = {
                characters: [],
                groups: [group],
                chatMode: 'group',
                selected: { character: '', group: 'group-1', chat: 'old-chat' },
                chatLists: {},
                loadingChats: {},
                errors: [],
                chatSearch: { avatar: '', contextKey: '', query: '', searchedQuery: '', loading: false, results: [] },
                chatMessages: {},
                chatMetadata: {},
                chatReadState: { cursors: {}, contexts: {} },
                chatMessageLimits: {},
                chatDrafts: {},
                settings: {},
            };
            const requests = [];
            const actions = createChatContextActions({
                state,
                apiFetch: async (url) => {
                    requests.push(url);
                    if (url === '/api/chats/group/save') {
                        return { ok: true };
                    }
                    if (url === '/api/groups/edit') {
                        throw new Error('response lost');
                    }
                    if (url === '/api/groups/all') {
                        return [structuredClone(group)];
                    }
                    throw new Error(`Unexpected URL ${url}`);
                },
                render: () => {},
                showToast: () => {},
                getCharacterAvatarUrl: () => '',
            });

            await expect(actions.createModernChatFile(group)).rejects.toThrow('response lost');

            expect(requests).toEqual(['/api/chats/group/save', '/api/groups/edit', '/api/groups/all', '/api/groups/edit']);
            expect(group.chats).toEqual(['old-chat']);
            expect(group.chat_id).toBe('old-chat');
            expect(state.selected.chat).toBe('old-chat');
            expect(state.chatMessages).toEqual({});
            expect(state.chatMetadata).toEqual({});
        } finally {
            globalThis.localStorage = previousLocalStorage;
            globalThis.window = previousWindow;
        }
    });

    test('reuses an in-flight group chat creation for repeated clicks', async () => {
        const previousLocalStorage = globalThis.localStorage;
        const previousWindow = globalThis.window;
        globalThis.localStorage = { getItem: () => null, setItem: () => {} };
        globalThis.window = { matchMedia: () => ({ matches: false }) };

        try {
            const { createChatContextActions } = await import('../public/modern/actions/chat-context.js');
            const group = { id: 'group-1', name: 'Group One', chats: ['old-chat'], chat_id: 'old-chat' };
            const state = {
                characters: [],
                groups: [group],
                chatMode: 'group',
                selected: { character: '', group: 'group-1', chat: 'old-chat' },
                chatLists: {},
                loadingChats: {},
                errors: [],
                chatSearch: { avatar: '', contextKey: '', query: '', searchedQuery: '', loading: false, results: [] },
                chatMessages: {},
                chatMetadata: {},
                chatReadState: { cursors: {}, contexts: {} },
                chatMessageLimits: {},
                chatDrafts: {},
                settings: {},
            };
            let finishChatSave;
            const chatSaveReady = new Promise(resolve => {
                finishChatSave = resolve;
            });
            const requests = [];
            const actions = createChatContextActions({
                state,
                apiFetch: async (url, options = {}) => {
                    requests.push({ url, body: options.body });
                    if (url === '/api/chats/group/save') {
                        await chatSaveReady;
                        return { ok: true };
                    }
                    if (url === '/api/groups/edit') {
                        return { ok: true };
                    }
                    if (url === '/api/chats/search') {
                        return [];
                    }
                    throw new Error(`Unexpected URL ${url}`);
                },
                render: () => {},
                showToast: () => {},
                getCharacterAvatarUrl: () => '',
            });

            const firstCreation = actions.createModernChatFile(group);
            const secondCreation = actions.createModernChatFile(group);
            expect(secondCreation).toBe(firstCreation);

            finishChatSave();
            const [firstChatId, secondChatId] = await Promise.all([firstCreation, secondCreation]);

            expect(secondChatId).toBe(firstChatId);
            expect(requests.filter(request => request.url === '/api/chats/group/save')).toHaveLength(1);
            expect(requests.filter(request => request.url === '/api/groups/edit')).toHaveLength(1);
            expect(requests.filter(request => request.url === '/api/chats/search')).toHaveLength(1);
            expect(group.chats).toEqual(['old-chat', firstChatId]);
            expect(group.chat_id).toBe(firstChatId);
        } finally {
            globalThis.localStorage = previousLocalStorage;
            globalThis.window = previousWindow;
        }
    });

    test('serializes group metadata read-modify-write operations', async () => {
        const previousLocalStorage = globalThis.localStorage;
        const previousWindow = globalThis.window;
        globalThis.localStorage = { getItem: () => null, setItem: () => {} };
        globalThis.window = { matchMedia: () => ({ matches: false }) };

        try {
            const { createChatContextActions } = await import('../public/modern/actions/chat-context.js');
            const group = { id: 'group-1', name: 'Group One', chats: ['old-chat'], chat_id: 'old-chat' };
            const state = {
                characters: [],
                groups: [group],
                chatMode: 'group',
                selected: { character: '', group: 'group-1', chat: 'old-chat' },
                chatLists: {},
                loadingChats: {},
                errors: [],
                chatSearch: { avatar: '', contextKey: '', query: '', searchedQuery: '', loading: false, results: [] },
                chatMessages: {},
                chatMetadata: {},
                chatReadState: { cursors: {}, contexts: {} },
                chatMessageLimits: {},
                chatDrafts: {},
                settings: {},
            };
            let finishFirstSave;
            const firstSaveReady = new Promise(resolve => {
                finishFirstSave = resolve;
            });
            let markFirstSaveStarted;
            const firstSaveStarted = new Promise(resolve => {
                markFirstSaveStarted = resolve;
            });
            const savedMetadata = [];
            const actions = createChatContextActions({
                state,
                apiFetch: async (url, options = {}) => {
                    if (url !== '/api/groups/edit') {
                        throw new Error(`Unexpected URL ${url}`);
                    }
                    savedMetadata.push(structuredClone(options.body));
                    if (savedMetadata.length === 1) {
                        markFirstSaveStarted();
                        await firstSaveReady;
                    }
                    return { ok: true };
                },
                render: () => {},
                showToast: () => {},
                getCharacterAvatarUrl: () => '',
            });

            const firstUpdate = actions.updateGroupMetadata(group, metadata => {
                metadata.chats.push('imported-chat');
            });
            const secondUpdate = actions.updateGroupMetadata(group, metadata => {
                metadata.chats.push('created-chat');
                metadata.chat_id = 'created-chat';
            });
            await firstSaveStarted;
            expect(savedMetadata).toHaveLength(1);

            finishFirstSave();
            await Promise.all([firstUpdate, secondUpdate]);

            expect(savedMetadata).toHaveLength(2);
            expect(savedMetadata[1].chats).toEqual(['old-chat', 'imported-chat', 'created-chat']);
            expect(group.chats).toEqual(['old-chat', 'imported-chat', 'created-chat']);
            expect(group.chat_id).toBe('created-chat');
        } finally {
            globalThis.localStorage = previousLocalStorage;
            globalThis.window = previousWindow;
        }
    });

    test('serializes group settings edits with chat metadata updates', async () => {
        const previousLocalStorage = globalThis.localStorage;
        const previousWindow = globalThis.window;
        globalThis.localStorage = { getItem: () => null, setItem: () => {} };
        globalThis.window = { matchMedia: () => ({ matches: false }) };

        try {
            const { createChatContextActions } = await import('../public/modern/actions/chat-context.js');
            const group = {
                id: 'group-1',
                name: 'Group One',
                avatar_url: '',
                members: ['alice.png'],
                disabled_members: [],
                chats: ['old-chat'],
                chat_id: 'old-chat',
                date_added: 123,
            };
            const secondGroup = { id: 'group-2', name: 'Group Two', members: ['bob.png'], chats: ['second-chat'], chat_id: 'second-chat' };
            const state = {
                characters: [],
                groups: [group, secondGroup],
                chatMode: 'group',
                selected: { character: '', group: 'group-1', chat: 'old-chat' },
                chatLists: {},
                loadingChats: {},
                errors: [],
                chatSearch: { avatar: '', contextKey: '', query: '', searchedQuery: '', loading: false, results: [] },
                chatMessages: {},
                chatMetadata: {},
                chatReadState: { cursors: {}, contexts: {} },
                chatMessageLimits: {},
                chatDrafts: {},
                settings: {},
                groupEditing: {
                    id: 'group-1',
                    form: {
                        name: 'Edited Group',
                        avatar_url: '',
                        members: ['alice.png'],
                        allow_self_responses: true,
                        activation_strategy: '1',
                        generation_mode: '2',
                        auto_mode_delay: '7',
                        fav: true,
                    },
                },
                groupDeleteConfirm: { id: '', name: '' },
            };
            let releaseFirstSave;
            const firstSaveBlocked = new Promise(resolve => {
                releaseFirstSave = resolve;
            });
            let markFirstSaveStarted;
            const firstSaveStarted = new Promise(resolve => {
                markFirstSaveStarted = resolve;
            });
            const savedMetadata = [];
            const saveHandlers = [
                async () => {
                    markFirstSaveStarted();
                    await firstSaveBlocked;
                    return { ok: true };
                },
                async () => ({ ok: true }),
            ];
            const apiFetch = async (url, options = {}) => {
                expect(url).toBe('/api/groups/edit');
                savedMetadata.push(structuredClone(options.body));
                const save = saveHandlers.shift();
                expect(save).toBeDefined();
                return save();
            };
            const chatActions = createChatContextActions({
                state,
                apiFetch,
                render: () => {},
                showToast: () => {},
                getCharacterAvatarUrl: () => '',
            });
            const groupActions = createGroupActions({
                state,
                apiFetch,
                loadData: async () => {},
                render: () => {},
                showToast: () => {},
                ensureAvailableChatMode: () => {},
                updateGroupMetadata: chatActions.updateGroupMetadata,
                deleteGroupMetadata: chatActions.deleteGroupMetadata,
            });

            const chatUpdate = chatActions.updateGroupMetadata(group, metadata => {
                metadata.chats.push('new-chat');
                metadata.chat_id = 'new-chat';
            });
            await firstSaveStarted;
            const settingsUpdate = groupActions.saveGroupEdit();
            expect(savedMetadata).toHaveLength(1);
            const newerEditing = { id: 'group-2', form: { name: 'Unsaved Group Two' } };
            state.groupEditing = newerEditing;
            state.selected.group = 'group-2';
            state.selected.chat = 'second-chat';

            releaseFirstSave();
            await Promise.all([chatUpdate, settingsUpdate]);

            expect(savedMetadata).toHaveLength(2);
            expect(savedMetadata[1]).toMatchObject({
                name: 'Edited Group',
                chats: ['old-chat', 'new-chat'],
                chat_id: 'new-chat',
                allow_self_responses: true,
                activation_strategy: 1,
                generation_mode: 2,
            });
            expect(savedMetadata[1].date_added).toBeUndefined();
            expect(group).toMatchObject(savedMetadata[1]);
            expect(state.groupEditing).toBe(newerEditing);
            expect(state.selected).toMatchObject({ group: 'group-2', chat: 'second-chat' });
        } finally {
            globalThis.localStorage = previousLocalStorage;
            globalThis.window = previousWindow;
        }
    });

    test('waits for group metadata updates before deletion and blocks later writes', async () => {
        const previousLocalStorage = globalThis.localStorage;
        const previousWindow = globalThis.window;
        globalThis.localStorage = { getItem: () => null, setItem: () => {} };
        globalThis.window = { matchMedia: () => ({ matches: false }) };

        try {
            const { createChatContextActions } = await import('../public/modern/actions/chat-context.js');
            const group = { id: 'group-1', name: 'Group One', chats: ['old-chat'], chat_id: 'old-chat' };
            const secondGroup = { id: 'group-2', name: 'Group Two', chats: ['second-chat'], chat_id: 'second-chat' };
            const state = {
                characters: [],
                groups: [group, secondGroup],
                chatMode: 'group',
                selected: { character: '', group: 'group-1', chat: 'old-chat' },
                chatLists: {},
                loadingChats: {},
                errors: [],
                chatSearch: { avatar: '', contextKey: '', query: '', searchedQuery: '', loading: false, results: [] },
                chatMessages: {},
                chatMetadata: {},
                chatReadState: { cursors: {}, contexts: {} },
                chatMessageLimits: {},
                chatDrafts: {},
                settings: {},
                groupEditing: { id: '', form: {} },
                groupDeleteConfirm: { id: 'group-1', name: 'Group One' },
            };
            let releaseMetadataSave;
            const metadataSaveBlocked = new Promise(resolve => {
                releaseMetadataSave = resolve;
            });
            let markMetadataSaveStarted;
            const metadataSaveStarted = new Promise(resolve => {
                markMetadataSaveStarted = resolve;
            });
            const requests = [];
            const apiHandlers = {
                '/api/groups/edit': async () => {
                    markMetadataSaveStarted();
                    await metadataSaveBlocked;
                    return { ok: true };
                },
                '/api/groups/delete': async () => {
                    throw new Error('delete response lost');
                },
                '/api/groups/all': async () => [],
            };
            const apiFetch = async (url, options = {}) => {
                requests.push({ url, body: structuredClone(options.body) });
                expect(apiHandlers[url]).toBeDefined();
                return apiHandlers[url]();
            };
            const chatActions = createChatContextActions({
                state,
                apiFetch,
                render: () => {},
                showToast: () => {},
                getCharacterAvatarUrl: () => '',
            });
            let ensureModeCount = 0;
            const toasts = [];
            const groupActions = createGroupActions({
                state,
                apiFetch,
                loadData: async () => {
                    state.groups = [group, secondGroup];
                    throw new Error('refresh unavailable');
                },
                render: () => {},
                showToast: (...args) => toasts.push(args),
                ensureAvailableChatMode: () => ensureModeCount++,
                updateGroupMetadata: chatActions.updateGroupMetadata,
                deleteGroupMetadata: chatActions.deleteGroupMetadata,
            });

            const metadataUpdate = chatActions.updateGroupMetadata(group, metadata => {
                metadata.chats.push('new-chat');
            });
            await metadataSaveStarted;
            const deletion = groupActions.confirmGroupDelete();
            const newerDeleteConfirm = { id: 'group-2', name: 'Group Two' };
            const newerEditing = { id: 'group-2', form: { name: 'Unsaved Group Two' } };
            state.groupDeleteConfirm = newerDeleteConfirm;
            state.groupEditing = newerEditing;
            state.selected.group = 'group-2';
            state.selected.chat = 'second-chat';

            await expect(chatActions.updateGroupMetadata(group, metadata => {
                metadata.chats.push('late-chat');
            })).rejects.toThrow('群聊已删除或正在删除');
            expect(requests.map(request => request.url)).toEqual(['/api/groups/edit']);

            releaseMetadataSave();
            await Promise.all([metadataUpdate, deletion]);

            expect(requests.map(request => request.url)).toEqual(['/api/groups/edit', '/api/groups/delete', '/api/groups/all']);
            expect(state.groups).toEqual([secondGroup]);
            expect(state.groupDeleteConfirm).toBe(newerDeleteConfirm);
            expect(state.groupEditing).toBe(newerEditing);
            expect(state.selected).toMatchObject({ group: 'group-2', chat: 'second-chat' });
            expect(ensureModeCount).toBe(1);
            expect(state.errors).toContainEqual({ key: 'group-delete-refresh', message: '群组 group-1 已删除，但列表刷新失败：refresh unavailable' });
            expect(toasts).toEqual([['群组已删除，但列表刷新失败', 'group-1：refresh unavailable']]);
            await expect(chatActions.updateGroupMetadata(group, () => {})).rejects.toThrow('群聊已删除或正在删除');
            expect(requests.map(request => request.url)).toEqual(['/api/groups/edit', '/api/groups/delete', '/api/groups/all']);
        } finally {
            globalThis.localStorage = previousLocalStorage;
            globalThis.window = previousWindow;
        }
    });

    test('clears a newer chat selection that still belongs to a deleted group', async () => {
        const group = { id: 'group-1', name: 'Group One', chats: ['old-chat', 'new-chat'], chat_id: 'old-chat' };
        const state = {
            groups: [group],
            selected: { group: 'group-1', chat: 'old-chat' },
            groupEditing: { id: '', form: {} },
            groupDeleteConfirm: { id: 'group-1', name: 'Group One' },
            chatLists: {},
            chatMessages: {},
            chatMessageLimits: {},
            chatMetadata: {},
            chatDrafts: {},
            errors: [],
        };
        let releaseDelete;
        const deleteBlocked = new Promise(resolve => {
            releaseDelete = resolve;
        });
        let markDeleteStarted;
        const deleteStarted = new Promise(resolve => {
            markDeleteStarted = resolve;
        });
        const actions = createGroupActions({
            state,
            apiFetch: async () => ({}),
            loadData: async () => {},
            render: () => {},
            showToast: () => {},
            ensureAvailableChatMode: () => {},
            updateGroupMetadata: async () => ({}),
            deleteGroupMetadata: async groupId => {
                expect(groupId).toBe('group-1');
                markDeleteStarted();
                await deleteBlocked;
            },
        });

        const deletion = actions.confirmGroupDelete();
        await deleteStarted;
        state.selected.chat = 'new-chat';
        releaseDelete();
        await deletion;

        expect(state.selected).toMatchObject({ group: '', chat: '' });
        expect(state.groups).toEqual([]);
    });

    test('serializes chat RMW operations and blocks saves behind file deletion', async () => {
        const previousLocalStorage = globalThis.localStorage;
        const previousWindow = globalThis.window;
        globalThis.localStorage = { getItem: () => null, setItem: () => {} };
        globalThis.window = { matchMedia: () => ({ matches: false }) };

        try {
            const { createChatContextActions } = await import('../public/modern/actions/chat-context.js');
            const character = { avatar: 'alice.png', name: 'Alice' };
            const contextKey = 'alice.png';
            const chatId = 'chat-one';
            const cacheKey = `${contextKey}::${chatId}`;
            const state = {
                characters: [character],
                groups: [],
                chatMode: 'character',
                selected: { character: character.avatar, group: '', chat: chatId },
                chatLists: { [contextKey]: [{ file_id: chatId, chat_items: 2 }] },
                loadingChats: {},
                errors: [],
                chatSearch: { avatar: '', contextKey: '', query: '', searchedQuery: '', loading: false, results: [] },
                chatMessages: { [cacheKey]: [{ mes: 'first' }, { mes: 'second' }] },
                chatMetadata: { [cacheKey]: { integrity: 'revision-1' } },
                chatReadState: { cursors: {}, contexts: {} },
                chatMessageLimits: {},
                chatDrafts: {},
                settings: {},
            };
            let releaseFirstSave;
            const firstSaveBlocked = new Promise(resolve => {
                releaseFirstSave = resolve;
            });
            let markFirstSaveStarted;
            const firstSaveStarted = new Promise(resolve => {
                markFirstSaveStarted = resolve;
            });
            const savedChats = [];
            const savedIntegrities = [];
            const events = [];
            const actions = createChatContextActions({
                state,
                apiFetch: async (url, options = {}) => {
                    expect(url).toBe('/api/chats/save');
                    savedChats.push(structuredClone(options.body.chat.slice(1)));
                    savedIntegrities.push(options.body.chat[0].chat_metadata.integrity);
                    events.push(`save-${savedChats.length}`);
                    if (savedChats.length === 1) {
                        markFirstSaveStarted();
                        await firstSaveBlocked;
                    }
                    return { ok: true, integrity: `revision-${savedChats.length + 1}` };
                },
                render: () => {},
                showToast: () => {},
                getCharacterAvatarUrl: () => '',
            });

            const firstUpdate = actions.updateModernChat(character, chatId, messages => {
                messages[0].mes = 'edited';
            });
            await firstSaveStarted;
            const secondUpdate = actions.updateModernChat(character, chatId, messages => {
                messages.splice(1, 1);
            });
            const generation = actions.runModernChatFileOperation(character, chatId, async () => {
                events.push('generation');
            });
            const deletion = actions.deleteModernChatFile(contextKey, chatId, async () => {
                events.push('delete');
            });

            await expect(actions.updateModernChat(character, chatId, () => {})).rejects.toThrow('聊天文件已删除、重命名或正在变更');
            releaseFirstSave();
            await Promise.all([firstUpdate, secondUpdate, generation, deletion]);

            expect(savedChats).toEqual([
                [{ mes: 'edited' }, { mes: 'second' }],
                [{ mes: 'edited' }],
            ]);
            expect(savedIntegrities).toEqual(['revision-1', 'revision-2']);
            expect(events).toEqual(['save-1', 'save-2', 'generation', 'delete']);
            expect(state.chatMessages[cacheKey]).toEqual([{ mes: 'edited' }]);
            expect(state.chatMetadata[cacheKey].integrity).toBe('revision-3');
            await expect(actions.saveModernChat(character, chatId, [])).rejects.toThrow('聊天文件已删除、重命名或正在变更');
        } finally {
            globalThis.localStorage = previousLocalStorage;
            globalThis.window = previousWindow;
        }
    });

    test('releases chat file barriers only for confirmed non-mutating HTTP failures', async () => {
        const previousLocalStorage = globalThis.localStorage;
        const previousWindow = globalThis.window;
        globalThis.localStorage = { getItem: () => null, setItem: () => {} };
        globalThis.window = { matchMedia: () => ({ matches: false }) };

        try {
            const { createChatContextActions } = await import('../public/modern/actions/chat-context.js');
            const character = { avatar: 'alice.png', name: 'Alice' };
            const contextKey = character.avatar;
            const chatIds = ['rename-conflict', 'rename-missing', 'delete-invalid', 'delete-unknown'];
            const state = {
                characters: [character],
                groups: [],
                chatMode: 'character',
                selected: { character: character.avatar, group: '', chat: chatIds[0] },
                chatLists: { [contextKey]: chatIds.map(file_id => ({ file_id })) },
                loadingChats: {},
                errors: [],
                engine: { generating: false },
                chatSearch: { avatar: '', contextKey: '', query: '', searchedQuery: '', loading: false, results: [] },
                chatMessages: Object.fromEntries(chatIds.map(chatId => [`${contextKey}::${chatId}`, [{ mes: chatId }]])),
                chatMetadata: Object.fromEntries(chatIds.map(chatId => [`${contextKey}::${chatId}`, {}])),
                chatReadState: { cursors: {}, contexts: {} },
                chatMessageLimits: {},
                chatDrafts: {},
                chatRenaming: { key: '', name: '' },
                chatDeleteConfirm: { key: '', name: '' },
                settings: {},
            };
            const statusByChatId = {
                'rename-conflict': 409,
                'rename-missing': 404,
                'delete-invalid': 400,
                'delete-unknown': 500,
            };
            const throwStatus = status => {
                const error = new Error(`request failed: ${status}`);
                error.status = status;
                throw error;
            };
            const apiFetch = async (url, options = {}) => ({
                '/api/chats/save': () => ({ ok: true }),
                '/api/chats/rename': () => throwStatus(statusByChatId[String(options.body.original_file).replace(/\.jsonl$/u, '')]),
                '/api/chats/delete': () => throwStatus(statusByChatId[String(options.body.chatfile).replace(/\.jsonl$/u, '')]),
            })[url]();
            const contextActions = createChatContextActions({
                state,
                apiFetch,
                render: () => {},
                showToast: () => {},
                getCharacterAvatarUrl: () => '',
            });
            const fileActions = createChatFileManagementActions({
                state,
                apiFetch,
                render: () => {},
                showToast: () => {},
                getSelectedChatEntity: () => character,
                getChatContextKey: () => contextKey,
                isGroupChatMode: () => false,
                getSelectedChatList: () => state.chatLists[contextKey],
                getChatCacheKey: (key, chatId) => `${key}::${chatId}`,
                updateGroupMetadata: async () => {},
                refreshSelectedChatList: async () => {},
                loadChatMessages: async () => {},
                moveChatReadState: () => {},
                deleteChatReadState: () => {},
                renameModernChatFile: contextActions.renameModernChatFile,
                deleteModernChatFile: contextActions.deleteModernChatFile,
            });
            const selectRename = chatId => {
                state.selected.chat = chatId;
                state.chatRenaming = { key: `${contextKey}::${chatId}`, name: `${chatId}-new` };
            };
            const selectDelete = chatId => {
                state.selected.chat = chatId;
                state.chatDeleteConfirm = { key: `${contextKey}::${chatId}`, name: chatId };
            };

            selectRename('rename-conflict');
            await expect(fileActions.saveModernChatRename()).rejects.toMatchObject({ status: 409 });
            await expect(contextActions.saveModernChat(character, 'rename-conflict', [])).resolves.toBeUndefined();

            selectRename('rename-missing');
            await expect(fileActions.saveModernChatRename()).rejects.toMatchObject({ status: 404 });
            await expect(contextActions.saveModernChat(character, 'rename-missing', [])).rejects.toThrow('聊天文件已删除、重命名或正在变更');

            selectDelete('delete-invalid');
            await expect(fileActions.confirmModernChatDelete()).rejects.toMatchObject({ status: 400 });
            await expect(contextActions.saveModernChat(character, 'delete-invalid', [])).resolves.toBeUndefined();

            selectDelete('delete-unknown');
            await expect(fileActions.confirmModernChatDelete()).rejects.toMatchObject({ status: 500 });
            await expect(contextActions.saveModernChat(character, 'delete-unknown', [])).rejects.toThrow('聊天文件已删除、重命名或正在变更');
        } finally {
            globalThis.localStorage = previousLocalStorage;
            globalThis.window = previousWindow;
        }
    });

    test('keeps only the newest data load result and loading state', async () => {
        const state = {
            route: 'dashboard',
            loading: false,
            loaded: false,
            errors: [{ key: 'old', message: 'old error' }],
            settingsBundle: {},
            settings: {},
            characters: [],
            groups: [],
            worldbooks: [],
            selected: { character: 'selected-character', group: 'selected-group', worldbook: 'selected-worldbook' },
        };
        let requestCount = 0;
        let rejectOldStats;
        const oldStatsBlocked = new Promise((_resolve, reject) => {
            rejectOldStats = reject;
        });
        const valueFactories = {
            '/api/settings/get': generation => ({ settings: JSON.stringify({ generation }) }),
            '/api/characters/all': generation => [{ avatar: `${generation}.png` }],
            '/api/groups/all': generation => [{ id: generation }],
            '/api/worldinfo/list': generation => [{ file_id: generation }],
        };
        const values = (url, generation) => (valueFactories[url] || (value => ({ generation: value })))(generation);
        const loader = createDataLoader({
            state,
            apiFetch: (url) => {
                const generation = requestCount++ < 12 ? 'old' : 'new';
                if (generation === 'old' && url === '/api/stats/get') {
                    return oldStatsBlocked;
                }
                return Promise.resolve(values(url, generation));
            },
            render: () => {},
            showToast: () => {},
            ensureAvailableChatMode: () => {},
            prepareChatForSelectedContext: async () => {},
            loadWorldDetail: async () => {},
        });

        const oldLoad = loader.loadData({ silent: true });
        const newLoad = loader.loadData({ silent: true });
        await newLoad;

        expect(state.loading).toBe(false);
        expect(state.characters).toEqual([{ avatar: 'new.png' }]);
        expect(state.settings).toEqual({ generation: 'new' });
        expect(state.errors).toEqual([]);

        rejectOldStats(new Error('old request failed'));
        await oldLoad;

        expect(state.loading).toBe(false);
        expect(state.characters).toEqual([{ avatar: 'new.png' }]);
        expect(state.settings).toEqual({ generation: 'new' });
        expect(state.errors).toEqual([]);
    });

    test('invalidates nested chat and worldbook work from an older data load', async () => {
        const state = {
            route: 'chat',
            loading: false,
            loaded: false,
            errors: [],
            settingsBundle: {},
            settings: {},
            characters: [],
            groups: [],
            worldbooks: [],
            selected: { character: 'same.png', group: 'same-group', worldbook: 'same-world' },
            nestedChat: '',
            nestedWorldbook: '',
        };
        let requestCount = 0;
        const values = (url, generation) => ({
            '/api/users/me': { generation },
            '/api/settings/get': { settings: JSON.stringify({ generation }) },
            '/api/characters/all': [{ avatar: 'same.png', generation }],
            '/api/groups/all': [{ id: 'same-group', generation }],
            '/api/worldinfo/list': [{ file_id: 'same-world', generation }],
            '/api/backgrounds/all': { generation },
            '/api/backgrounds/folders': { generation },
            '/api/assets/get': { generation },
            '/api/extensions/discover': { generation },
            '/api/secrets/settings': { generation },
            '/api/secrets/read': { generation },
            '/api/stats/get': { generation },
        })[url];
        let releaseOldChat;
        const oldChatBlocked = new Promise(resolve => {
            releaseOldChat = resolve;
        });
        let markOldChatStarted;
        const oldChatStarted = new Promise(resolve => {
            markOldChatStarted = resolve;
        });
        const chatOperations = [
            async isCurrent => {
                markOldChatStarted();
                await oldChatBlocked;
                expect(isCurrent()).toBe(false);
            },
            async isCurrent => {
                expect(isCurrent()).toBe(true);
                state.nestedChat = 'new';
            },
        ];
        let releaseOldWorldbook;
        const oldWorldbookBlocked = new Promise(resolve => {
            releaseOldWorldbook = resolve;
        });
        let markOldWorldbookStarted;
        const oldWorldbookStarted = new Promise(resolve => {
            markOldWorldbookStarted = resolve;
        });
        const worldbookOperations = [
            async isCurrent => {
                markOldWorldbookStarted();
                await oldWorldbookBlocked;
                expect(isCurrent()).toBe(false);
            },
            async isCurrent => {
                expect(isCurrent()).toBe(true);
                state.nestedWorldbook = 'new';
            },
        ];
        const loader = createDataLoader({
            state,
            apiFetch: (url) => {
                const generation = ['old', 'new'][Math.floor(requestCount++ / 12) % 2];
                return Promise.resolve(values(url, generation));
            },
            render: () => {},
            showToast: () => {},
            ensureAvailableChatMode: () => {},
            prepareChatForSelectedContext: ({ isCurrent }) => chatOperations.shift()(isCurrent),
            loadWorldDetail: (_worldbookId, { isCurrent }) => worldbookOperations.shift()(isCurrent),
        });

        const oldChatLoad = loader.loadData({ silent: true });
        await oldChatStarted;
        const newChatLoad = loader.loadData({ silent: true });
        await newChatLoad;
        releaseOldChat();
        await oldChatLoad;
        expect(state.nestedChat).toBe('new');

        state.route = 'worldbooks';
        const oldWorldbookLoad = loader.loadData({ silent: true });
        await oldWorldbookStarted;
        const newWorldbookLoad = loader.loadData({ silent: true });
        await newWorldbookLoad;
        releaseOldWorldbook();
        await oldWorldbookLoad;
        expect(state.nestedWorldbook).toBe('new');
        expect(state.loading).toBe(false);
    });

    test('keeps a newer chat context while a group rename reports partial success', async () => {
        const firstGroup = { id: 'group-1', chats: ['old-chat'], chat_id: 'old-chat' };
        const secondGroup = { id: 'group-2', chats: ['second-chat'], chat_id: 'second-chat' };
        let selectedEntity = firstGroup;
        let finishRename;
        const renameReady = new Promise(resolve => {
            finishRename = resolve;
        });
        const state = {
            selected: { chat: 'old-chat' },
            chatRenaming: { key: 'group:group-1::old-chat', name: 'renamed-chat' },
            chatDeleteConfirm: { key: '', name: '' },
            chatLists: {
                'group:group-1': [{ file_id: 'old-chat' }],
                'group:group-2': [{ file_id: 'second-chat' }],
            },
            chatMessages: { 'group:group-1::old-chat': [{ mes: 'old' }] },
            chatMetadata: { 'group:group-1::old-chat': {} },
            chatMessageLimits: {},
            chatDrafts: {},
        };
        let attemptedMetadata;
        const refreshed = [];
        const loaded = [];
        const actions = createChatFileManagementActions({
            state,
            apiFetch: async (url, options = {}) => {
                expect(url).toBe('/api/chats/rename');
                expect(options.body.is_group).toBe(true);
                await renameReady;
                return { sanitizedFileName: 'renamed-chat' };
            },
            render: () => {},
            showToast: () => {},
            getSelectedChatEntity: () => selectedEntity,
            getChatContextKey: (entity, groupMode = true) => groupMode ? `group:${entity.id}` : entity.avatar,
            isGroupChatMode: () => true,
            getSelectedChatList: () => state.chatLists[`group:${selectedEntity.id}`] || [],
            getChatCacheKey: (contextKey, chatId) => `${contextKey}::${chatId}`,
            saveGroupMetadata: async () => {},
            updateGroupMetadata: async (group, updateMetadata) => {
                attemptedMetadata = structuredClone(group);
                await updateMetadata(attemptedMetadata);
                throw new Error('metadata unavailable');
            },
            refreshSelectedChatList: async (entity, options) => refreshed.push([entity, options]),
            loadChatMessages: async (...args) => loaded.push(args),
            moveChatReadState: () => {},
            deleteChatReadState: () => {},
            renameModernChatFile: (_contextKey, _chatId, operation) => operation(),
            deleteModernChatFile: (_contextKey, _chatId, operation) => operation(),
        });

        const renaming = actions.saveModernChatRename();
        selectedEntity = secondGroup;
        state.selected.chat = 'second-chat';
        finishRename();

        await expect(renaming).rejects.toThrow('聊天文件已重命名为 renamed-chat.jsonl，但群聊索引更新失败');
        expect(attemptedMetadata).toMatchObject({ chats: ['renamed-chat'], chat_id: 'renamed-chat' });
        expect(firstGroup).toMatchObject({ chats: ['old-chat'], chat_id: 'old-chat' });
        expect(state.selected.chat).toBe('second-chat');
        expect(refreshed).toEqual([[firstGroup, { groupMode: true, quiet: true }]]);
        expect(loaded).toEqual([]);
    });

    test('converges the current chat UI when group metadata fails after file deletion', async () => {
        const group = { id: 'group-1', chats: ['old-chat', 'next-chat'], chat_id: 'old-chat' };
        const state = {
            selected: { chat: 'old-chat' },
            chatRenaming: { key: '', name: '' },
            chatDeleteConfirm: { key: 'group:group-1::old-chat', name: 'old-chat' },
            chatLists: { 'group:group-1': [{ file_id: 'old-chat' }, { file_id: 'next-chat' }] },
            chatMessages: { 'group:group-1::old-chat': [{ mes: 'old' }] },
            chatMetadata: { 'group:group-1::old-chat': {} },
            chatMessageLimits: { 'group:group-1::old-chat': 80 },
            chatDrafts: { 'group:group-1::old-chat': 'draft' },
        };
        let attemptedMetadata;
        const loaded = [];
        const actions = createChatFileManagementActions({
            state,
            apiFetch: async (url, options = {}) => {
                expect(url).toBe('/api/chats/group/delete');
                expect(options.body).toEqual({ id: 'old-chat' });
                return { ok: true };
            },
            render: () => {},
            showToast: () => {},
            getSelectedChatEntity: () => group,
            getChatContextKey: entity => `group:${entity.id}`,
            isGroupChatMode: () => true,
            getSelectedChatList: () => state.chatLists['group:group-1'],
            getChatCacheKey: (contextKey, chatId) => `${contextKey}::${chatId}`,
            saveGroupMetadata: async () => {},
            updateGroupMetadata: async (target, updateMetadata) => {
                attemptedMetadata = structuredClone(target);
                await updateMetadata(attemptedMetadata);
                throw new Error('metadata unavailable');
            },
            refreshSelectedChatList: async () => {
                state.chatLists['group:group-1'] = [{ file_id: 'next-chat' }];
            },
            loadChatMessages: async (...args) => loaded.push(args),
            moveChatReadState: () => {},
            deleteChatReadState: () => {},
            renameModernChatFile: (_contextKey, _chatId, operation) => operation(),
            deleteModernChatFile: (_contextKey, _chatId, operation) => operation(),
        });

        await expect(actions.confirmModernChatDelete()).rejects.toThrow('聊天文件 old-chat.jsonl 已删除，但群聊索引更新失败');

        expect(attemptedMetadata).toMatchObject({ chats: ['next-chat'], chat_id: 'next-chat' });
        expect(group).toMatchObject({ chats: ['old-chat', 'next-chat'], chat_id: 'old-chat' });
        expect(state.selected.chat).toBe('next-chat');
        expect(state.chatMessages['group:group-1::old-chat']).toBeUndefined();
        expect(state.chatDeleteConfirm).toEqual({ key: '', name: '' });
        expect(loaded).toHaveLength(1);
        expect(loaded[0][0]).toBe(group);
        expect(loaded[0][1]).toBe('next-chat');
        expect(loaded[0][2]).toMatchObject({ groupMode: true });
    });

    test('keeps the original generation context while an empty chat is being created', async () => {
        const character = { avatar: 'alice.png', name: 'Alice' };
        const group = { id: 'group-1', name: 'Group One' };
        let selectedEntity = character;
        let groupMode = false;
        let finishCreation;
        const creationReady = new Promise(resolve => {
            finishCreation = resolve;
        });
        let markCreationStarted;
        const creationStarted = new Promise(resolve => {
            markCreationStarted = resolve;
        });
        const state = {
            selected: { chat: '' },
            engine: { generating: false, checking: false, ready: false, status: '', error: '', detail: '' },
            chatDrafts: { 'alice.png::': 'hello from Alice' },
            chatMessages: {},
            chatMetadata: {},
        };
        const bridgeRequests = [];
        const actions = createChatGenerationActions({
            state,
            render: () => {},
            showToast: () => {},
            callLegacyBridge: async (action, payload) => {
                bridgeRequests.push({ action, payload });
                return { chat: payload.chat };
            },
            formatNumber: String,
            getSelectedChatEntity: () => selectedEntity,
            getChatContextKey: (entity = selectedEntity, mode = groupMode) => mode ? `group:${entity?.id || ''}` : entity?.avatar || '',
            getChatEntityName: entity => entity.name,
            isGroupChatMode: () => groupMode,
            getSelectedChatMessages: () => [],
            getCurrentDraftKey: () => `${groupMode ? `group:${selectedEntity.id}` : selectedEntity.avatar}::${state.selected.chat}`,
            getChatCacheKey: (contextKey, chatId) => `${contextKey}::${chatId}`,
            getUserName: () => 'User',
            loadChatMessages: async () => {
                throw new Error('Unexpected message load');
            },
            refreshSelectedChatList: async () => {
                throw new Error('Unexpected list refresh');
            },
            createModernChatFile: async entity => {
                expect(entity).toBe(character);
                markCreationStarted();
                await creationReady;
                return 'alice-new-chat';
            },
            runModernChatFileOperation: (_entity, _chatId, operation) => operation(),
        });

        const sending = actions.sendModernMessage();
        await creationStarted;
        groupMode = true;
        selectedEntity = group;
        state.selected.chat = 'group-chat';
        finishCreation();
        await sending;

        expect(bridgeRequests).toEqual([{
            action: 'generate',
            payload: {
                avatar: 'alice.png',
                groupId: null,
                chat: 'alice-new-chat',
                type: 'normal',
                message: 'hello from Alice',
            },
        }]);
        expect(state.selected.chat).toBe('group-chat');
        expect(state.chatDrafts['alice.png::']).toBe('');
    });

    test('keeps generation occupied after stop until the original request settles', async () => {
        const character = { avatar: 'alice.png', name: 'Alice' };
        const state = {
            selected: { chat: 'chat-one' },
            engine: { generating: false, checking: false, ready: false, status: '', error: '', detail: '' },
            errors: [],
            chatDrafts: {},
            chatMessages: { 'alice.png::chat-one': [{ mes: 'context' }] },
            chatMetadata: {},
        };
        let rejectGeneration;
        const generationBlocked = new Promise((_resolve, reject) => {
            rejectGeneration = reject;
        });
        let markGenerationStarted;
        const generationStarted = new Promise(resolve => {
            markGenerationStarted = resolve;
        });
        const bridgeActions = [];
        const actions = createChatGenerationActions({
            state,
            render: () => {},
            showToast: () => {},
            callLegacyBridge: async (action) => {
                bridgeActions.push(action);
                if (action === 'generate') {
                    markGenerationStarted();
                    return generationBlocked;
                }
                expect(action).toBe('stop');
                return { ok: true };
            },
            formatNumber: String,
            getSelectedChatEntity: () => character,
            getChatContextKey: () => character.avatar,
            getChatEntityName: entity => entity.name,
            isGroupChatMode: () => false,
            getSelectedChatMessages: () => state.chatMessages['alice.png::chat-one'],
            getCurrentDraftKey: () => 'alice.png::chat-one',
            getChatCacheKey: (contextKey, chatId) => `${contextKey}::${chatId}`,
            getUserName: () => 'User',
            loadChatMessages: async () => {},
            refreshSelectedChatList: async () => {},
            createModernChatFile: async () => 'chat-one',
            runModernChatFileOperation: (_entity, _chatId, operation) => operation(),
        });

        const generation = actions.continueModernReply();
        await generationStarted;
        await actions.stopModernGeneration();

        expect(state.engine.generating).toBe(true);
        expect(state.engine.status).toBe('停止中');
        expect(state.engine.detail).toContain('等待生成任务结束');
        await actions.continueModernReply();
        expect(bridgeActions).toEqual(['generate', 'stop']);

        rejectGeneration(new Error('生成已停止'));
        await expect(generation).rejects.toThrow('生成已停止');
        expect(state.engine.generating).toBe(false);
        expect(state.engine.status).toBe('已停止');
    });

    test('keeps a deleted worldbook removed when global settings saving fails', async () => {
        const state = {
            selected: { worldbook: 'Lore' },
            worldbooks: [{ file_id: 'Lore' }, { file_id: 'Other' }],
            worldDetails: { Lore: { entries: {} } },
            settingsBundle: { world_names: ['Lore', 'Other'] },
            settings: { world_info_settings: { world_info: { globalSelect: ['Lore'] } } },
            worldbookDeleteConfirm: { worldbookId: 'Lore' },
            worldEntryEditing: { worldbookId: 'Lore', entryKey: '1', mode: 'edit', form: {} },
            worldEntryDeleteConfirm: { worldbookId: 'Lore', entryKey: '1' },
            worldEntryBulkDeleteConfirm: { worldbookId: 'Lore' },
            worldEntryList: { worldbookId: 'Lore', query: '', sort: 'order', page: 1, selectedKeys: ['1'] },
        };
        const requests = [];
        let loadCount = 0;
        const actions = createWorldbookFileActions({
            state,
            apiFetch: async (url, options = {}) => {
                expect(url).toBe('/api/settings/save');
                requests.push({ url, body: structuredClone(options.body) });
                throw new Error('settings unavailable');
            },
            loadData: async () => {
                loadCount++;
                // Simulate a partial refresh retaining stale settings and list data.
                state.worldbooks = [{ file_id: 'Lore' }, { file_id: 'Other' }];
                state.settingsBundle.world_names = ['Lore', 'Other'];
                state.settings = { world_info_settings: { world_info: { globalSelect: ['Lore'] } } };
                state.selected.worldbook = 'Lore';
            },
            render: () => {},
            showToast: () => {},
            downloadFile: () => {},
            loadWorldDetail: async () => {},
            deleteWorldbookFile: async worldbookId => {
                requests.push({ url: '/api/worldinfo/delete', body: { name: worldbookId } });
                return { ok: true };
            },
            ensureWorldbookFileWriteAllowed: () => {},
            restoreWorldbookFile: () => {},
            getGlobalWorldNames: () => state.settings.world_info_settings?.world_info?.globalSelect || [],
        });

        await expect(actions.confirmWorldbookDelete()).rejects.toThrow('世界书 Lore.json 已删除，但全局启用设置保存失败');

        expect(requests.map(request => request.url)).toEqual(['/api/worldinfo/delete', '/api/settings/save']);
        expect(requests[1].body.world_info_settings.world_info.globalSelect).toEqual([]);
        expect(loadCount).toBe(1);
        expect(state.worldbooks).toEqual([{ file_id: 'Other' }]);
        expect(state.settingsBundle.world_names).toEqual(['Other']);
        expect(state.settings.world_info_settings.world_info.globalSelect).toEqual([]);
        expect(state.selected.worldbook).not.toBe('Lore');
        expect(state.worldbookDeleteConfirm).toEqual({ worldbookId: '' });
        expect(state.worldEntryEditing).toEqual({ worldbookId: '', entryKey: '', mode: '', form: {} });
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
            ensureWorldbookFileWriteAllowed: () => {},
            restoreWorldbookFile: () => {},
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

    test('confirms and retries a remote worldbook import after a server conflict', async () => {
        const importedBodies = [];
        const confirmations = [];
        const checkedWorldbooks = [];
        const restoredWorldbooks = [];
        const sanitizedFileNames = [];
        const state = {
            selected: { worldbook: '' },
            worldbooks: [],
            settingsBundle: { world_names: [] },
            worldDetails: { Lore: { entries: { old: {} } } },
            remoteResources: {
                results: [{
                    providerId: 'fixture-provider',
                    providerName: 'Fixture Provider',
                    id: 'remote-lore',
                    resourceType: 'worldbook',
                    title: 'Lore',
                    sourceUrl: 'https://example.invalid/remote-lore',
                    metadata: {},
                }],
                records: [],
                operation: { key: '', running: false },
            },
        };
        const actions = createRemoteResourceActions({
            state,
            apiFetch: async (url, options = {}) => {
                if (url === '/api/files/sanitize-filename') {
                    sanitizedFileNames.push(options.body.fileName);
                    return { fileName: 'Lore.json' };
                }
                if (url === '/api/worldinfo/import') {
                    importedBodies.push(options.body);
                    if (importedBodies.length === 1) {
                        const error = new Error('conflict');
                        error.status = 409;
                        throw error;
                    }
                    return { name: 'Lore' };
                }
                if (url === '/api/remote-resources/records') {
                    return { id: 'record-lore', ...options.body };
                }
                throw new Error(`Unexpected URL ${url}`);
            },
            apiFetchResponse: async () => new Response(JSON.stringify({ entries: {} }), {
                headers: { 'content-disposition': 'attachment; filename="Lore.json"' },
            }),
            loadData: async () => {},
            render: () => {},
            showToast: () => {},
            callLegacyBridge: async () => {},
            loadWorldDetail: async () => {},
            ensureWorldbookFileWriteAllowed: worldbookId => checkedWorldbooks.push(worldbookId),
            restoreWorldbookFile: worldbookId => restoredWorldbooks.push(worldbookId),
            confirmAction: message => {
                confirmations.push(message);
                return true;
            },
        });

        await actions.importRemoteResource(0);

        expect(confirmations).toEqual(['同名世界书“Lore”已存在，继续导入将覆盖现有内容。是否继续？']);
        expect(importedBodies).toHaveLength(2);
        expect(importedBodies[0].has('overwrite')).toBe(false);
        expect(importedBodies[1].get('overwrite')).toBe('true');
        expect(sanitizedFileNames).toEqual(['Lore.json']);
        expect(checkedWorldbooks).toEqual(['Lore', 'Lore']);
        expect(restoredWorldbooks).toEqual(['Lore']);
        expect(state.selected.worldbook).toBe('Lore');
        expect(state.worldDetails.Lore).toBeUndefined();
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

    test('restores a backup to the captured chat context after the selection changes', async () => {
        const alice = { avatar: 'alice.png', name: 'Alice' };
        const bob = { avatar: 'bob.png', name: 'Bob' };
        let selectedEntity = alice;
        let finishDownload;
        const downloadReady = new Promise(resolve => {
            finishDownload = resolve;
        });
        const imports = [];
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
        const helpers = createChatBackupActions({
            state,
            apiFetch: async () => ({}),
            apiFetchResponse: async () => {
                await downloadReady;
                return new Response('{}');
            },
            render: () => {},
            showToast: () => {},
            formatDate: String,
            getChatContextKey: entity => entity?.avatar || '',
            getChatEntityName: entity => entity.name,
            getSelectedChatEntity: () => selectedEntity,
            importModernChatFiles: async (files, target) => imports.push({ files, target }),
            isGroupChatMode: () => false,
            sortChats,
        });

        const restoring = helpers.restoreChatBackup('backup.jsonl');
        selectedEntity = bob;
        finishDownload();

        await restoring;
        expect(imports).toHaveLength(1);
        expect(imports[0].files[0].name).toBe('backup.jsonl');
        expect(imports[0].target).toEqual({ entity: alice, entityName: 'Alice', groupMode: false, contextKey: 'alice.png' });
        expect(state.chatBackups.restoring).toBe('');
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
