/* global globalThis */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatAgentActions } from '../../../../public/modern/actions/chat-agent.js';
import { getChatAgentState, getChatAgentSession, currentAgentSelection, agentTurnWaitMs } from '../../../../public/modern/core/chat-agent-state.js';
import { createChatAgentComponents } from '../../../../public/modern/components/chat-agent.js';
import { createChatGenerationActions } from '../../../../public/modern/actions/chat-generation.js';
import { createChatGenerationRouteContext } from '../../../../public/modern/shell/route-context-chat.js';
import { createChatMessageEvents } from '../../../../public/modern/routes/chat-message-events.js';
import { describeAgentError } from '../../../../public/modern/core/chat-agent-errors.js';

function harness(overrides = {}) {
    const state = { selected: { character: 'hero.png', chat: 'ordinary', persona: 'editor-only', worldbook: 'editor-only' },
        chatDrafts: { 'hero.png::ordinary': 'Keep my ordinary draft' }, chatMessages: { 'hero.png::ordinary': [{ mes: 'Old history' }] },
        chatMetadata: { 'hero.png::ordinary': { persona: 'actual.png', world_info: 'actual-world' } }, engine: { generating: false } };
    const requests = [];
    const snapshot = { conversationId: 'c', conversation: { id: 'c', contentRevision: 0, activeTurnId: null }, messages: [] };
    const turns = new Map();
    const apiFetch = async (url, options = {}, retry) => {
        requests.push({ url, ...structuredClone(options), retry });
        if (overrides.apiFetch) return overrides.apiFetch(url, options, retry);
        if (url.endsWith('/workspace/start')) return { conversationId: 'c', notices: ['New resources; no imported history'] };
        if (url.endsWith('/stop')) {
            const turn = turns.get(url.split('/').at(-2)); turn.status = 'stopped'; snapshot.conversation.activeTurnId = null; return turn;
        }
        if (url.endsWith('/turns')) {
            let turn = [...turns.values()].find(t => t.clientRequestId === options.body.clientRequestId);
            if (!turn) {
                turn = { id: `t${turns.size + 1}`, status: 'completed', content: 'Agent answer', clientRequestId: options.body.clientRequestId };
                turns.set(turn.id, turn);
                snapshot.conversation.contentRevision++;
                snapshot.messages.push({ role: 'user', content: options.body.content }, { role: 'assistant', content: turn.content });
            }
            return { turnId: turn.id, status: turn.status };
        }
        if (url.includes('/turns/')) return structuredClone(turns.get(url.split('/').at(-1)));
        return structuredClone(snapshot);
    };
    let sequence = 0;
    const deps = { state, apiFetch, render() {}, getSelectedChatEntity: () => ({ avatar: state.selected.character, name: 'Hero' }),
        getChatContextKey: () => state.selected.character, getChatCacheKey: (a, b) => `${a}::${b}`, isGroupChatMode: () => false,
        requestId: () => `request-${++sequence}`, sleep: async () => {}, ...overrides };
    // Keep request recording even when injecting the HTTP implementation.
    deps.apiFetch = apiFetch;
    const actions = createChatAgentActions(deps);
    const session = () => getChatAgentSession(state, state.selected.character);
    return { state, requests, snapshot, turns, actions, session, deps };
}

test('explicit mode and send reuse current resource selection without touching ordinary draft/history', async () => {
    const h = harness();
    const originalDrafts = structuredClone(h.state.chatDrafts), originalMessages = structuredClone(h.state.chatMessages);
    h.actions.setChatAgentMode(true);
    assert.equal(h.requests.length, 0);
    h.actions.setChatAgentDraft('First');
    await h.actions.sendChatAgentMessage();
    assert.deepEqual(h.requests[0].body, { schemaVersion: 1, executor: 'pi', characterId: 'hero.png', title: 'Agent · Hero', personaId: 'actual.png', chatWorldbookId: 'actual-world' });
    assert.ok(h.requests.every(r => r.url.startsWith('/api/conversation/v1/') && r.retry === false));
    assert.equal(h.session().snapshot.messages.at(-1).content, 'Agent answer');
    h.actions.setChatAgentDraft('Second');
    await h.actions.sendChatAgentMessage();
    assert.equal(h.requests.filter(r => r.url.endsWith('/workspace/start')).length, 1);
    assert.equal(h.turns.size, 2);
    assert.equal(h.requests.filter(r => r.url.endsWith('/turns'))[1].body.expectedContentRevision, 1);
    h.actions.setChatAgentMode(false);
    assert.deepEqual(h.state.chatDrafts, originalDrafts);
    assert.deepEqual(h.state.chatMessages, originalMessages);
    assert.equal(h.state.engine.generating, false);
});

