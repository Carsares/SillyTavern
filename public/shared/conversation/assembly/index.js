import { ProtocolError, sourceRef, TURN_TYPES } from '../schemas/index.js';
import { computeBudget, groupHistory, compressibleSources, resolveSources, sourceKey, uniqueSources } from '../policy/index.js';
import { expandMacros } from '../macros/index.js';
import { applyRegex } from '../regex/index.js';
import { selectWorldInfo } from '../world-info/index.js';
import { countRequest } from '../tokens/index.js';
import { PRESET_DEFAULTS, BLOCK_DEFAULTS, CONTEXT_LAYERS } from './defaults.js';
import { buildReplyLanguageInstruction, resolveReplyLanguage } from '../../reply-language.js';

export { PRESET_DEFAULTS, BLOCK_DEFAULTS, CONTEXT_LAYERS } from './defaults.js';
export { WORLD_INFO_DEFAULTS, WORLD_ENTRY_DEFAULTS } from '../world-info/index.js';
export { BUDGET_DEFAULTS, computeBudget } from '../policy/index.js';

const stable = (a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const overlaps = (refs, seen) => refs.some(ref => seen.has(sourceKey(ref)));
const plainText = content => typeof content === 'string' ? content : (content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n');

function normalizeBlock(input) {
    const block = { ...BLOCK_DEFAULTS, ...input };
    const position = block.placement;
    if (!block.id || !CONTEXT_LAYERS.includes(block.layer) || !['system', 'user', 'assistant', 'tool'].includes(block.role)
        || !['prefix', 'depth', 'tail'].includes(position?.type) || !Number.isFinite(block.priority)
        || (position.type === 'depth' && (!Number.isSafeInteger(position.depth) || position.depth < 0))) {
        throw new ProtocolError('invalid-prompt-block', `Invalid prompt block ${block.id ?? ''}`);
    }
    if (!block.history && block.role === 'tool') throw new ProtocolError('invalid-prompt-block', 'Only paired history can use the tool role');
    if (!block.history && typeof block.content !== 'string') throw new ProtocolError('invalid-prompt-block', 'Prompt content must be a string');
    return { ...block, placement: { ...position }, sourceRefs: uniqueSources(block.sourceRefs) };
}

function getResource(snapshot, settings, key, kind) {
    const id = settings[key];
    if (id == null) return undefined;
    const resource = (snapshot.resources ?? []).find(item => item.id === id && item.kind === kind);
    if (!resource) throw new ProtocolError('missing-resource', `Snapshot does not contain selected ${kind}`);
    return resource;
}

function historyMessage(message) {
    const output = { role: message.role, content: structuredClone(message.content ?? '') };
    if (message.media?.length) {
        output.content = [...(typeof output.content === 'string' ? [{ type: 'text', text: output.content }] : output.content), ...structuredClone(message.media)];
    }
    for (const key of ['toolCalls', 'toolCallId', 'name', 'reasoning']) if (message[key] !== undefined) output[key] = structuredClone(message[key]);
    return output;
}

/** Returns a pure request plan. Never mutates snapshot, persists effects, or invokes a model. */
export function compileContext(snapshot, options = {}) {
    const { draft, type = 'send', countTokens, capabilities = {}, seed = 0, tools = [] } = options;
    if (!TURN_TYPES.includes(type)) throw new ProtocolError('invalid-request', 'Unknown generation type');
    if (['regenerate', 'continue'].includes(type)) {
        const position = snapshot.messages.findIndex(message => message.id === options.targetMessageId && message.role === 'assistant' && !message.deletedAt && !message.userHidden);
        if (position < 0) throw new ProtocolError('invalid-target', 'Generation requires a current assistant target');
        snapshot = { ...snapshot, messages: snapshot.messages.slice(0, position + (type === 'continue' ? 1 : 0)) };
    }
    if (capabilities.supported === false || capabilities.enabled === false) throw new ProtocolError('unsupported-capability', 'Connection is disabled');
    if (capabilities.types && !capabilities.types.includes(type)) throw new ProtocolError('unsupported-capability', 'Generation type is unsupported');
    if (tools.length && capabilities.tools === false) throw new ProtocolError('unsupported-capability', 'Tools are unsupported');
    // Native Anthropic/Google codecs and the Claude SDK history encoder accept system text only before the first non-system message.
    const prefixSystemOnly = capabilities.systemPlacement === 'prefix' || capabilities.deepSystem === false;
    const settings = { ...snapshot.conversation?.settings, ...snapshot.settings };
    const connection = getResource(snapshot, settings, 'connectionId', 'connection')?.data ?? {};
    const limits = { ...connection, ...capabilities.limits };
    for (const key of ['contextWindow', 'inputLimit', 'maxOutputTokens', 'outputLimit']) if (capabilities[key] !== undefined) limits[key] = capabilities[key];
    const budget = computeBudget({ ...limits, workingBudget: options.workingBudget ?? limits.workingBudget });
    if (limits.outputLimit !== undefined && (!Number.isSafeInteger(limits.outputLimit) || limits.maxOutputTokens > limits.outputLimit)) {
        throw new ProtocolError('invalid-budget', 'Requested output exceeds the verified output limit');
    }
    const preset = { ...PRESET_DEFAULTS, ...getResource(snapshot, settings, 'presetId', 'preset')?.data };
    if (!['chat', 'text'].includes(preset.mode)) throw new ProtocolError('invalid-preset', 'mode must be chat or text');
    const character = getResource(snapshot, settings, 'characterId', 'character');
    const persona = getResource(snapshot, settings, 'personaId', 'persona');
    const bindings = { char: character?.name ?? '', user: persona?.name ?? '', scenario: character?.data?.scenario ?? '', type };
    const variables = { ...settings.variables, ...options.variables };
    const omitted = [];
    const blocks = [];
    const add = input => {
        const block = normalizeBlock(input);
        if (blocks.some(item => item.id === block.id)) throw new ProtocolError('invalid-prompt-block', `Duplicate block ID ${block.id}`);
        blocks.push(block);
    };
    if (preset.system) add({ id: 'preset:system', layer: 'L1', placement: { type: 'prefix' }, content: preset.system });
    const generationInstructions = {
        regenerate: 'Generate a new alternative assistant reply to the latest user message.',
        continue: 'Continue the last assistant message exactly where it ends. Do not repeat its existing text.',
        impersonate: 'Draft the next message as the user persona, not as the assistant. Return only the proposed user message.',
        auxiliary: 'Perform the requested auxiliary task. This output is a separate draft, not a new conversation reply.',
    };
    if (generationInstructions[type]) add({ id: 'runtime:generation-type', layer: 'L5', placement: { type: 'tail' }, content: preset.generationInstructions?.[type] ?? generationInstructions[type] });
    // Reply language (public/shared/reply-language.js): right after the history; auxiliary tasks such as memory are not steered.
    if (type !== 'auxiliary' && typeof settings.replyLanguage === 'string') {
        const instruction = buildReplyLanguageInstruction(resolveReplyLanguage({ reply_language: settings.replyLanguage }));
        if (instruction) add({ id: 'runtime:reply-language', layer: 'L5', placement: { type: 'depth', depth: 0 }, content: instruction });
    }
    for (const resource of [character, persona].filter(Boolean)) {
        for (const field of ['description', 'personality', 'scenario']) if (resource.data[field]) {
            add({ id: `${resource.kind}:${resource.id}:${field}`, layer: 'L1', placement: { type: 'prefix' }, content: resource.data[field] });
        }
    }
    for (const input of preset.blocks) {
        if (/^(history:|summary:|derived:|world:|character:|persona:|preset:|draft$)/.test(input.id)) {
            throw new ProtocolError('invalid-prompt-block', 'Preset block ID uses a reserved prefix');
        }
        const refs = input.sourceRefs ?? [];
        if (refs.length && !resolveSources({ ...input, status: 'valid' }, snapshot)) {
            if (input.required !== false) throw new ProtocolError('stale-source', `Required block ${input.id} has stale sources`);
            omitted.push({ id: input.id, reason: 'stale-source' });
        } else add(input);
    }

    const messages = (snapshot.messages ?? []).filter(message => !message.deletedAt && !message.userHidden);
    const groups = groupHistory(messages);
    const protectedGroups = new Set(groups.filter(group => group.open));
    if (groups.length) protectedGroups.add(groups.at(-1));
    const lastComplete = groups.findLast(group => group.complete);
    if (lastComplete) protectedGroups.add(lastComplete);
    const covered = new Set();
    const selectedSummaries = new Set();
    const folds = (snapshot.folds ?? []).map(fold => {
        const summary = fold.summaryRef ? (snapshot.summaries ?? []).find(item => item.id === fold.summaryRef.id && item.revision === fold.summaryRef.revision) : fold;
        const refs = resolveSources(fold, snapshot);
        const summaryRefs = summary && resolveSources(summary, snapshot);
        return { fold, summary, refs, summaryRefs };
    }).sort((a, b) => (b.summaryRefs?.length ?? 0) - (a.summaryRefs?.length ?? 0) || (a.fold.id < b.fold.id ? -1 : 1));
    for (const { fold, summary, refs, summaryRefs } of folds) {
        let reason;
        const keys = new Set((summaryRefs ?? []).map(sourceKey));
        const touched = groups.filter(group => group.messages.some(message => keys.has(sourceKey(sourceRef(message)))));
        if (!refs || !summaryRefs || !summaryRefs.length || !summary.content || fold.expanded) reason = 'inactive-fold';
        else if (refs.length !== summaryRefs.length || refs.some(ref => !keys.has(sourceKey(ref)))) reason = 'fold-source-mismatch';
        else if (touched.some(group => protectedGroups.has(group) || group.messages.some(message => !keys.has(sourceKey(sourceRef(message)))))) reason = 'protected-or-partial-turn';
        else if (overlaps(summaryRefs, covered)) reason = 'duplicate-source';
        if (reason) { omitted.push({ id: fold.id, reason }); continue; }
        summaryRefs.forEach(ref => covered.add(sourceKey(ref)));
        selectedSummaries.add(summary.id);
        add({ id: `summary:${summary.id}`, layer: 'L2', placement: { type: 'prefix' }, content: summary.content, sourceRefs: summaryRefs, template: false });
    }
    // Prefer the newest valid rolling summary only over already folded coverage.
    // Never re-hide an expanded interval or absorb protected/recent raw history.
    const rolling = (snapshot.summaries ?? []).findLast(item => item.kind === 'rolling' && resolveSources(item, snapshot));
    if (rolling?.content && !selectedSummaries.has(rolling.id)) {
        const refs = resolveSources(rolling, snapshot);
        const keys = new Set(refs.map(sourceKey));
        const chapters = blocks.filter(block => block.id.startsWith('summary:') && overlaps(block.sourceRefs, keys));
        const replaced = new Set(chapters.flatMap(block => block.sourceRefs.map(sourceKey)));
        if (refs.length && refs.every(ref => covered.has(sourceKey(ref))) && chapters.length
            && replaced.size === keys.size && [...replaced].every(key => keys.has(key))) {
            const removed = new Set(chapters);
            for (let i = blocks.length - 1; i >= 0; i--) if (removed.has(blocks[i])) blocks.splice(i, 1);
            selectedSummaries.add(rolling.id);
            add({ id: `summary:${rolling.id}`, layer: 'L2', placement: { type: 'prefix' }, content: rolling.content, sourceRefs: refs, template: false });
        }
    }
    const historyGroups = groups.filter(group => !group.messages.every(message => covered.has(sourceKey(sourceRef(message)))));
    const represented = new Set(covered);
    const rawSources = new Set(historyGroups.flatMap(group => group.messages.map(message => sourceKey(sourceRef(message)))));
    const retrieved = new Set();
    for (const group of historyGroups) for (const message of group.messages) {
        const ref = sourceRef(message);
        represented.add(sourceKey(ref));
        add({ id: `history:${message.id}`, layer: group === groups.at(-1) && message.role === 'user' ? 'L5' : 'L4',
            role: message.role, content: message.content ?? '', sourceRefs: [ref], history: true, groupId: group.id, message: historyMessage(message) });
    }
    for (const item of [...(snapshot.summaries ?? []).filter(item => !selectedSummaries.has(item.id)), ...(snapshot.memories ?? []), ...(snapshot.retrieval ?? [])]) {
        const refs = resolveSources(item, snapshot);
        const id = `derived:${item.id}`;
        const memory = (snapshot.memories ?? []).includes(item);
        const retrieval = (snapshot.retrieval ?? []).includes(item);
        // A folded summary does not replace the original detail returned by retrieval.
        // Still omit any original already present verbatim in active raw history.
        const recalledRaw = retrieval && item.kind === 'message';
        const duplicate = recalledRaw ? refs && overlaps(refs, rawSources) : refs?.length && overlaps(refs, represented);
        const retrievalKey = JSON.stringify([refs, item.content]);
        if (!refs) omitted.push({ id, reason: 'stale-source' });
        else if (retrieval && (retrieved.has(retrievalKey) || (snapshot.memories ?? []).some(block => item.key === `derived:${block.id}` && resolveSources(block, snapshot)))) omitted.push({ id, reason: 'duplicate-source' });
        else if (!memory && duplicate) omitted.push({ id, reason: 'duplicate-source' });
        else {
            add({ id, layer: (snapshot.retrieval ?? []).includes(item) ? 'L3' : 'L2', placement: { type: 'prefix' },
                required: item.required === true || item.locked === true, priority: item.priority ?? item.score ?? 0, content: item.content, sourceRefs: refs, evidenceOnly: memory || recalledRaw, template: false });
            if (retrieval) retrieved.add(retrievalKey);
            if (!memory) refs.forEach(ref => represented.add(sourceKey(ref)));
        }
    }
    if ((draft !== undefined && draft !== '') || options.media?.length) {
        if (draft !== undefined && typeof draft !== 'string') throw new ProtocolError('invalid-request', 'draft must be a string');
        add({ id: 'draft', layer: 'L5', role: 'user', content: draft ?? '', history: true, groupId: 'draft', message: historyMessage({ role: 'user', content: draft ?? '', media: options.media }) });
        historyGroups.push({ id: 'draft', messages: [] });
    }
    const books = (settings.worldbookIds ?? []).map(id => {
        const book = (snapshot.resources ?? []).find(resource => resource.id === id && resource.kind === 'worldbook');
        if (!book) throw new ProtocolError('missing-resource', 'Snapshot does not contain selected worldbook');
        return book;
    });
    const world = selectWorldInfo(books, { seed, turnIndex: settings.worldInfo?.turnIndex ?? 0,
        state: settings.worldInfo?.state ?? {}, history: [...groups.map(group => group.messages.map(message => plainText(message.content)).join('\n')), ...(draft ? [draft] : [])] });
    for (const entry of world.entries) add({ id: `world:${entry.key}`, layer: 'L3', role: entry.role, placement: entry.placement, priority: entry.priority,
        required: entry.required, content: entry.content, worldKey: entry.key });

    function render(chosen) {
        const prefixes = chosen.filter(block => !block.history && block.placement.type === 'prefix').sort((a, b) => a.layer.localeCompare(b.layer) || stable(a, b));
        const ordered = [...prefixes];
        for (let index = 0; index <= historyGroups.length; index++) {
            ordered.push(...chosen.filter(block => !block.history && block.placement.type === 'depth'
                && Math.max(0, historyGroups.length - block.placement.depth) === index).sort(stable));
            if (index < historyGroups.length) ordered.push(...chosen.filter(block => block.history && block.groupId === historyGroups[index].id));
        }
        ordered.push(...chosen.filter(block => !block.history && block.placement.type === 'tail').sort(stable));
        let state = variables;
        const effects = [];
        const renderedBlocks = ordered.map(block => {
            let message;
            if (block.history) {
                message = structuredClone(block.message);
                const transform = text => applyRegex(text, preset.regex, { stage: 'history', role: block.role });
                message.content = typeof message.content === 'string' ? transform(message.content) : message.content.map(part => part.type === 'text' ? { ...part, text: transform(part.text) } : part);
            } else {
                let content = String(block.content ?? '');
                if (block.template !== false) {
                    content = applyRegex(content, preset.regex, { stage: 'before-macros', role: block.role });
                    const expanded = expandMacros(content, { variables: state, bindings });
                    state = expanded.variables;
                    effects.push(...expanded.effects.map(effect => ({ ...effect, blockId: block.id })));
                    content = applyRegex(expanded.content, preset.regex, { stage: 'after-macros', role: block.role });
                }
                message = { role: block.role, content };
            }
            return { ...block, content: message.content, message };
        });
        if (prefixSystemOnly) {
            // Keep position and text; later system blocks (depth, tail, generation instructions) become user turns.
            // A trailing user instruction also avoids assistant prefill, so continue/impersonate keep their meaning.
            let started = false;
            for (const block of renderedBlocks) {
                if (block.message.role !== 'system') started = true;
                else if (started) block.message.role = 'user';
            }
        }
        const request = { mode: preset.mode, messages: renderedBlocks.map(block => block.message), tools: structuredClone(tools) };
        if (preset.mode === 'text') {
            const template = { ...PRESET_DEFAULTS.textTemplate, ...preset.textTemplate };
            const interpolate = (text, extra = {}) => expandMacros(text, { variables: state, bindings: { ...bindings, ...extra }, allowWrites: false }).content;
            request.prompt = interpolate(template.prefix) + request.messages.map(message => {
                if (Array.isArray(message.content)) for (const part of message.content) {
                    if (part.type !== 'text' && (message.role !== 'user' || !capabilities.media?.includes(part.type))) {
                        throw new ProtocolError('unsupported-media', 'Text provider does not support this media role or type');
                    }
                }
                const metadata = message.toolCalls || message.toolCallId || message.reasoning ? `\n${JSON.stringify({ toolCalls: message.toolCalls, toolCallId: message.toolCallId, reasoning: message.reasoning })}` : '';
                return interpolate(template.message, { role: message.role, content: plainText(message.content) + metadata, name: message.name ?? '' });
            }).join(template.separator) + interpolate(template.suffix);
        }
        const tokenCount = countRequest(request, { countTokens, mediaTokenCost: capabilities.mediaTokenCost });
        const includedWorld = new Set(chosen.filter(block => block.worldKey).map(block => block.worldKey));
        effects.push(...world.effects.filter(effect => includedWorld.has(effect.key)));
        return { ...request, blocks: renderedBlocks, effects, tokenCount };
    }

    // History owns its source, followed by its effective fold. Other blocks cannot repeat it.
    const occupied = new Set(blocks.filter(block => block.history || block.id.startsWith('summary:'))
        .flatMap(block => block.sourceRefs.map(sourceKey)));
    const candidates = blocks.filter(block => {
        if (block.history || block.id.startsWith('summary:')) return true;
        if (!block.evidenceOnly && overlaps(block.sourceRefs, occupied)) {
            if (block.required) throw new ProtocolError('duplicate-source', `Required block ${block.id} duplicates represented history`);
            omitted.push({ id: block.id, reason: 'duplicate-source' });
            return false;
        }
        return true;
    });
    const required = candidates.filter(block => block.required);
    const requiredSources = new Set();
    for (const block of required) {
        if (block.evidenceOnly) continue;
        if (overlaps(block.sourceRefs, requiredSources)) throw new ProtocolError('duplicate-source', `Required block ${block.id} duplicates another required block`);
        block.sourceRefs.forEach(ref => requiredSources.add(sourceKey(ref)));
    }
    let selected = [...required];
    let result = render(selected);
    if (result.tokenCount.tokens > budget.workingBudget) {
        throw new ProtocolError('budget-blocked', 'Required content exceeds the working input budget; history was not truncated', 422,
            { budget, estimatedTokens: result.tokenCount.tokens, tokenCount: result.tokenCount,
                sourceRefs: uniqueSources(required.flatMap(block => block.sourceRefs)), compressibleSourceRefs: compressibleSources(historyGroups),
                blocks: result.blocks.map(block => ({ id: block.id, layer: block.layer, sourceRefs: block.sourceRefs })) });
    }
    for (const block of candidates.filter(block => !block.required).sort(stable)) {
        if (!block.evidenceOnly && overlaps(block.sourceRefs, requiredSources)) {
            omitted.push({ id: block.id, reason: 'duplicate-source' });
            continue;
        }
        const next = render([...selected, block]);
        if (next.tokenCount.tokens <= budget.workingBudget) {
            selected.push(block); result = next;
            if (!block.evidenceOnly) block.sourceRefs.forEach(ref => requiredSources.add(sourceKey(ref)));
        } else omitted.push({ id: block.id, reason: 'budget', sourceRefs: block.sourceRefs });
    }
    const fixed = result.blocks.filter(block => block.layer === 'L1').map(block => block.message);
    const fixedTokens = countRequest({ mode: 'chat', messages: fixed, tools: structuredClone(tools) }, { countTokens, mediaTokenCost: capabilities.mediaTokenCost });
    return { ...result, type, estimatedTokens: result.tokenCount.tokens, budget, omitted,
        sourceRefs: uniqueSources(result.blocks.flatMap(block => block.sourceRefs)),
        warnings: fixedTokens.tokens > budget.workingBudget * 0.25 ? [{ code: 'fixed-context-over-quarter', estimatedTokens: fixedTokens.tokens }] : [] };
}
