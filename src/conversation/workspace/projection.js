import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { read as readCard } from '../../character-card-parser.js';
import { ProtocolError } from '../../../public/shared/conversation/schemas/index.js';
import { CHAT_PROVIDERS } from '../capabilities/chat/index.js';

const MAX_FILE = 16 * 1024 * 1024;
// Samplers the original request sends per source (public/scripts/openai.js createGenerationParameters); DeepSeek never receives seed.
const SAMPLERS = ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty'];
const SOURCE_SAMPLERS = { custom: [...SAMPLERS, 'seed'], openai: [...SAMPLERS, 'seed'], deepseek: SAMPLERS };
const REQUEST_FIELDS = new Set(['schemaVersion', 'title', 'characterId', 'personaId', 'presetId', 'worldbookIds', 'chatWorldbookId', 'executor']);
export function unsupported(...fields) { throw new ProtocolError('workspace-unsupported', 'Selected workspace settings cannot be represented by this Agent adapter', 422, { fields }); }
function check(ok, field) { if (!ok) unsupported(field); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function identifier(value, field) {
    check(typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\\/\x00-\x1f]/u.test(value) && !['.', '..', '__proto__', 'constructor', 'prototype'].includes(value), field);
    return value;
}
function text(value, field) {
    check(value === undefined || typeof value === 'string', field);
    const result = (value ?? '').replace(/\{\{charIfNotGroup\}\}/gi, '{{char}}');
    check(result.length <= 100000 && !/\{\{(?!\s*(?:char|user|scenario|type)\s*\}\})/u.test(result), `${field}.macros`);
    return result;
}
function inactive(value) { return value == null || value === false || value === '' || value === 0 || Array.isArray(value) && value.length === 0; }
function rejectActive(source, fields, prefix) { for (const field of fields) if (!inactive(source?.[field])) unsupported(`${prefix}.${field}`); }

/** Reads only server-owned user directories. Never opens a client-supplied path. */
function reader(directories) {
    let remaining = 64 * 1024 * 1024;
    return async (directoryKey, name, { optional = false, png = false, limit = MAX_FILE } = {}) => {
        check(typeof directories[directoryKey] === 'string', `directories.${directoryKey}`);
        identifier(name, 'resourceId');
        const directory = await realpath(directories[directoryKey]);
        const filename = resolve(directory, name);
        check(dirname(filename) === directory, 'resourceId');
        let handle;
        try {
            handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
            const stat = await handle.stat();
            check(stat.isFile() && stat.size <= limit && stat.size <= remaining, 'resource.size');
            // A concurrent grow cannot turn the bounded read into an unbounded allocation.
            const bytes = Buffer.alloc(Math.min(limit, remaining) + 1);
            let count = 0;
            while (count < bytes.length) {
                const part = await handle.read(bytes, count, bytes.length - count, null);
                if (!part.bytesRead) break;
                count += part.bytesRead;
            }
            check(count <= limit && count <= remaining, 'resource.size'); remaining -= count;
            const raw = png ? readCard(bytes.subarray(0, count)) : bytes.subarray(0, count).toString('utf8');
            check(Buffer.byteLength(raw, 'utf8') <= limit, 'resource.size');
            const value = JSON.parse(raw);
            check(object(value), 'resource.format');
            return value;
        } catch (error) {
            if (optional && error.code === 'ENOENT') return {};
            if (error instanceof ProtocolError) throw error;
            throw new ProtocolError('workspace-resource-unavailable', 'Selected workspace resource is missing, unreadable or invalid', 422);
        } finally { await handle?.close(); }
    };
}

