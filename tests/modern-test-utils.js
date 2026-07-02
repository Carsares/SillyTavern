import { expect } from '@playwright/test';

function createDefaultCharacters() {
    return [
        {
            avatar: 'alice.png',
            name: 'Alice Fixture',
            description: 'Alice visible description.',
            data: {
                name: 'Alice Fixture',
                description: 'Alice visible description.',
                personality: 'Helpful',
                scenario: 'Modern fixture scenario',
                first_mes: 'Hello from Alice.',
                creator: 'Modern E2E',
                tags: ['fixture', 'alice'],
                extensions: {
                    world: 'ModernLore',
                    talkativeness: 0.5,
                    fav: false,
                    depth_prompt: {
                        prompt: '',
                        depth: 4,
                        role: 'system',
                    },
                },
            },
        },
        {
            avatar: 'bruno.png',
            name: 'Bruno Fixture',
            description: 'Bruno visible description.',
            data: {
                name: 'Bruno Fixture',
                description: 'Bruno visible description.',
                personality: 'Direct',
                scenario: 'Second fixture scenario',
                first_mes: 'Hello from Bruno.',
                creator: 'Modern E2E',
                tags: ['fixture', 'bruno'],
                extensions: {
                    world: '',
                    talkativeness: 0.4,
                    fav: true,
                    depth_prompt: {
                        prompt: '',
                        depth: 4,
                        role: 'system',
                    },
                },
            },
        },
    ];
}

function createDefaultGroups() {
    return [
        {
            id: 'group-alpha',
            name: 'Alpha Group',
            avatar_url: '',
            members: ['alice.png', 'bruno.png'],
            chats: ['alpha-chat.jsonl'],
            chat_size: 2048,
            allow_self_responses: false,
            activation_strategy: 0,
            generation_mode: 0,
            auto_mode_delay: 5,
            fav: false,
        },
        {
            id: 'group-beta',
            name: 'Beta Group',
            avatar_url: '',
            members: ['bruno.png'],
            chats: [],
            chat_size: 0,
            allow_self_responses: true,
            activation_strategy: 1,
            generation_mode: 0,
            auto_mode_delay: 3,
            fav: true,
        },
    ];
}

function createDefaultSettings() {
    return {
        power_user: {
            personas: {
                'persona-alpha.png': 'Alpha Persona',
                'persona-beta.png': 'Beta Persona',
            },
            persona_descriptions: {
                'persona-alpha.png': {
                    title: 'Primary identity',
                    description: 'Default modern persona.',
                },
                'persona-beta.png': {
                    title: 'Backup identity',
                    description: 'Secondary modern persona.',
                },
            },
            default_persona: 'persona-alpha.png',
        },
    };
}

