import test from 'node:test';
import assert from 'node:assert/strict';
import { compileContext, PRESET_DEFAULTS, WORLD_ENTRY_DEFAULTS } from '../../../../public/shared/conversation/assembly/index.js';
import { computeBudget, resolveSources } from '../../../../public/shared/conversation/policy/index.js';
import { expandMacros } from '../../../../public/shared/conversation/macros/index.js';
import { applyRegex } from '../../../../public/shared/conversation/regex/index.js';
import { selectWorldInfo } from '../../../../public/shared/conversation/world-info/index.js';
import { countRequest } from '../../../../public/shared/conversation/tokens/index.js';
import { sourceRef } from '../../../../public/shared/conversation/schemas/index.js';

const message = (id, turnId, role, content = id, extra = {}) => ({ id, turnId, role, content, revision: 1, status: 'completed', ...extra });
const history = () => [message('u1', 't1', 'user'), message('a1', 't1', 'assistant'), message('u2', 't2', 'user'), message('a2', 't2', 'assistant'), message('u3', 't3', 'user')];
const snapshot = (data = {}, messages = history()) => ({ conversation: { settings: {} }, settings: { connectionId: 'c', presetId: 'p' }, messages,
    resources: [{ id: 'c', kind: 'connection', revision: 1, data: { contextWindow: 10000, maxOutputTokens: 1000, workingBudget: 8000 } },
        { id: 'p', kind: 'preset', revision: 1, data }], memories: [], summaries: [], folds: [] });
const counter = request => ({ tokens: request.messages.reduce((sum, message) => sum + (typeof message.content === 'string' ? message.content.length : 100), 0)
    + JSON.stringify(request.tools).length, exact: true, method: 'test-counter' });
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

test('budget formula uses independent input cap, output reserve and 2% safety', () => {
    assert.deepEqual(computeBudget({ contextWindow: 100000, inputLimit: 50000, maxOutputTokens: 10000, workingBudget: 64000 }), { safetyTokens: 1000, hardInputBudget: 49000, workingBudget: 49000 });
    assert.deepEqual(computeBudget({ contextWindow: 4096, maxOutputTokens: 1024, workingBudget: 1000 }), { safetyTokens: 256, hardInputBudget: 2816, workingBudget: 1000 });
    assert.equal(computeBudget({ contextWindow: 100000, inputLimit: 95000, maxOutputTokens: 20000, workingBudget: 90000 }).hardInputBudget, 78100);
    for (const invalid of [0, -1, NaN, Infinity, 1.2, '300']) assert.throws(() => computeBudget({ contextWindow: invalid, maxOutputTokens: 1 }), { code: 'invalid-budget' });
    assert.throws(() => computeBudget({ contextWindow: 300, maxOutputTokens: 100 }), { code: 'invalid-budget' });
});

test('over-budget history refuses and supplies only compressible full turns', () => {
    const input = freeze(snapshot());
    assert.throws(() => compileContext(input, { workingBudget: 5, countTokens: counter }), error => {
        assert.equal(error.code, 'budget-blocked');
        assert.deepEqual(error.details.compressibleSourceRefs.map(ref => ref.messageId), ['u1', 'a1']);
        return true;
    });
    assert.deepEqual(compileContext(input, { countTokens: counter }).messages.map(message => message.content), ['u1', 'a1', 'u2', 'a2', 'u3']);
});

test('macro assignments produce proposals, sequential reads, no interpolation of injected content', () => {
    const variables = freeze({ x: 2, literal: '{{inc::x::1}}' });
    const result = expandMacros('{{inc::x::3}}{{get::x}}/{{get::literal}}/{{char}}', { variables, bindings: { char: 'Ada' } });
    assert.equal(result.content, '5/{{inc::x::1}}/Ada');
    assert.equal(variables.x, 2);
    assert.equal(result.effects.length, 1);
    assert.throws(() => expandMacros('{{unknown}}'), { code: 'invalid-macro' });
    assert.throws(() => expandMacros('{{set::__proto__::bad}}'), { code: 'invalid-macro' });
});