function connection(settings, secrets, executor = 'pi') {
    check(['pi', 'claude', 'codex'].includes(executor), 'executor');
    check(settings.main_api === 'openai', 'main_api');
    const o = settings.oai_settings;
    check(object(o), 'oai_settings');
    const providers = {
        custom: ['openai-compatible', 'custom_model', 'custom_url', 'api_key_custom'],
        openai: ['openai', 'openai_model', 'https://api.openai.com/v1', 'api_key_openai'],
        deepseek: ['deepseek', 'deepseek_model', 'https://api.deepseek.com', 'api_key_deepseek'],
    };
    const mapping = Object.hasOwn(providers, o.chat_completion_source) ? providers[o.chat_completion_source] : undefined;
    check(mapping, 'oai_settings.chat_completion_source');
    rejectActive(o, ['reverse_proxy', 'custom_include_body', 'custom_exclude_body', 'custom_include_headers', 'assistant_prefill', 'assistant_impersonation', 'squash_system_messages', 'top_a_openai'], 'oai_settings');
    check(inactive(o.reasoning_effort) || ['auto', 'off'].includes(o.reasoning_effort), 'oai_settings.reasoning_effort');
    const [provider, modelKey, address, secretKey] = mapping;
    const model = o[modelKey];
    check(typeof model === 'string' && model.trim(), `oai_settings.${modelKey}`);
    const baseUrl = provider === 'openai-compatible' ? o[address] : address;
    let url;
    try { url = new URL(baseUrl); } catch { unsupported('oai_settings.baseUrl'); }
    check(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash, 'oai_settings.baseUrl');
    const contextWindow = o.openai_max_context, maxOutputTokens = o.openai_max_tokens;
    check([contextWindow, maxOutputTokens].every(n => Number.isSafeInteger(n) && n > 0) && contextWindow > maxOutputTokens + 256, 'oai_settings.budgets');
    const active = secrets[secretKey];
    check(active === undefined || Array.isArray(active), 'secrets.format');
    const keys = active?.filter(item => item.active === true) ?? [];
    check(keys.length <= 1 && keys.every(item => typeof item.value === 'string'), 'secrets.active');
    const parameters = {};
    // PI sends samplers as-is, so keep only those the source sent originally and the target provider profile accepts.
    const samplers = executor === 'pi' ? SOURCE_SAMPLERS[o.chat_completion_source].filter(key => CHAT_PROVIDERS[provider]?.parameters.includes(key)) : undefined;
    for (const [old, key] of Object.entries({ temp_openai: 'temperature', top_p_openai: 'top_p', freq_pen_openai: 'frequency_penalty', pres_pen_openai: 'presence_penalty', top_k_openai: 'top_k', min_p_openai: 'min_p', repetition_penalty_openai: 'repetition_penalty', seed: 'seed' })) {
        if (o[old] === undefined || key === 'seed' && o[old] === -1 || samplers && !samplers.includes(key)) continue;
        check(Number.isFinite(o[old]), `oai_settings.${old}`); parameters[key] = o[old];
    }
    let targetProvider = provider;
    if (executor !== 'pi') {
        const deepseek = url.hostname === 'api.deepseek.com';
        check(deepseek || executor === 'codex' && provider === 'openai', 'executor.provider-protocol');
        for (const [key, value] of Object.entries(parameters)) {
            const neutral = { temperature: 1, top_p: 1, frequency_penalty: 0, presence_penalty: 0, top_k: 0, min_p: 0, repetition_penalty: 1 };
            check(Object.hasOwn(neutral, key) && value === neutral[key], `executor.parameters.${key}`);
            delete parameters[key];
        }
        if (deepseek) {
            check(['', '/', '/v1', '/v1/'].includes(url.pathname), 'executor.provider-path');
            url.pathname = executor === 'claude' ? '/anthropic' : '/';
        }
        targetProvider = executor === 'claude' ? 'anthropic' : 'openai-compatible';
    }
    return { provider: targetProvider, executor, type: 'chat', historyMode: 'native-transcript', model, baseUrl: url.href.replace(/\/$/, ''), apiKey: keys[0]?.value ?? '',
        contextWindow, inputLimit: contextWindow, outputLimit: maxOutputTokens, maxOutputTokens,
        workingBudget: Math.min(65536, contextWindow - maxOutputTokens - Math.max(256, Math.ceil(contextWindow * 0.02))), parameters,
        ...(o.reasoning_effort === 'off' ? { reasoningEnabled: false, reasoning: 'off' } : {}) };
}