test('saved settings settle before projection, and unsaved editor selections are never sent', async () => {
    const h = harness({ waitForEngineSync: async () => ({ settled: false }) });
    h.actions.setChatAgentMode(true); h.actions.setChatAgentDraft('keep');
    await h.actions.sendChatAgentMessage();
    assert.equal(h.requests.length, 0);
    assert.equal(h.session().draft, 'keep');
    assert.equal(h.state.engine.generating, false);
    assert.match(h.session().error, /保存/);
    assert.deepEqual(currentAgentSelection({ avatar: 'hero.png' }), { schemaVersion: 1, executor: 'pi', characterId: 'hero.png', title: 'Agent · hero.png' });
});

for (const executor of ['pi', 'claude', 'codex']) test(`${executor} choice is projected explicitly and frozen until a new conversation`, async () => {
    const h = harness(); h.actions.setChatAgentMode(true); h.actions.setChatAgentExecutor(executor); h.actions.setChatAgentDraft('Hello');
    await h.actions.sendChatAgentMessage();
    assert.equal(h.requests[0].body.executor, executor);
    assert.throws(() => h.actions.setChatAgentExecutor('pi'), /首次发送前/);
    h.actions.newChatAgentConversation(); h.actions.setChatAgentExecutor('codex');
    assert.equal(h.session().executor, 'codex');
});

test('bounded polling keeps the server turn recoverable and stop uses only its saved ID', async () => {
    let time = 0, status = 'running';
    const h = harness({ now: () => ++time, watchMs: 1, apiFetch: async url => {
        if (url.endsWith('/workspace/start')) return { conversationId: 'c' };
        if (url.endsWith('/turns')) return { turnId: 't', status };
        if (url.endsWith('/stop')) { status = 'stopped'; return { id: 't', status }; }
        if (url.endsWith('/turns/t')) return { id: 't', status, content: 'partial' };
        return { conversation: { contentRevision: 1, activeTurnId: null }, messages: [] };
    } });
    h.actions.setChatAgentMode(true); h.actions.setChatAgentDraft('hello'); await h.actions.sendChatAgentMessage();
    // Giving up waiting releases ordinary chat but keeps the unfinished turn and its exact request.
    assert.match(h.session().error, /超时/); assert.equal(h.state.engine.generating, false);
    assert.equal(h.actions.isChatAgentActive(), false); assert.ok(h.session().pending);
    const html = createChatAgentComponents({ ...h.deps, escapeHtml: String }).renderChatAgent();
    assert.match(html, /data-chat-agent-action="stop"/);
    assert.match(html, /data-chat-agent-action="refresh" >/);
    assert.doesNotMatch(html, /data-chat-agent-action="retry"/);
    assert.match(html, /data-chat-agent-action="send" disabled/);
    await assert.rejects(h.actions.sendChatAgentMessage(), /状态尚未确认/);
    await h.actions.stopChatAgent();
    assert.equal(h.session().turn.status, 'stopped'); assert.equal(h.state.engine.generating, false); assert.equal(h.session().pending, null);
    assert.equal(h.requests.filter(r => r.url.endsWith('/turns')).length, 1);
    assert.equal(h.requests.filter(r => r.url.endsWith('/turns/t/stop')).length, 1);
});