test('estimates are reproducible; excluded optional macros never commit proposals', () => {
    const input = freeze(snapshot({ blocks: [{ id: 'optional', required: false, content: '{{set::x::changed}}' + 'x'.repeat(100) }] }));
    const options = { workingBudget: 20, countTokens: counter, variables: { x: 'old' } };
    const plan = compileContext(input, options);
    assert.deepEqual(plan, compileContext(input, options));
    assert.deepEqual(plan.effects, []);
    assert.equal(plan.omitted.find(item => item.id === 'optional').reason, 'budget');
    assert.equal(options.variables.x, 'old');
});

test('macro writes in included blocks are temporary and not evaluated in raw history', () => {
    const input = freeze(snapshot({ system: '{{set::n::one}}{{get::n}}', blocks: [{ id: 'note', content: '{{get::n}}' }] }, [message('u', 't', 'user', '{{set::n::evil}}')]));
    const plan = compileContext(input);
    assert.equal(plan.messages[0].content, 'one');
    assert.equal(plan.messages[1].content, '{{set::n::evil}}');
    assert.equal(plan.messages[2].content, 'one');
    assert.equal(plan.effects.length, 1);
});

test('regex stages are ordered and output stage is explicitly separate', () => {
    const rules = [{ id: 'pre', stage: 'before-macros', pattern: 'NAME', replacement: '{{char}}' },
        { id: 'post', stage: 'after-macros', pattern: 'Ada', replacement: 'Captain' },
        { id: 'raw', stage: 'history', pattern: 'u1', replacement: 'input', roles: ['user'] },
        { id: 'out', stage: 'output', pattern: 'Captain', replacement: 'Done' }];
    const input = snapshot({ system: 'NAME', regex: rules });
    input.settings.characterId = 'char';
    input.resources.push({ id: 'char', kind: 'character', name: 'Ada', data: {} });
    const plan = compileContext(input);
    assert.equal(plan.messages[0].content, 'Captain');
    assert.equal(plan.messages[1].content, 'input');
    assert.equal(applyRegex('Captain', rules, { stage: 'output' }), 'Done');
    assert.throws(() => applyRegex('x', [{ stage: 'history', pattern: '[', replacement: '' }], { stage: 'history' }), { code: 'invalid-regex' });
});

test('depth counts complete turns, never tool submessages; same location has stable priority', () => {
    const input = snapshot({ blocks: [{ id: 'b', content: 'B', placement: { type: 'depth', depth: 1 } }, { id: 'a', content: 'A', placement: { type: 'depth', depth: 1 } }] },
        [message('u', 't1', 'user'), message('call', 't1', 'assistant', '', { toolCalls: [{ id: 'c1', name: 'recall', args: {} }] }),
            message('result', 't1', 'tool', 'answer', { toolCallId: 'c1' }), message('end', 't1', 'assistant'), message('new', 't2', 'user')]);
    const plan = compileContext(input);
    assert.deepEqual(plan.messages.map(message => message.content), ['u', '', 'answer', 'end', 'A', 'B', 'new']);
    assert.equal(plan.messages[1].toolCalls[0].id, 'c1');
    assert.equal(plan.messages[2].toolCallId, 'c1');
});

test('orphan tool results and split turns fail explicitly; open tool groups survive', () => {
    assert.throws(() => compileContext(snapshot({}, [message('r', 't', 'tool', 'x', { toolCallId: 'missing' })])), { code: 'invalid-tool-group' });
    assert.throws(() => compileContext(snapshot({}, [message('u', 't', 'user'), message('v', 'other', 'user'), message('a', 't', 'assistant')])), { code: 'invalid-history' });
    const plan = compileContext(snapshot({}, [message('u', 't', 'user'), message('a', 't', 'assistant', '', { toolCalls: [{ id: 'pending' }] })]));
    assert.equal(plan.messages.at(-1).toolCalls[0].id, 'pending');
});

function folded() {
    const input = snapshot();
    const refs = input.messages.slice(0, 2).map(sourceRef);
    input.summaries = [{ id: 's', revision: 1, status: 'valid', content: 'summary', sourceRefs: refs }];
    input.folds = [{ id: 'f', revision: 1, status: 'valid', sourceRefs: refs, summaryRef: { id: 's', revision: 1 } }];
    return input;
}