function persona(settings, selected, characterId) {
    const power = settings.power_user ?? {}, descriptions = power.persona_descriptions ?? {};
    const generic = () => ({ name: settings.username || 'User', data: { description: text(power.persona_description, 'persona.description') } });
    if (selected === null) return null;
    let id = selected;
    let bound = selected !== undefined;
    if (id === undefined) {
        const connected = Object.entries(descriptions).filter(([, value]) => value.connections?.some(c => c.type === 'character' && c.id === characterId)).map(([key]) => key);
        check(connected.length < 2, 'personaId.multiple-character-connections');
        bound = Boolean(connected[0] || power.default_persona);
        id = connected[0] || power.default_persona || settings.user_avatar;
    }
    if (!id) return generic();
    identifier(id, 'personaId');
    const descriptor = descriptions[id];
    if (!bound && !Object.hasOwn(descriptions, id) && !Object.hasOwn(power.personas ?? {}, id)) return generic();
    check(object(descriptor), 'personaId');
    check([undefined, 0, 1, 4, 9].includes(descriptor.position), 'persona.position');
    const description = text(descriptor.description, 'persona.description');
    const role = ['system', 'user', 'assistant'][descriptor.role ?? 0];
    check(role, 'persona.role');
    return { id, name: power.personas?.[id] || settings.username || 'User', data: { description: descriptor.position === 9 || descriptor.position === 4 ? '' : description },
        ...(descriptor.position === 4 && description ? { block: { id: 'workspace-persona', content: description, role, layer: 'L5', placement: { type: 'depth', depth: descriptor.depth ?? 2 }, required: true } } : {}), lorebook: descriptor.lorebook };
}

function preset(source, character, person, power) {
    const blocks = [];
    for (const [key, standard] of [['wi_format', '{0}'], ['scenario_format', '{{scenario}}'], ['personality_format', '{{personality}}']]) check(source[key] === undefined || source[key] === standard, `preset.${key}`);
    const markers = new Set(['charDescription', 'charPersonality', 'scenario', 'personaDescription', 'dialogueExamples', 'chatHistory', 'worldInfoBefore', 'worldInfoAfter']);
    check(Array.isArray(source.prompts ?? []), 'preset.prompts');
    const orders = source.prompt_order ?? [];
    check(Array.isArray(orders), 'preset.prompt_order');
    const activeOrder = orders.some(item => String(item.character_id) === '100001')
        ? orders.filter(item => String(item.character_id) === '100001')
        : orders.filter(item => String(item.character_id) === '100000');
    check(activeOrder.length <= 1 && (orders.length === 0 || activeOrder.length === 1), 'preset.prompt_order');
    const defaultOrder = ['main', 'worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality', 'scenario', 'nsfw', 'worldInfoAfter', 'dialogueExamples', 'chatHistory', 'jailbreak'];
    const order = activeOrder[0]?.order ?? defaultOrder.map(identifier => ({ identifier, enabled: true }));
    check(Array.isArray(order), 'preset.prompt_order');
    const enabled = new Set(order.filter(item => item.enabled).map(item => item.identifier));
    for (const [id, content] of [['charDescription', character.description], ['charPersonality', character.personality], ['scenario', character.scenario], ['personaDescription', person?.data.description]]) {
        check(!content || enabled.has(id), `preset.disabled.${id}`);
    }
    for (const prompt of source.prompts ?? []) if (prompt.marker) check(markers.has(prompt.identifier), 'preset.marker');
    for (const [index, item] of order.entries()) {
        if (!item.enabled || markers.has(item.identifier)) continue;
        const prompt = (source.prompts ?? []).find(p => p.identifier === item.identifier);
        if (!prompt) continue;
        const override = !prompt.forbid_overrides && (item.identifier === 'main' && power.prefer_character_prompt !== false ? character.system_prompt
            : item.identifier === 'jailbreak' && power.prefer_character_jailbreak !== false ? character.post_history_instructions : '');
        const content = text(override || prompt.content, 'preset.prompt.content');
        if (!content) continue;
        check(['system', 'user', 'assistant'].includes(prompt.role ?? 'system'), 'preset.prompt.role');
        check([undefined, 0, 1].includes(prompt.injection_position), 'preset.prompt.position');
        rejectActive(prompt, ['injection_trigger'], 'preset.prompt');
        blocks.push({ id: `workspace-prompt-${index}`, layer: 'L1', role: prompt.role ?? 'system', content,
            placement: prompt.injection_position === 1 ? { type: 'depth', depth: prompt.injection_depth ?? 0 }
                : item.identifier === 'jailbreak' ? { type: 'tail' } : { type: 'prefix' }, priority: 1000 - index, required: true });
    }
    if (person?.block) blocks.push(person.block);
    if (character.extensions?.depth_prompt?.prompt) {
        const depth = character.extensions.depth_prompt;
        check(['system', 'user', 'assistant'].includes(depth.role ?? 'system'), 'character.depth_prompt.role');
        blocks.push({ id: 'workspace-character-depth', layer: 'L5', role: depth.role ?? 'system', content: text(depth.prompt, 'character.depth_prompt'), placement: { type: 'depth', depth: depth.depth ?? 4 }, required: true });
    }
    if (character.mes_example?.trim() && enabled.has('dialogueExamples')) blocks.push({ id: 'workspace-examples', layer: 'L1', role: 'system', content: text(character.mes_example, 'character.mes_example'), placement: { type: 'prefix' }, priority: -100, required: true });
    return { mode: 'chat', blocks, system: '' };
}