test('the wait covers the conversation turn deadline plus a margin before releasing the page', async () => {
    assert.equal(agentTurnWaitMs(null), 210000);
    assert.equal(agentTurnWaitMs({ settings: { turnTimeoutMs: 600000 } }), 630000);
    assert.equal(agentTurnWaitMs({ settings: { turnTimeoutMs: 1 } }), 31000);
    assert.equal(agentTurnWaitMs({ settings: { turnTimeoutMs: 99999999 } }), 3630000);
    assert.equal(agentTurnWaitMs({ settings: { turnTimeoutMs: 'soon' } }), 210000);
    const run = async ({ endsAt, settings }) => {
        let time = 0, accepted = false;
        const h = harness({ now: () => time, sleep: async ms => { time += ms; }, apiFetch: async url => {
            if (url.endsWith('/workspace/start')) return { conversationId: 'c' };
            if (url.endsWith('/turns')) { accepted = true; return { turnId: 't', status: 'running' }; }
            if (url.endsWith('/turns/t')) return { id: 't', status: time >= endsAt ? 'completed' : 'running', content: '' };
            return { conversation: { contentRevision: 1, activeTurnId: accepted && time < endsAt ? 't' : null }, messages: [], settings };
        } });
        h.actions.setChatAgentMode(true); h.actions.setChatAgentDraft('slow'); await h.actions.sendChatAgentMessage();
        return { h, time };
    };
    // 150 s exceeds the old 120 s page limit but not the server's default 180 s deadline.
    const finished = await run({ endsAt: 150000, settings: {} });
    assert.equal(finished.h.session().error, ''); assert.equal(finished.h.session().turn.status, 'completed');
    assert.equal(finished.h.state.engine.generating, false);
    const longer = await run({ endsAt: 400000, settings: { turnTimeoutMs: 600000 } });
    assert.equal(longer.h.session().error, ''); assert.equal(longer.h.session().turn.status, 'completed');
    const stuck = await run({ endsAt: Infinity, settings: {} });
    assert.match(stuck.h.session().error, /超时/); assert.ok(stuck.time >= 210000 && stuck.time < 211000);
    assert.equal(stuck.h.state.engine.generating, false); assert.equal(stuck.h.session().turn.status, 'running');
});