test('valid fold replaces a full old turn exactly once and returns all source refs', () => {
    const plan = compileContext(freeze(folded()));
    assert.deepEqual(plan.messages.map(message => message.content), ['summary', 'u2', 'a2', 'u3']);
    assert.equal(plan.sourceRefs.length, 5);
    assert.equal(plan.blocks[0].layer, 'L2');
});

test('edits, deletions and candidate changes invalidate summaries and restore surviving raw history', () => {
    for (const change of [message => { message.revision++; }, message => { message.deletedAt = 'now'; }, message => { message.candidateId = 'new'; message.candidateRevision = 1; }]) {
        const input = folded();
        change(input.messages[0]);
        const plan = compileContext(input);
        assert.ok(!plan.messages.some(message => message.content === 'summary'));
        assert.ok(plan.messages.some(message => message.content === 'a1'));
    }
});

test('parent summary dependencies and cycles are revalidated', () => {
    const input = folded();
    const child = { id: 'child', revision: 1, status: 'valid', sourceRefs: [], parentSummaryRefs: [{ id: 's', revision: 1 }] };
    assert.equal(resolveSources(child, input).length, 2);
    input.summaries[0].status = 'stale';
    assert.equal(resolveSources(child, input), null);
    input.summaries.push(child);
    child.parentSummaryRefs = [{ id: 'child', revision: 1 }];
    assert.equal(resolveSources(child, input), null);
});

test('expanded folds and partial turns keep originals; last completed turn cannot fold', () => {
    for (const mutate of [input => { input.folds[0].expanded = true; }, input => { input.summaries[0].sourceRefs.pop(); }, input => {
        const refs = input.messages.slice(2, 4).map(sourceRef);
        input.summaries[0].sourceRefs = refs;
        input.folds[0].sourceRefs = refs;
    }]) {
        const input = folded(); mutate(input);
        assert.deepEqual(compileContext(input).messages.map(message => message.content), history().map(message => message.content));
    }
});

test('duplicate retrieval and stale locked memory never enter the request', () => {
    const input = snapshot();
    input.retrieval = [{ id: 'r', status: 'valid', content: 'duplicate', sourceRefs: [sourceRef(input.messages[0])] }];
    input.memories = [{ id: 'm', status: 'pending-confirm', locked: true, content: 'stale', sourceRefs: [] }];
    const plan = compileContext(input);
    assert.ok(plan.omitted.some(item => item.reason === 'duplicate-source'));
    assert.ok(plan.omitted.some(item => item.reason === 'stale-source'));
    assert.equal(plan.messages.length, 5);
});

const worldbook = entries => ({ id: 'w', revision: 1, data: { entries } });
test('worldbook recursively activates to bounded depth, uses stable exclusive groups and probability', () => {
    const book = worldbook([{ id: 'a', keys: ['start'], content: 'chain' }, { id: 'b', keys: ['chain'], content: 'next' },
        { id: 'c', constant: true, group: 'g', priority: 2, content: 'winner' }, { id: 'd', constant: true, group: 'g', priority: 1, content: 'loser' },
        { id: 'never', constant: true, probability: 0, content: 'never' }]);
    const result = selectWorldInfo([book], { history: ['start'], seed: 'fixed' });
    assert.deepEqual(result.entries.map(entry => entry.id), ['c', 'a', 'b']);
    assert.equal(result.entries.at(-1).activationRound, 1);
    assert.deepEqual(result, selectWorldInfo([book], { history: ['start'], seed: 'fixed' }));
    book.data.maxRecursion = 0;
    assert.ok(!selectWorldInfo([book], { history: ['start'] }).entries.some(entry => entry.id === 'b'));
});

test('worldbook duration and cooldown only propose updates; persisted state is unchanged', () => {
    const book = worldbook([{ id: 'a', keys: ['start'], content: 'x', duration: 2, cooldown: 2 }]);
    const first = selectWorldInfo([book], { history: ['start'], turnIndex: 10 });
    const state = freeze({ 'w:a': first.effects[0].value });
    assert.equal(selectWorldInfo([book], { turnIndex: 11, state }).entries.length, 1);
    assert.equal(selectWorldInfo([book], { turnIndex: 11, state }).effects.length, 0);
    for (const turnIndex of [12, 13]) assert.equal(selectWorldInfo([book], { history: ['start'], turnIndex, state }).entries.length, 0);
    assert.equal(selectWorldInfo([book], { history: ['start'], turnIndex: 14, state }).effects.length, 1);
    assert.equal(state['w:a'].activatedTurn, 10);
});

