import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import encodePng from '../../../../src/png/encode.js';
import { deflateSync } from 'node:zlib';
import { write as writeCard } from '../../../../src/character-card-parser.js';
import { projectWorkspace } from '../../../../src/conversation/workspace/projection.js';
import { createWorkspaceRouter } from '../../../../src/conversation/workspace-resources.js';
import { getCapabilities } from '../../../../src/conversation/capabilities/core/index.js';

const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
const png = Buffer.from(encodePng([{ name: 'IHDR', data: header }, { name: 'IDAT', data: deflateSync(Buffer.from([0, 0, 0, 0, 255])) }, { name: 'IEND', data: Buffer.alloc(0) }]));
async function setup(t, patch = {}) {
    const root = await mkdtemp(join(tmpdir(), 'workspace-resource-unit-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const directories = { root, characters: join(root, 'characters'), worlds: join(root, 'worlds'), openAI_Settings: join(root, 'presets') };
    await Promise.all(Object.values(directories).slice(1).map(path => mkdir(path)));
    const settings = { main_api: 'openai', username: 'Reader', user_avatar: 'reader.png',
        oai_settings: { chat_completion_source: 'custom', custom_model: 'local-model', custom_url: 'http://127.0.0.1:9/v1', openai_max_context: 8192, openai_max_tokens: 512, temp_openai: 0.7,
            prompts: [{ identifier: 'main', role: 'system', content: 'Talk with {{charIfNotGroup}} and {{user}}.' }], preset_settings_openai: 'Saved current' },
        power_user: { personas: { 'reader.png': 'Reader' }, persona_descriptions: { 'reader.png': { description: 'A visitor', position: 0 } } },
        world_info_settings: { world_info: { globalSelect: ['Global'] }, world_info_depth: 2 }, ...patch };
    const card = { spec: 'chara_card_v2', data: { name: 'Role', description: 'A librarian', personality: 'Patient', scenario: 'At a library', first_mes: 'Hello!', extensions: { world: 'RoleBook' } } };
    await writeFile(join(root, 'settings.json'), JSON.stringify(settings));
    await writeFile(join(root, 'secrets.json'), JSON.stringify({ api_key_custom: [{ id: 'old', active: false, value: 'inactive-test-key' }, { id: 'current', active: true, value: 'active-test-key' }], other_secret: [{ active: true, value: 'unrelated-test-key' }] }));
    await writeFile(join(directories.characters, 'Role.png'), writeCard(png, JSON.stringify(card)));
    for (const name of ['Global', 'RoleBook', 'PersonaBook', 'ChatBook', 'ExtraBook']) await writeFile(join(directories.worlds, `${name}.json`), JSON.stringify({ entries: { 0: { key: ['library'], content: `${name} fact`, constant: true, position: 1 } } }));
    return { directories, settings, card, body: { schemaVersion: 1, characterId: 'Role.png' },
        saveSettings: () => writeFile(join(root, 'settings.json'), JSON.stringify(settings)),
        saveCard: () => writeFile(join(directories.characters, 'Role.png'), writeCard(png, JSON.stringify(card))) };
}
function services() {
    const created = [], conversations = [], deleted = [];
    return { created, conversations, deleted, capabilities: getCapabilities,
        resources: { createResource(value) { const result = { ...value, id: `new-${created.length}`, revision: 1 }; created.push(result); return result; } },
        store: { createConversation(value) { const result = { ...value, id: 'new-conversation', contentRevision: 0, memoryRevision: 0 }; conversations.push(result); return result; }, deleteResource: id => deleted.push(id) } };
}
function invoke(router, directories, body) {
    const handler = router.stack.find(layer => layer.route?.path === '/start').route.stack[0].handle;
    const errors = router.stack.at(-1).handle;
    return new Promise((resolve, reject) => {
        const response = { headersSent: false, statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { resolve({ status: this.statusCode, value }); } };
        const req = { user: { directories }, body };
        handler(req, response, error => errors(error, req, response, reject));
    });
}

test('server projection copies selected resources and only the active credential without changing source files', async t => {
    const f = await setup(t);
    const before = await Promise.all(['settings.json', 'secrets.json'].map(name => readFile(join(f.directories.root, name))));
    const p = await projectWorkspace(f.directories, f.body);
    assert.deepEqual(p.resources.map(r => r.kind), ['connection', 'character', 'preset', 'persona', 'worldbook', 'worldbook']);
    assert.equal(p.resources[0].data.apiKey, 'active-test-key');
    assert.equal(p.resources[0].data.provider, 'openai-compatible');
    assert.equal(p.resources[0].data.parameters.temperature, 0.7);
    assert.equal(p.resources[1].data.description, 'A librarian');
    assert.equal(p.resources[2].data.blocks[0].content, 'Talk with {{char}} and {{user}}.');
    assert.equal(p.resources[3].data.description, 'A visitor');
    assert.ok(!JSON.stringify(p).includes('inactive-test-key')); assert.ok(!JSON.stringify(p).includes('unrelated-test-key'));
    const after = await Promise.all(['settings.json', 'secrets.json'].map(name => readFile(join(f.directories.root, name))));
    assert.deepEqual(after, before);
});
test('router creates only new resources/conversation, no history or runtime calls and no credential response', async t => {
    const f = await setup(t), s = services();
    s.runtime = new Proxy({}, { get() { assert.fail('bootstrap must never invoke runtime'); } });
    const result = await invoke(createWorkspaceRouter(s), f.directories, f.body);
    assert.equal(result.status, 201, JSON.stringify(result));
    assert.equal(result.value.conversationId, 'new-conversation');
    assert.equal(result.value.conversation.contentRevision, 0);
    assert.equal(s.conversations[0].messages, undefined);
    assert.equal(result.value.resourceIds.characterId, 'new-1');
    assert.equal(result.value.resourceIds.worldbookIds.length, 2);
    assert.doesNotMatch(JSON.stringify(result), /active-test-key|apiKey|secrets.json/);
});
test('chat persona wins and chat worldbook is additive to global, character and persona books', async t => {
    const f = await setup(t);
    f.settings.power_user.personas['chat.png'] = 'Chat reader';
    f.settings.power_user.persona_descriptions['chat.png'] = { description: 'Chat persona', lorebook: 'PersonaBook', position: 4, depth: 2, role: 1 };
    await f.saveSettings();
    const p = await projectWorkspace(f.directories, { ...f.body, personaId: 'chat.png', chatWorldbookId: 'ChatBook', worldbookIds: ['ExtraBook', 'Global'] });
    assert.equal(p.resources.find(r => r.kind === 'persona').name, 'Chat reader');
    assert.deepEqual(new Set(p.resources.filter(r => r.kind === 'worldbook').map(r => r.name)), new Set(['Global', 'RoleBook', 'PersonaBook', 'ChatBook', 'ExtraBook']));
    assert.ok(p.resources.find(r => r.kind === 'preset').data.blocks.some(b => b.id === 'workspace-persona' && b.role === 'user' && b.placement.depth === 2));
});
test('character-connected persona precedes default and ambiguous connections require explicit choice', async t => {
    const f = await setup(t);
    f.settings.power_user.default_persona = 'reader.png';
    f.settings.power_user.personas['bound.png'] = 'Bound';
    f.settings.power_user.persona_descriptions['bound.png'] = { description: 'Bound', connections: [{ type: 'character', id: 'Role.png' }] };
    await f.saveSettings();
    assert.equal((await projectWorkspace(f.directories, f.body)).resources.find(r => r.kind === 'persona').name, 'Bound');
    f.settings.power_user.persona_descriptions['another.png'] = { description: 'Another', connections: [{ type: 'character', id: 'Role.png' }] };
    await f.saveSettings();
    await assert.rejects(projectWorkspace(f.directories, f.body), { code: 'workspace-unsupported' });
    assert.equal((await projectWorkspace(f.directories, { ...f.body, personaId: 'reader.png' })).resources.find(r => r.kind === 'persona').name, 'Reader');
});
test('unsupported provider and active unsupported semantics fail before creating any Agent data', async t => {
    for (const change of [f => { f.settings.oai_settings.chat_completion_source = 'unknown'; }, f => { f.settings.oai_settings.custom_include_body = 'private content'; }, f => { f.card.data.description = '{{unsupportedMacro}}'; }]) {
        const f = await setup(t); change(f); await f.saveSettings(); await f.saveCard();
        const s = services(), result = await invoke(createWorkspaceRouter(s), f.directories, f.body);
        assert.equal(result.status, 422); assert.equal(result.value.error.code, 'workspace-unsupported');
        assert.equal(s.created.length, 0); assert.equal(s.conversations.length, 0);
        assert.doesNotMatch(JSON.stringify(result), /private content|active-test-key/);
    }
});
test('client paths, secrets and symlink escape are rejected without source or Agent writes', async t => {
    const f = await setup(t), s = services(), router = createWorkspaceRouter(s);
    for (const body of [{ ...f.body, characterId: '../Role.png' }, { ...f.body, apiKey: 'injected' }, { ...f.body, directories: f.directories }, { ...f.body, worldbookIds: ['../secret'] }]) {
        assert.equal((await invoke(router, f.directories, body)).status, 422);
    }
    await symlink(join(f.directories.root, 'secrets.json'), join(f.directories.worlds, 'escape.json'));
    const escaped = await invoke(router, f.directories, { ...f.body, chatWorldbookId: 'escape' });
    assert.equal(escaped.status, 422); assert.doesNotMatch(JSON.stringify(escaped), /active-test-key|workspace-resource-unit-/);
    assert.equal(s.created.length, 0);
});
test('schema/auth errors and missing resource errors remain safe', async t => {
    const f = await setup(t), s = services(), router = createWorkspaceRouter(s);
    assert.equal((await invoke(router, f.directories, { ...f.body, schemaVersion: 0 })).status, 409);
    const missing = await invoke(router, f.directories, { ...f.body, characterId: 'absent.png' });
    assert.equal(missing.status, 422); assert.doesNotMatch(JSON.stringify(missing), /workspace-resource-unit-/);
    let status;
    router.stack[0].handle({}, { setHeader() {}, status(code) { status = code; return this; }, json() {} }, () => assert.fail('unauthenticated request passed'));
    assert.equal(status, 401); assert.equal(s.created.length, 0);
});
test('current edited preset is used by default, explicit named preset is read only from preset directory', async t => {
    const f = await setup(t);
    await writeFile(join(f.directories.openAI_Settings, 'Named.json'), JSON.stringify({ prompts: [{ identifier: 'main', role: 'system', content: 'Named preset instruction' }] }));
    const p = await projectWorkspace(f.directories, { ...f.body, presetId: 'Named' });
    assert.equal(p.resources.find(r => r.kind === 'preset').data.blocks[0].content, 'Named preset instruction');
    const current = await projectWorkspace(f.directories, f.body);
    assert.equal(current.resources.find(r => r.kind === 'preset').name, 'Saved current');
});
test('failed new-store creation cleans up only resources allocated by this request', async t => {
    const f = await setup(t), s = services();
    s.store.createConversation = () => { throw new Error('private path/key'); };
    const result = await invoke(createWorkspaceRouter(s), f.directories, f.body);
    assert.equal(result.status, 500);
    assert.equal(s.deleted.length, s.created.length);
    assert.ok(s.deleted.every(id => id.startsWith('new-')));
    assert.doesNotMatch(JSON.stringify(result), /private path\/key|active-test-key/);
});

test('ordinary card examples and chat completion global 100001 prompt order remain usable', async t => {
    const f = await setup(t);
    f.card.data.mes_example = '<START>\n{{user}}: Hello\n{{char}}: Welcome';
    f.settings.oai_settings.prompt_order = [{ character_id: 100000, order: [] }, { character_id: 100001, order: [
        ...['main', 'personaDescription', 'charDescription', 'charPersonality', 'scenario', 'dialogueExamples', 'chatHistory'].map(identifier => ({ identifier, enabled: true })),
    ] }];
    await f.saveCard(); await f.saveSettings();
    const s = services(), result = await invoke(createWorkspaceRouter(s), f.directories, f.body);
    assert.equal(result.status, 201, JSON.stringify(result));
    const block = s.created.find(r => r.kind === 'preset').data.blocks.find(b => b.id === 'workspace-examples');
    assert.equal(block.required, true); assert.equal(block.content, f.card.data.mes_example);
});
test('all executor selections use explicit supported upstream protocol mappings with no paid calls', async t => {
    const f = await setup(t);
    f.settings.oai_settings.custom_url = 'https://api.deepseek.com';
    f.settings.oai_settings.temp_openai = 1;
    await f.saveSettings();
    for (const executor of ['pi', 'claude', 'codex']) {
        const p = await projectWorkspace(f.directories, { ...f.body, executor });
        const c = p.resources[0].data;
        assert.equal(c.executor, executor);
        assert.equal(c.baseUrl, executor === 'claude' ? 'https://api.deepseek.com/anthropic' : 'https://api.deepseek.com');
        assert.equal(c.historyMode, 'native-transcript');
        assert.equal(c.apiKey, 'active-test-key');
        if (executor !== 'pi') assert.deepEqual(c.parameters, {});
    }
    f.settings.oai_settings.temp_openai = 0.7; await f.saveSettings();
    await assert.rejects(projectWorkspace(f.directories, { ...f.body, executor: 'claude' }), error => error.details.fields.includes('executor.parameters.temperature'));
    f.settings.oai_settings.temp_openai = 1; f.settings.oai_settings.custom_url = 'https://unknown.invalid'; await f.saveSettings();
    await assert.rejects(projectWorkspace(f.directories, { ...f.body, executor: 'codex' }), error => error.details.fields.includes('executor.provider-protocol'));
});
test('unsupported actual service capability blocks creation rather than silently changing executor', async t => {
    const f = await setup(t);
    f.settings.oai_settings.custom_url = 'https://api.deepseek.com'; f.settings.oai_settings.temp_openai = 1; await f.saveSettings();
    const s = services(); let requested;
    s.capabilities = c => { requested = c.executor; return { supported: false, reason: 'unsupported-isolation-platform' }; };
    const result = await invoke(createWorkspaceRouter(s), f.directories, { ...f.body, executor: 'claude' });
    assert.equal(requested, 'claude'); assert.equal(result.status, 422); assert.equal(s.created.length, 0);
    assert.deepEqual(result.value.error.details.fields, ['connection.capabilities']);
});
test('worldbook secondary NOT_ANY is mapped and nonrepresentable NOT_ALL is explicitly rejected', async t => {
    const f = await setup(t), filename = join(f.directories.worlds, 'Global.json');
    const entry = { key: ['library'], keysecondary: ['closed', 'night'], selectiveLogic: 2, content: 'Open library', characterFilter: { names: [], tags: [], isExclude: false } };
    await writeFile(filename, JSON.stringify({ entries: { 0: entry } }));
    const p = await projectWorkspace(f.directories, f.body);
    assert.equal(p.resources.find(r => r.name === 'Global').data.entries[0].secondaryMode, 'none');
    entry.selectiveLogic = 1; await writeFile(filename, JSON.stringify({ entries: { 0: entry } }));
    await assert.rejects(projectWorkspace(f.directories, f.body), error => error.details.fields.includes('worldbook.secondaryLogic'));
});
test('two authenticated directories cannot share settings or credentials', async t => {
    const a = await setup(t), b = await setup(t);
    await writeFile(join(b.directories.root, 'secrets.json'), JSON.stringify({ api_key_custom: [{ active: true, value: 'second-user-key' }] }));
    b.settings.username = 'Other'; await b.saveSettings();
    const [pa, pb] = await Promise.all([projectWorkspace(a.directories, a.body), projectWorkspace(b.directories, b.body)]);
    assert.equal(pa.resources[0].data.apiKey, 'active-test-key');
    assert.equal(pb.resources[0].data.apiKey, 'second-user-key');
});