test('polling redraws only visible Agent panel changes and the terminal state', async () => {
    const polls = [['running', ''], ['running', ''], ['running', ''], ['running', 'Hel'], ['running', 'Hel'], ['running', 'Hello'], ['completed', 'Hello']];
    const play = async ({ route, bubble }) => {
        let poll = -1, renders = 0, accepted = false;
        const h = harness({ render: () => { renders++; }, apiFetch: async url => {
            if (url.endsWith('/workspace/start')) return { conversationId: 'c' };
            if (url.endsWith('/turns')) { accepted = true; return { turnId: 't', status: 'queued' }; }
            if (url.endsWith('/turns/t')) { poll++; const [status, content] = polls[poll]; return { id: 't', status, content }; }
            if (!accepted) return { conversation: { contentRevision: 0, activeTurnId: null }, messages: [] };
            const done = poll >= polls.length - 1;
            return { conversation: { contentRevision: done ? 2 : 1, activeTurnId: done ? null : 't' }, messages: done ? [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello' }] : [{ role: 'user', content: 'hi' }] };
        } });
        h.state.route = route;
        h.actions.setChatAgentMode(true); h.actions.setChatAgentDraft('hi');
        const before = renders;
        const previous = globalThis.document;
        globalThis.document = { querySelector: selector => selector === '[data-chat-agent-turn]' ? bubble : null };
        try { await h.actions.sendChatAgentMessage(); } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
        return { renders: renders - before, h };
    };
    // Shown: send start, first poll, text appearing, terminal. Unchanged polls and the "Hel" -> "Hello"
    // growth (written into the existing bubble) do not rebuild the page.
    const body = { textContent: 'Hel' };
    const bubble = { getAttribute: () => 't', querySelector: selector => selector === '.message-body' ? body : null };
    const shown = await play({ route: 'chat', bubble });
    assert.equal(shown.renders, 4); assert.equal(body.textContent, 'Hello');
    assert.equal(shown.h.state.engine.generating, false);
    // Without the bubble on screen the same text growth falls back to one render.
    assert.equal((await play({ route: 'chat', bubble: null })).renders, 5);
    // On another page only the send start and the terminal state (generation lock released) redraw.
    const hidden = await play({ route: 'dashboard', bubble });
    assert.equal(hidden.renders, 2); assert.equal(hidden.h.state.engine.generating, false);
});

test('ambiguous POST never auto-retries; explicit recovery reuses the exact request ID and revision', async () => {
    let postCount = 0;
    const bodies = [];
    const h = harness({ apiFetch: async (url, options) => {
        if (url.endsWith('/workspace/start')) return { conversationId: 'c' };
        if (url.endsWith('/turns')) {
            bodies.push(structuredClone(options.body));
            if (++postCount === 1) throw new Error('Lost acknowledgement');
            return { turnId: 't', status: 'completed' };
        }
        if (url.includes('/turns/')) return { id: 't', status: 'completed', content: 'Recovered' };
        return { conversation: { activeTurnId: null, contentRevision: 7 }, messages: [] };
    } });
    h.actions.setChatAgentMode(true); h.actions.setChatAgentDraft('one fee only');
    await h.actions.sendChatAgentMessage();
    assert.equal(postCount, 1); assert.ok(h.session().pending); assert.equal(h.state.engine.generating, true);
    await assert.rejects(h.actions.sendChatAgentMessage(), /状态尚未确认/);
    await h.actions.sendChatAgentMessage({ retry: true });
    assert.deepEqual(bodies[0], bodies[1]);
    assert.equal(h.session().pending, null); assert.equal(h.state.engine.generating, false);
});

test('known rejection exposes unsupported fields and retains both drafts without locking generation', async () => {
    const h = harness({ apiFetch: async () => { throw Object.assign(new Error('422'), { status: 422, body: JSON.stringify({ error: { message: 'Cannot project', details: { fields: ['preset.prompts'] } } }) }); } });
    h.actions.setChatAgentMode(true); h.actions.setChatAgentDraft('Agent draft');
    await h.actions.sendChatAgentMessage();
    assert.match(h.session().error, /preset.prompts/);
    assert.equal(h.session().draft, 'Agent draft'); assert.equal(h.state.engine.generating, false);
});

test('unsupported settings are explained in Chinese and keep the field name', () => {
    const unsupported = fields => describeAgentError({ code: 'workspace-unsupported', message: 'Selected workspace settings cannot be represented by this Agent adapter', details: { fields } });
    assert.equal(unsupported(['main_api']), 'Agent 暂不支持当前设置：当前 API 类型不是对话补全（Chat Completion）。Agent 只支持对话补全类连接，请在设置中心的「模型连接」里切换后重试（main_api）');
    assert.match(unsupported(['worldbook.entry.sticky']), /世界书条目启用了 Agent 暂不支持的功能.*（worldbook\.entry\.sticky）$/);
    assert.match(unsupported(['preset.prompt.position', 'character.description.macros']), /提示词条目.*；文本里有 Agent 不支持的宏/);
    assert.match(unsupported(['made.up.field']), /该设置无法转换（made\.up\.field）$/);
    assert.equal(describeAgentError({ code: 'workspace-resource-unavailable', message: 'Selected workspace resource is missing' }), '所选角色、人设、预设或世界书文件缺失、无法读取或格式无效');
    // Codes outside the workspace projection keep the server text.
    assert.equal(describeAgentError({ code: 'conflict', message: 'Revision changed' }), 'Revision changed');
});

test('stop during resource projection prevents any model turn submission', async () => {
    let resolveStart;
    const started = new Promise(resolve => { resolveStart = resolve; });
    const h = harness({ apiFetch: async url => {
        if (url.endsWith('/workspace/start')) return started;
        assert.ok(!url.endsWith('/turns'));
        return { conversation: { contentRevision: 0, activeTurnId: null }, messages: [] };
    } });
    h.actions.setChatAgentMode(true); h.actions.setChatAgentDraft('Keep');
    const sending = h.actions.sendChatAgentMessage();
    await h.actions.stopChatAgent();
    resolveStart({ conversationId: 'c' }); await sending;
    assert.equal(h.requests.filter(r => r.url.endsWith('/turns')).length, 0);
    assert.equal(h.session().draft, 'Keep'); assert.equal(h.state.engine.generating, false);
});

test('generation busy prevents mode switches, parallel legacy work and double send', async () => {
    const h = harness(); h.state.engine.generating = true;
    assert.throws(() => h.actions.setChatAgentMode(true), /等待/);
    h.state.engine.generating = false; h.actions.setChatAgentMode(true); h.actions.setChatAgentDraft('Hi');
    h.state.engine.generating = true;
    await h.actions.sendChatAgentMessage(); assert.equal(h.requests.length, 0);
    const group = harness({ isGroupChatMode: () => true });
    assert.throws(() => group.actions.setChatAgentMode(true), /群聊/);
});

test('switching viewed character cannot retarget an in-flight send', async () => {
    let complete;
    const pending = new Promise(resolve => { complete = resolve; });
    const h = harness({ waitForEngineSync: () => pending });
    h.actions.setChatAgentMode(true); h.actions.setChatAgentDraft('Hero draft');
    const original = h.session(); const sending = h.actions.sendChatAgentMessage();
    h.state.selected.character = 'other.png'; complete({ settled: true }); await sending;
    assert.equal(h.requests[0].body.characterId, 'hero.png');
    assert.equal(original.snapshot.messages[0].content, 'Hero draft');
    assert.equal(h.session(), undefined);
});

test('Agent output is escaped and only registered attachment URLs are rendered', () => {
    const h = harness(); h.actions.setChatAgentMode(true);
    h.session().conversationId = 'specific/id';
    h.session().snapshot = { messages: [{ role: 'assistant', content: '<img onerror=bad>', media: [{ attachmentId: 'safe/id', name: '<file>' }, { externalURL: 'javascript:bad' }] }] };
    const escapeHtml = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    const ui = createChatAgentComponents({ ...h.deps, escapeHtml });
    const html = ui.renderChatAgent();
    assert.match(html, /&lt;img onerror=bad&gt;/); assert.doesNotMatch(html, /javascript:bad|<img/);
    assert.match(html, /attachments\/safe%2Fid/);
    assert.match(html, /view=agent&amp;cid=specific%2Fid/);
    assert.match(html, /独立的新 Agent 会话/);
    assert.match(ui.renderChatAgentToggle(), /返回普通聊天/);
});

test('group limitation is scoped to conversion; rendering and selecting executors never make requests', () => {
    const h = harness(); h.actions.setChatAgentMode(true); h.actions.setChatAgentExecutor('claude');
    const ui = createChatAgentComponents({ ...h.deps, escapeHtml: String });
    assert.match(ui.renderChatAgent(), /data-chat-agent-executor/);
    const groupUi = createChatAgentComponents({ ...h.deps, escapeHtml: String, isGroupChatMode: () => true });
    assert.match(groupUi.renderChatAgentToggle(), /原群聊暂不直接转为 Agent 会话/);
    assert.doesNotMatch(groupUi.renderChatAgentToggle(), /Agent 暂不支持群聊/);
    h.state.connectionSwitcher = { busy: true };
    assert.match(ui.renderChatAgent(), /data-chat-agent-executor disabled/);
    assert.equal(h.requests.length, 0);
});

test('production generation factory, route context and click events expose Agent actions', async () => {
    const h = harness();
    const generation = createChatGenerationActions({ ...h.deps, showToast() {} });
    const context = createChatGenerationRouteContext(generation);
    const events = createChatMessageEvents({ ...h.deps, ...context, showToast: (_title, message) => assert.fail(message) });
    assert.equal(await events.handleChatMessageClick({ target: { closest: selector => selector === '[data-chat-agent-action]' ? { dataset: { chatAgentAction: 'agent' } } : null } }), true);
    assert.equal(getChatAgentState(h.state).sessions.get('hero.png').enabled, true);
    assert.equal(h.requests.length, 0);
});