test('omitted lore has no activation effects; five layers preserve roles', () => {
    const input = folded();
    input.resources[1].data.system = 'system';
    input.settings.worldbookIds = ['w'];
    input.resources.push({ ...worldbook([{ id: 'entry', constant: true, content: 'lore' }]), kind: 'worldbook' });
    const plan = compileContext(input, { countTokens: counter });
    assert.deepEqual([...new Set(plan.blocks.map(block => block.layer))].sort(), ['L1', 'L2', 'L3', 'L4', 'L5']);
    assert.equal(plan.effects[0].type, 'worldbook.activate');
    const smaller = compileContext(input, { countTokens: counter, workingBudget: plan.estimatedTokens - 1 });
    assert.equal(smaller.effects.length, 0);
    assert.equal(smaller.messages.at(-1).role, 'user');
});

test('chat and text templates preserve roles and explicit delimiters; tool definitions counted', () => {
    const input = snapshot({ mode: 'text', textTemplate: { prefix: 'BEGIN\n', message: '<{{role}}>{{content}}</{{role}}>\n', suffix: '<assistant>' } }, [message('u', 't', 'user', 'hello')]);
    let counted;
    const plan = compileContext(input, { tools: [{ name: 'recall', parameters: { type: 'object' } }], countTokens: request => { if (request.mode === 'text') counted = request; return 100; } });
    assert.equal(plan.prompt, 'BEGIN\n<user>hello</user>\n<assistant>');
    assert.equal(counted.tools[0].name, 'recall');
    assert.equal(plan.tokenCount.exact, false);
    assert.equal(plan.messages[0].role, 'user');
});

test('fallback explicitly estimates bytes; injected tokenizer may attest exact counting', () => {
    const request = { messages: [{ role: 'user', content: '你好' }], tools: [] };
    assert.equal(countRequest(request).exact, false);
    assert.ok(countRequest(request).tokens >= 6);
    assert.deepEqual(countRequest(request, { countTokens: () => ({ tokens: 12, exact: true, method: 'provider-tokenizer' }) }), { tokens: 12, exact: true, method: 'provider-tokenizer' });
    assert.throws(() => countRequest(request, { countTokens: async () => 12 }), { code: 'invalid-token-count' });
});

test('media has no guessed token cost and survives typed output with an explicit cost', () => {
    const input = snapshot({}, [message('u', 't', 'user', 'image', { media: [{ type: 'image', url: 'synthetic:image' }] })]);
    assert.throws(() => compileContext(input), { code: 'media-budget-unknown' });
    const plan = compileContext(input, { capabilities: { mediaTokenCost: { image: 1000 } } });
    assert.equal(plan.messages[0].content[1].type, 'image');
    assert.ok(plan.estimatedTokens >= 1000);
});

test('public defaults are immutable; missing limits do not invent model capabilities', () => {
    assert.ok(Object.isFrozen(PRESET_DEFAULTS.textTemplate));
    assert.ok(Object.isFrozen(WORLD_ENTRY_DEFAULTS.keys));
    const input = snapshot(); input.resources[0].data = {};
    assert.throws(() => compileContext(input), { code: 'invalid-budget' });
});

test('required duplicate sources and explicit output overflow are rejected', () => {
    const input = snapshot();
    input.resources[1].data.blocks = [{ id: 'duplicate', required: true, content: 'duplicate', sourceRefs: [sourceRef(input.messages[0])] }];
    assert.throws(() => compileContext(input), { code: 'duplicate-source' });
    input.resources[1].data.blocks[0].required = false;
    assert.ok(compileContext(input).omitted.some(item => item.id === 'duplicate' && item.reason === 'duplicate-source'));
    assert.throws(() => compileContext(snapshot(), { capabilities: { outputLimit: 500 } }), { code: 'invalid-budget' });
});

test('expanded older fragments cannot be hidden by a larger summary through a smaller fold', () => {
    const input = folded();
    input.messages.push(message('a3', 't3', 'assistant'), message('u4', 't4', 'user'));
    input.summaries[0].sourceRefs = input.messages.slice(0, 4).map(sourceRef);
    const plan = compileContext(input);
    assert.equal(plan.messages.length, input.messages.length);
    assert.ok(plan.omitted.some(item => item.id === 'f' && item.reason === 'fold-source-mismatch'));
});