function createRequestsLog() {
    return {
        characterCreate: [],
        characterMerge: [],
        characterDelete: [],
        groupCreate: [],
        groupEdit: [],
        groupDelete: [],
        settingsSave: [],
        avatarDelete: [],
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function characterDetailMap(characters, overrides = {}) {
    return {
        ...Object.fromEntries(characters.map(character => [character.avatar, clone(character)])),
        ...clone(overrides),
    };
}

function modernSlug(value, fallback) {
    const slug = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug || fallback;
}

function characterFromCreatePayload(payload, avatar) {
    return {
        avatar,
        name: payload.ch_name,
        description: payload.description || '',
        data: {
            name: payload.ch_name,
            description: payload.description || '',
            personality: payload.personality || '',
            scenario: payload.scenario || '',
            first_mes: payload.first_mes || '',
            mes_example: payload.mes_example || '',
            creator_notes: payload.creator_notes || '',
            system_prompt: payload.system_prompt || '',
            post_history_instructions: payload.post_history_instructions || '',
            alternate_greetings: payload.alternate_greetings || [],
            tags: payload.tags || [],
            creator: payload.creator || '',
            character_version: payload.character_version || '',
            extensions: {
                world: payload.world || '',
                talkativeness: payload.talkativeness,
                fav: payload.fav === 'true',
                depth_prompt: {
                    prompt: payload.depth_prompt_prompt || '',
                    depth: payload.depth_prompt_depth,
                    role: payload.depth_prompt_role || 'system',
                },
            },
        },
    };
}

function updateCharacter(fixture, avatar, character) {
    fixture.characterDetails[avatar] = clone(character);
    fixture.characters = fixture.characters.map(item => item.avatar === avatar ? clone(character) : item);
    if (!fixture.characters.some(item => item.avatar === avatar)) {
        fixture.characters.push(clone(character));
    }
}

function settingsBundle(fixture) {
    return {
        settings: JSON.stringify(fixture.settings),
        world_names: ['ModernLore'],
        openai_setting_names: [],
        openai_settings: [],
        textgenerationwebui_preset_names: [],
        textgenerationwebui_presets: [],
        ...fixture.settingsBundle,
    };
}

function postJson(route) {
    try {
        return route.request().postDataJSON();
    } catch {
        return {};
    }
}

function fulfillJson(route, body, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

export function createModernResourceFixture(overrides = {}) {
    const characters = clone(overrides.characters || createDefaultCharacters());
    const groups = clone(overrides.groups || createDefaultGroups());

    return {
        requests: createRequestsLog(),
        me: clone(overrides.me || { name: 'Modern E2E User' }),
        settings: clone(overrides.settings || createDefaultSettings()),
        settingsBundle: clone(overrides.settingsBundle || {}),
        characters,
        characterDetails: characterDetailMap(characters, overrides.characterDetails || {}),
        groups,
        worldbooks: clone(overrides.worldbooks || [{ file_id: 'ModernLore', name: 'ModernLore' }]),
        backgrounds: clone(overrides.backgrounds || { images: [] }),
        backgroundFolders: clone(overrides.backgroundFolders || { folders: [], imageFolderMap: {} }),
        assets: clone(overrides.assets || {}),
        extensions: clone(overrides.extensions || []),
        secrets: clone(overrides.secrets || {}),
        secretState: clone(overrides.secretState || {}),
        stats: clone(overrides.stats || {}),
    };
}

export async function mockModernWorkspace(page, fixture = createModernResourceFixture()) {
    await page.route('**/csrf-token', route => fulfillJson(route, { token: 'modern-e2e-token' }));
    await page.route('**/api/users/me', route => fulfillJson(route, fixture.me));
    await page.route('**/api/settings/get', route => fulfillJson(route, settingsBundle(fixture)));
    await page.route('**/api/settings/save', route => {
        const payload = postJson(route);
        fixture.requests.settingsSave.push(clone(payload));
        fixture.settings = clone(payload);
        return fulfillJson(route, { ok: true });
    });
    await page.route('**/api/characters/all', route => fulfillJson(route, fixture.characters));
    await page.route('**/api/characters/get', route => {
        const payload = postJson(route);
        const avatar = payload.avatar_url || '';
        const character = fixture.characterDetails[avatar] || fixture.characters.find(item => item.avatar === avatar) || {};
        return fulfillJson(route, character);
    });
    await page.route('**/api/characters/create', route => {
        const payload = postJson(route);
        fixture.requests.characterCreate.push(clone(payload));
        const avatar = `${modernSlug(payload.ch_name, `character-${fixture.requests.characterCreate.length}`)}.png`;
        updateCharacter(fixture, avatar, characterFromCreatePayload(payload, avatar));
        return fulfillJson(route, avatar);
    });
    await page.route('**/api/characters/merge-attributes', route => {
        const payload = postJson(route);
        fixture.requests.characterMerge.push(clone(payload));
        const avatar = payload.avatar;
        const previous = fixture.characterDetails[avatar] || fixture.characters.find(item => item.avatar === avatar) || {};
        updateCharacter(fixture, avatar, {
            ...previous,
            ...payload,
            avatar,
            name: payload.name || previous.name,
            description: payload.description || previous.description || '',
            data: payload.data || previous.data || {},
        });
        return fulfillJson(route, { ok: true });
    });
    await page.route('**/api/characters/delete', route => {
        const payload = postJson(route);
        fixture.requests.characterDelete.push(clone(payload));
        const avatar = payload.avatar_url;
        fixture.characters = fixture.characters.filter(item => item.avatar !== avatar);
        delete fixture.characterDetails[avatar];
        return fulfillJson(route, { ok: true });
    });
    await page.route('**/api/groups/all', route => fulfillJson(route, fixture.groups));
    await page.route('**/api/groups/create', route => {
        const payload = postJson(route);
        fixture.requests.groupCreate.push(clone(payload));
        const group = {
            id: modernSlug(payload.name, `group-${fixture.requests.groupCreate.length}`),
            chats: [],
            chat_size: 0,
            ...payload,
        };
        fixture.groups.push(clone(group));
        return fulfillJson(route, group);
    });
    await page.route('**/api/groups/edit', route => {
        const payload = postJson(route);
        fixture.requests.groupEdit.push(clone(payload));
        fixture.groups = fixture.groups.map(group => group.id === payload.id ? { ...group, ...payload } : group);
        return fulfillJson(route, { ok: true });
    });
    await page.route('**/api/groups/delete', route => {
        const payload = postJson(route);
        fixture.requests.groupDelete.push(clone(payload));
        fixture.groups = fixture.groups.filter(group => group.id !== payload.id);
        return fulfillJson(route, { ok: true });
    });
    await page.route('**/api/avatars/delete', route => {
        const payload = postJson(route);
        fixture.requests.avatarDelete.push(clone(payload));
        return fulfillJson(route, { ok: true });
    });
    await page.route('**/api/worldinfo/list', route => fulfillJson(route, fixture.worldbooks));
    await page.route('**/api/backgrounds/all', route => fulfillJson(route, fixture.backgrounds));
    await page.route('**/api/backgrounds/folders', route => fulfillJson(route, fixture.backgroundFolders));
    await page.route('**/api/assets/get', route => fulfillJson(route, fixture.assets));
    await page.route('**/api/extensions/discover', route => fulfillJson(route, fixture.extensions));
    await page.route('**/api/secrets/settings', route => fulfillJson(route, fixture.secrets));
    await page.route('**/api/secrets/read', route => fulfillJson(route, fixture.secretState));
    await page.route('**/api/stats/get', route => fulfillJson(route, fixture.stats));
}

export async function gotoModern(page, view, title) {
    await page.goto(`/modern/?view=${view}`);
    await expect(page.locator('.brand-title')).toHaveText('SillyTavern');
    await expect(page.locator('.page-title')).toHaveText(title);
    await expectModernOnly(page);
}

export async function expectModernOnly(page) {
    await expect(page).toHaveURL(/\/modern\/\?view=/);
    await expect(page.locator('a[href="/"]')).toHaveCount(0);
    await expect(page.locator('[data-open-legacy]')).toHaveCount(0);
    await expect(page.locator('text=打开原版')).toHaveCount(0);
    await expect(page.locator('text=原版')).toHaveCount(0);
    await expect(page.locator('text=旧版')).toHaveCount(0);
}