function worldbook(raw, settings) {
    const global = settings.world_info_settings ?? {};
    rejectActive(global, ['world_info_min_activations', 'world_info_use_group_scoring'], 'world_info_settings');
    const entries = raw.entries;
    check(object(entries) || Array.isArray(entries), 'worldbook.entries');
    check(Object.keys(entries).length <= 2000, 'worldbook.entries.limit');
    const converted = Object.entries(entries).map(([id, entry]) => {
        check(object(entry), 'worldbook.entry');
        if (entry.disable === true || entry.enabled === false) return { id, enabled: false, content: text(entry.content, 'worldbook.content') };
        const x = entry.extensions ?? entry;
        rejectActive(x, ['vectorized', 'group', 'delay', 'sticky', 'cooldown', 'excludeRecursion', 'preventRecursion', 'useGroupScoring', 'matchPersonaDescription', 'matchCharacterDescription', 'matchCharacterPersonality', 'matchCharacterDepthPrompt', 'matchScenario', 'matchCreatorNotes', 'outletName', 'triggers'], 'worldbook.entry');
        check(!x.characterFilter?.names?.length && !x.characterFilter?.tags?.length, 'worldbook.characterFilter');
        check(entry.use_regex !== true, 'worldbook.entry.use_regex');
        const keys = entry.key ?? entry.keys ?? [], secondaryKeys = entry.keysecondary ?? entry.secondary_keys ?? [];
        check(Array.isArray(keys) && Array.isArray(secondaryKeys) && [...keys, ...secondaryKeys].every(k => typeof k === 'string' && k && !/^\/.*\/[a-z]*$/i.test(k)), 'worldbook.keys');
        const position = x.position ?? entry.position ?? 0;
        check([0, 1, 4, 'before_char', 'after_char'].includes(position), 'worldbook.position');
        const logic = x.selectiveLogic ?? 0;
        check([0, 2, 3].includes(logic), 'worldbook.secondaryLogic');
        return { id, enabled: true, content: text(entry.content, 'worldbook.content'), keys, secondaryKeys: entry.selective === false ? [] : secondaryKeys,
            secondaryMode: { 0: 'any', 2: 'none', 3: 'all' }[logic], constant: entry.constant === true,
            matchWholeWords: x.matchWholeWords ?? global.world_info_match_whole_words ?? false,
            recursive: global.world_info_recursive === true, caseSensitive: x.caseSensitive ?? global.world_info_case_sensitive ?? false,
            probability: x.useProbability === false ? 100 : x.probability ?? 100, priority: entry.order ?? entry.insertion_order ?? 0,
            role: ['system', 'user', 'assistant'][x.role ?? 0], placement: position === 4 ? { type: 'depth', depth: x.depth ?? 4 } : { type: 'prefix' } };
    });
    return { entries: converted, scanDepth: global.world_info_depth ?? 2, maxRecursion: global.world_info_recursive ? 4 : 0 };
}