test('worldbook secondary keys, disabled recursion and resource revision timing', () => {
    const book = worldbook([{ id: 'a', keys: ['Harbor'], secondaryKeys: ['night', 'fog'], secondaryMode: 'all', content: 'chain' },
        { id: 'b', keys: ['chain'], recursive: false, content: 'should not appear' }]);
    assert.equal(selectWorldInfo([book], { history: ['harbor night'] }).entries.length, 0);
    assert.deepEqual(selectWorldInfo([book], { history: ['harbor night fog'] }).entries.map(entry => entry.id), ['a']);
    const state = { 'w:a': { bookRevision: 0, activeUntil: 99, nextEligibleTurn: 99 } };
    assert.equal(selectWorldInfo([book], { history: ['harbor night fog'], state }).effects.length, 1);
});

test('draft is counted exactly as explicit input and does not mutate saved messages', () => {
    const input = freeze(snapshot());
    const plan = compileContext(input, { draft: 'new unsaved text', countTokens: counter });
    assert.equal(plan.messages.at(-1).content, 'new unsaved text');
    assert.equal(input.messages.length, 5);
    assert.throws(() => compileContext(input, { draft: 'new unsaved text', countTokens: counter, workingBudget: 20 }), { code: 'budget-blocked' });
});

test('tool definitions and reasoning reserve input capacity instead of truncating raw history', () => {
    const input = snapshot({}, [message('u', 't', 'user', 'question'), message('a', 't', 'assistant', 'answer', { reasoning: 'reason'.repeat(100) })]);
    const base = compileContext(input);
    assert.equal(base.messages[1].reasoning, 'reason'.repeat(100));
    assert.throws(() => compileContext(input, { workingBudget: base.estimatedTokens,
        tools: [{ name: 'long-tool', description: 'description'.repeat(100), parameters: { type: 'object' } }] }), { code: 'budget-blocked' });
});

test('stale transitive parent restores fold sources in actual compilation', () => {
    const input = folded();
    input.summaries.push({ id: 'parent', revision: 1, status: 'stale', content: 'old', sourceRefs: input.summaries[0].sourceRefs });
    input.summaries[0].parentSummaryRefs = [{ id: 'parent', revision: 1 }];
    assert.equal(compileContext(input).messages.length, input.messages.length);
});

test('depth zero appends after whole history and beyond-range depth precedes all turns', () => {
    const input = snapshot({ blocks: [{ id: 'after', content: 'after', placement: { type: 'depth', depth: 0 } },
        { id: 'before', content: 'before', placement: { type: 'depth', depth: 999 } }] });
    const plan = compileContext(input);
    assert.equal(plan.messages[0].content, 'before');
    assert.equal(plan.messages.at(-1).content, 'after');
});

test('text templates refuse variable effects and undeclared media', () => {
    const input = snapshot({ mode: 'text', textTemplate: { prefix: '{{set::x::bad}}' } });
    assert.throws(() => compileContext(input), { code: 'macro-write-forbidden' });
    input.resources[1].data.textTemplate = {};
    input.messages[0].media = [{ type: 'image', url: 'synthetic:image' }];
    assert.throws(() => compileContext(input), { code: 'unsupported-media' });
});

test('text templates keep declared media in typed messages and count it separately from the prompt', () => {
    const image = { type: 'image', data: 'AA==', mimeType: 'image/png' };
    const input = snapshot({ mode: 'text', textTemplate: { prefix: '', message: '{{role}}:{{content}}', separator: '\n', suffix: '' } },
        [message('u', 't', 'user', 'describe', { media: [image] })]);
    const plan = compileContext(input, { capabilities: { media: ['text', 'image'], mediaTokenCost: { image: 1000 } } });
    assert.equal(plan.prompt, 'user:describe');
    assert.deepEqual(plan.messages[0].content.at(-1), image);
    assert.ok(plan.estimatedTokens >= 1000);
    assert.throws(() => compileContext(input, { capabilities: { media: ['text', 'image'] } }), { code: 'media-budget-unknown' });
});