export async function projectWorkspace(directories, body) {
    check(object(body), 'request');
    check(Object.keys(body).every(key => REQUEST_FIELDS.has(key)), 'request.fields');
    const read = reader(directories);
    const settings = await read('root', 'settings.json');
    const characterId = identifier(body.characterId ?? settings.active_character, 'characterId');
    check(characterId.endsWith('.png'), 'characterId');
    const card = await read('characters', characterId, { png: true });
    const character = card.data ?? card;
    check(object(character) && typeof character.name === 'string' && character.name.trim(), 'character');
    check(!(character.extensions?.regex_scripts ?? []).some(rule => rule.disabled !== true), 'character.extensions.regex_scripts');
    check(!(settings.extension_settings?.regex ?? []).some(rule => rule.disabled !== true), 'extension_settings.regex');
    const person = persona(settings, body.personaId, characterId);
    const o = settings.oai_settings ?? {};
    const selectedPreset = body.presetId === undefined ? o : await read('openAI_Settings', `${identifier(body.presetId, 'presetId')}.json`);
    const presetData = preset(selectedPreset, character, person, settings.power_user ?? {});
    const globals = settings.world_info_settings?.world_info?.globalSelect ?? [];
    check(Array.isArray(globals), 'world_info.globalSelect');
    const names = [...globals];
    check(Array.isArray(body.worldbookIds ?? []), 'worldbookIds');
    names.push(...(body.worldbookIds ?? []));
    for (const name of [character.extensions?.world, person?.lorebook, body.chatWorldbookId]) if (name) names.push(name);
    const extras = settings.world_info_settings?.world_info?.charLore?.filter(item => item.name === characterId.replace(/\.png$/, '')) ?? [];
    for (const item of extras) names.push(...(item.extraBooks ?? []));
    check(names.length <= 32, 'worldbookIds.limit');
    const books = [];
    for (const name of new Set(names)) books.push({ kind: 'worldbook', name: identifier(name, 'worldbookId'), data: worldbook(await read('worlds', `${name}.json`), settings) });
    // Like the original engine, an embedded character_book is inactive until imported as a linked world.
    // Saving a card with a linked world rewrites character_book from that world with use_regex: true.
    const secrets = await read('root', 'secrets.json', { optional: true, limit: 1024 * 1024 });
    const resources = [
        { kind: 'connection', name: 'Workspace connection', data: connection(settings, secrets, body.executor) },
        { kind: 'character', name: character.name, data: Object.fromEntries(['description', 'personality', 'scenario'].map(key => [key, text(character[key], `character.${key}`)])) },
        { kind: 'preset', name: body.presetId ?? o.preset_settings_openai ?? 'Current workspace preset', data: presetData },
        ...(person ? [{ kind: 'persona', name: person.name, data: person.data }] : []), ...books,
    ];
    check(body.title === undefined || typeof body.title === 'string' && body.title.length > 0 && body.title.length <= 256, 'title');
    // Shown as-is by the Modern chat page.
    return { resources, title: body.title ?? `Agent · ${character.name}`, notices: [
        '已新建一个历史为空的 Agent 会话，没有修改或导入任何原聊天、开场白和设置。',
        '所选资源的文本和示例按 Agent 的上下文块、令牌预算和普通关键词世界书匹配使用，不执行原提示词排版和插件。',
        ...(body.executor && body.executor !== 'pi' ? ['所选执行器使用自身的原生协议和默认采样参数，失败时不会自动换用其他执行器。'] : []),
    ] };
}
