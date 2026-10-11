import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDiagnostics } from '../../../../public/modern/conversation/diagnostics/view.js';
import { createChat } from '../../../../public/modern/conversation/chat/view.js';

// Minimal in-memory DOM double: no browser, network or application server.
class Element {
    constructor(tag = '', text = '') { this.tag = tag; this.text = text; this.children = []; this.listeners = {}; this.value = ''; this.disabled = false; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; this.text = ''; }
    addEventListener(name, action) { this.listeners[name] = action; }
    setAttribute(name, value) { this[name] = value; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.text = value; this.children = []; }
}
function withDOM(action) {
    const previous = { Node: globalThis.Node, document: globalThis.document };
    globalThis.Node = Element;
    globalThis.document = { createElement: tag => new Element(tag), createTextNode: text => new Element('', text) };
    return Promise.resolve().then(action).finally(() => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
        }
    });
}
const descendants = root => [root, ...root.children.flatMap(descendants)];
const snapshot = () => ({ conversation: { id: 'c', contentRevision: 3, memoryRevision: 2 }, messages: [] });
const report = { totals: { calls: 2, inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, reasoningTokens: 2, totalTokens: 15, costUsd: null, complete: false }, categories: { generation: { calls: 2 } }, turns: [{ turnId: 'partial-turn', calls: 1, totalTokens: null }] };
test('diagnostics displays independent aggregate and per-turn server fields with explicit unknown values', () => withDOM(async () => {
    const app = { id: () => 'c', state: { snapshot: snapshot() }, api: { usage: async () => report, traces: async () => [] }, run: action => action() };
    const view = createDiagnostics(app);
    await view.load();
    const tables = descendants(view.root).filter(node => node.tag === 'table');
    assert.equal(tables.length, 2);
    assert.match(tables[0].textContent, /总计生成记忆嵌入图像/);
    const total = descendants(tables[0]).find(node => node.tag === 'tr' && node.children[0].textContent === '总 tokens');
    assert.equal(total.children[1].textContent, '15');
    const cost = descendants(tables[0]).find(node => node.tag === 'tr' && node.children[0].textContent === '费用 USD');
    assert.equal(cost.children[1].textContent, '未知');
    assert.match(tables[1].textContent, /partial-turn1未知/);
}));
test('usage failure remains visible without hiding successful trace reads', () => withDOM(async () => {
    const view = createDiagnostics({ id: () => 'c', state: { snapshot: snapshot() }, api: { usage: async () => { throw new Error('offline'); }, traces: async () => [{ id: 'real-trace' }] } });
    await view.load();
    assert.match(view.root.textContent, /用量读取失败：offline/);
    assert.match(view.root.textContent, /real-trace/);
    assert.doesNotMatch(view.root.textContent, /暂无逐轮用量/);
}));
test('candidate panel survives event renders and selects candidateId with captured revision', () => withDOM(async () => {
    const snap = snapshot();
    snap.messages = [{ id: 'message', role: 'assistant', content: 'original', revision: 1, candidateId: 'current', candidateRevision: 1 }];
    let command;
    const app = { id: () => 'c', state: { snapshot: snap, turn: null, activity: [] }, run: action => action(), api: { candidates: async () => [{ id: 'message', candidateId: 'partial', candidateRevision: 2, content: 'partial reply', status: 'partial' }] }, applyCommand: (...args) => { command = args; } };
    const view = createChat(app); view.render();
    await descendants(view.root).find(node => node.tag === 'button' && node.textContent === '候选').listeners.click();
    const selection = descendants(view.root).find(node => node.tag === 'button' && node.textContent === '选用候选');
    assert.match(view.root.textContent, /部分回复/);
    view.render();
    assert.ok(descendants(view.root).includes(selection));
    await selection.listeners.click();
    assert.deepEqual(command, ['candidate.select', { messageId: 'message', candidateId: 'partial', candidateRevision: 2 }, snap]);
}));
test('independent source entry and its complete static module graph stay in served directories', async () => {
    const publicRoot = new URL('../../../../public/', import.meta.url);
    const entry = new URL('modern/conversation/index.html', publicRoot);
    const html = await readFile(entry, 'utf8');
    const visited = new Set();
    async function check(url) {
        if (visited.has(url.href)) return;
        visited.add(url.href);
        const relative = url.href.slice(publicRoot.href.length);
        assert.ok(url.href.startsWith(publicRoot.href) && /^(modern|shared)\/conversation\//.test(relative), relative);
        const source = await readFile(url, 'utf8');
        if (url.pathname.endsWith('.js')) {
            for (const match of source.matchAll(/(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g)) await check(new URL(match[1], url));
        }
    }
    const favicon = html.match(/<link rel="icon" href="([^"]+)"/);
    assert.ok(favicon?.[1].startsWith('data:image/svg+xml,'));
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
        if (match[1] === favicon[1]) continue;
        await check(new URL(match[1], entry));
    }
    assert.ok(visited.size > 15);
});

test('nested tool resultRefs expand persisted results safely and failures allow retry', () => withDOM(async () => {
    const { resultReferences, toolResultsView } = await import('../../../../public/modern/conversation/diagnostics/tools.js');
    const value = { events: [{ result: { resultRef: 'tool-id', preview: 'short' } }, { resultRef: 'tool-id' }] };
    assert.deepEqual(resultReferences(value), ['tool-id']);
    assert.deepEqual(resultReferences({ content: [{ type: 'text', text: JSON.stringify({ resultRef: 'wrapped' }) }, { type: 'text', text: 'resultRef ordinary text' }] }), ['wrapped']);
    let calls = 0;
    const view = toolResultsView({ api: { tool: async id => {
        assert.equal(id, 'tool-id');
        if (++calls === 1) throw new Error('offline');
        return { result: '<script>untrusted text</script>', apiKey: 'must-not-display' };
    } } }, value);
    const button = descendants(view).find(node => node.tag === 'button');
    await button.listeners.click();
    assert.match(view.textContent, /工具结果读取失败：offline/);
    assert.equal(button.disabled, false);
    await button.listeners.click();
    assert.match(view.textContent, /<script>untrusted text<\/script>/);
    assert.doesNotMatch(view.textContent, /must-not-display/);
    assert.equal(descendants(view).filter(node => node.tag === 'script').length, 0);
}));

test('sources locate current messages and read exact deleted historical candidate versions', () => withDOM(async () => {
    const { sourcesView } = await import('../../../../public/modern/conversation/memory/sources.js');
    const snap = snapshot();
    snap.messages = [{ id: 'm', revision: 3, candidateId: 'new', candidateRevision: 1 }];
    const ref = { messageId: 'm', revision: 1, candidateId: 'old', candidateRevision: 2 };
    let located;
    const app = { state: { snapshot: snap }, run: action => action(), locateMessage: (...args) => { located = args; }, api: { messageHistory: async (cid, mid) => {
        assert.deepEqual([cid, mid], ['c', 'm']);
        return { conversationId: cid, messageId: mid, deletedAt: 'date', versions: [{ id: mid, revision: 1, candidateId: 'old', candidateRevision: 2, content: 'original source' }] };
    } } };
    const view = sourcesView(app, { sourceRefs: [ref] });
    assert.match(view.textContent, /当前消息版本已变化/);
    await descendants(view).find(node => node.tag === 'button' && node.textContent === '定位当前消息').listeners.click();
    assert.deepEqual(located, ['c', 'm']);
    await descendants(view).find(node => node.tag === 'button' && node.textContent.startsWith('读取来源')).listeners.click();
    assert.match(view.textContent, /原消息已删除/);
    assert.match(view.textContent, /引用版本/);
    assert.match(view.textContent, /original source/);
}));
test('missing sources are not called deleted and failed history reads stay explicit and retryable', () => withDOM(async () => {
    const { sourcesView } = await import('../../../../public/modern/conversation/memory/sources.js');
    const view = sourcesView({ state: { snapshot: snapshot() }, api: { messageHistory: async () => { throw new Error('not found'); } } }, { sourceRefs: [{ messageId: 'missing', revision: 1 }] });
    const buttons = descendants(view).filter(node => node.tag === 'button');
    assert.equal(buttons[0].disabled, true);
    assert.match(view.textContent, /是否已删除需读取历史确认/);
    await buttons[1].listeners.click();
    assert.match(view.textContent, /来源读取失败：not found/);
    assert.equal(buttons[1].disabled, false);
}));
test('media displays attachment URLs while external URLs never produce image elements', () => withDOM(async () => {
    const { toolMediaView, mediaView } = await import('../../../../public/modern/conversation/media/view.js');
    const api = { attachmentUrl: id => `/api/conversation/v1/attachments/${id}` };
    const view = toolMediaView(api, { result: { media: [
        { type: 'image', attachmentId: 'real' },
        { type: 'image', external: true, url: 'https://example.com/image.png', mimeType: 'image/png' },
    ] } }, { real: { mime: 'image/png', name: 'persisted' } });
    const images = descendants(view).filter(node => node.tag === 'img');
    assert.equal(images.length, 1);
    assert.equal(images[0].src, '/api/conversation/v1/attachments/real');
    const external = descendants(view).find(node => node.tag === 'a' && node.href === 'https://example.com/image.png');
    assert.equal(external.rel, 'noopener noreferrer');
    assert.match(view.textContent, /未持久化/);
    const unsafe = mediaView(api, { external: true, url: 'javascript:alert(1)' });
    assert.equal(descendants(unsafe).filter(node => node.tag === 'a').length, 0);
}));
test('chat can focus current message without treating a missing message as found', () => withDOM(async () => {
    const snap = snapshot(); snap.messages = [{ id: 'm', role: 'user', content: 'source', revision: 1 }];
    const chat = createChat({ state: { snapshot: snap, turn: null, activity: [] } }); chat.render();
    const message = descendants(chat.root).find(node => node.className === 'message role-user');
    let focused = false; let scrolled = false;
    message.focus = () => { focused = true; }; message.scrollIntoView = () => { scrolled = true; };
    assert.equal(chat.focusMessage('m'), true);
    assert.ok(focused && scrolled);
    assert.equal(chat.focusMessage('missing'), false);
}));

test('message edit uploads replacement media and removal submits an empty array with the original revision', () => withDOM(async () => {
    const snap = snapshot(); snap.messages = [{ id: 'm', role: 'user', content: 'original', revision: 1, media: [{ attachmentId: 'old', type: 'image', mimeType: 'image/png' }] }];
    const commands = [];
    const app = { state: { snapshot: snap, turn: null, activity: [] }, run: action => action(),
        api: { attachmentUrl: id => `/attachments/${id}`, uploadAttachment: async body => {
            assert.equal(body.base64, 'AQI='); return { id: 'new', mime: 'text/plain', name: body.name, size: 2 };
        } }, applyCommand: async (...args) => { commands.push(args); } };
    const view = createChat(app); view.render();
    const click = label => descendants(view.root).find(node => node.tag === 'button' && node.textContent === label).listeners.click();
    click('编辑'); click('移除此附件');
    const file = descendants(view.root).find(node => node['aria-label'] === '编辑消息附件');
    file.files = [{ name: 'note.txt', type: 'text/plain', size: 2, arrayBuffer: async () => Uint8Array.from([1, 2]).buffer }];
    await click('上传并加入编辑');
    await click('保存修改');
    assert.equal(commands[0][0], 'message.edit'); assert.equal(commands[0][2], snap);
    assert.deepEqual(commands[0][1].media, [{ attachmentId: 'new', type: 'document', mimeType: 'text/plain', name: 'note.txt', size: 2 }]);
    assert.equal(snap.messages[0].media[0].attachmentId, 'old');
    click('编辑'); click('移除此附件'); await click('保存修改');
    assert.deepEqual(commands[1][1].media, []);
}));
test('memory creation refreshes versions while retaining an unsaved new draft', () => withDOM(async () => {
    const { createMemory } = await import('../../../../public/modern/conversation/memory/view.js');
    let pending; let command;
    const app = { state: { snapshot: snapshot(), turn: null }, run: action => { pending = action(); return pending; }, notice() {}, applyCommand: async (...args) => { command = args; } };
    const view = createMemory(app); view.render();
    const content = descendants(view.root).find(node => node['aria-label'] === '新记忆内容');
    content.value = 'keep this draft';
    app.state.snapshot = { ...snapshot(), conversation: { id: 'c', contentRevision: 8, memoryRevision: 9 } };
    view.render(); assert.equal(content.value, 'keep this draft');
    descendants(view.root).find(node => node.tag === 'form').listeners.submit({ preventDefault() {} }); await pending;
    assert.equal(command[0], 'memory.create'); assert.equal(command[1].content, 'keep this draft');
    assert.equal(command[2].conversation.memoryRevision, 9); assert.equal(command[2].conversation.contentRevision, 8);
}));
test('canonical external media stays a link; aliases and unmarked URLs are not rendered', () => withDOM(async () => {
    const { toolMediaView } = await import('../../../../public/modern/conversation/media/view.js');
    const view = toolMediaView({}, { images: [{ url: 'https://example.com/current', external: true }, { externalURL: 'https://example.com/named' }, { externalUrl: 'https://example.com/alias' }, { url: 'https://example.com/unmarked' }] });
    assert.equal(descendants(view).filter(node => node.tag === 'a').length, 1);
    assert.equal(descendants(view).filter(node => node.tag === 'img').length, 0);
}));
test('auxiliary selectors save exact settings keys and capability guidance uses actual provider fields', () => withDOM(async () => {
    const { createSettings } = await import('../../../../public/modern/conversation/settings/view.js');
    const { connectionGuidance } = await import('../../../../public/modern/conversation/resources/guidance.js');
    let pending; let saved;
    const app = { state: { snapshot: snapshot() }, id: () => 'c', notice() {}, run: action => { pending = action(); return pending; },
        api: { resources: async () => [{ id: 'aux', kind: 'connection', name: 'aux', revision: 1 }], automaticState: async () => ({ enabled: false }) },
        applyCommand: async (type, body) => { saved = body.settings; } };
    const view = createSettings(app); await view.load();
    const selects = descendants(view.root).filter(node => node.tag === 'select');
    for (const control of selects.slice(5)) control.value = 'aux';
    descendants(view.root).find(node => node.tag === 'form').onsubmit({ preventDefault() {} }); await pending;
    for (const key of ['auxiliaryConnectionId', 'embeddingConnectionId', 'imageConnectionId']) assert.equal(saved[key], 'aux');
    const text = connectionGuidance().textContent;
    for (const field of ['reasoningBudget', 'reasoningEfforts', 'mediaTokenCost', 'verified', 'embedding']) assert.ok(text.includes(field));
    assert.match(text, /不会自动写入/);
}));

test('conflicting message media edits retain the staged removal and text for review', () => withDOM(async () => {
    const snap = snapshot(); snap.messages = [{ id: 'm', role: 'user', content: 'before', revision: 1, media: [{ attachmentId: 'old', type: 'image', mimeType: 'image/png' }] }];
    const app = { state: { snapshot: snap, turn: null, activity: [] }, run: action => action(), api: { attachmentUrl: id => `/attachments/${id}` }, applyCommand: async () => { throw new Error('revision-conflict'); } };
    const view = createChat(app); view.render();
    const click = label => descendants(view.root).find(node => node.tag === 'button' && node.textContent === label).listeners.click();
    click('编辑'); click('移除此附件');
    const editor = descendants(view.root).find(node => node['aria-label'] === '编辑消息');
    editor.value = 'edited'; editor.listeners.input({ target: editor });
    await assert.rejects(click('保存修改'), /revision-conflict/);
    view.render();
    assert.ok(descendants(view.root).includes(editor));
    assert.equal(editor.value, 'edited');
    assert.equal(descendants(view.root).filter(node => node.tag === 'button' && node.textContent === '移除此附件').length, 0);
    assert.equal(snap.messages[0].media.length, 1);
}));

test('summary edit uses summary identity and captured block revision and retains conflicting drafts', () => withDOM(async () => {
    const { createMemory } = await import('../../../../public/modern/conversation/memory/view.js');
    const snap = snapshot(); snap.summaries = [{ id: 'summary', revision: 4, status: 'valid', content: 'before', sourceRefs: [] }];
    let command;
    const app = { state: { snapshot: snap, turn: null }, run: action => action(), applyCommand: async (...args) => { command = args; throw new Error('conflict'); } };
    const view = createMemory(app); view.render();
    const editor = descendants(view.root).find(node => node['aria-label'] === '摘要内容');
    assert.equal(editor.disabled, false); editor.value = 'manual summary'; editor.listeners.input({ target: editor });
    app.state.snapshot = { ...snap, summaries: [{ ...snap.summaries[0], revision: 5 }] }; view.render();
    const save = descendants(view.root).find(node => node.tag === 'button' && node.textContent === '保存摘要');
    await assert.rejects(save.listeners.click(), /conflict/);
    assert.deepEqual(command, ['summary.edit', { summaryId: 'summary', expectedBlockRevision: 4, content: 'manual summary' }]);
    view.render(); assert.equal(descendants(view.root).find(node => node['aria-label'] === '摘要内容').value, 'manual summary');
}));
test('user-hidden message remains reversible independently of folds', () => withDOM(async () => {
    const snap = snapshot(); snap.messages = [{ id: 'm', role: 'user', content: 'hidden text', revision: 1, userHidden: true }];
    let command;
    const app = { state: { snapshot: snap, turn: null, activity: [] }, command: (...args) => { command = args; } };
    const view = createChat(app); view.render();
    assert.match(view.root.textContent, /独立于自动折叠/);
    const show = descendants(view.root).find(node => node.tag === 'button' && node.textContent === '取消用户隐藏');
    show.listeners.click(); assert.deepEqual(command, ['message.hide', { messageId: 'm', hidden: false }]);
}));
test('image jobs never offer resubmission without a handle and query only when idle', () => withDOM(async () => {
    const { jobView, imageJobState } = await import('../../../../public/modern/conversation/jobs/view.js');
    const job = { id: 'job', conversationId: 'c', kind: 'provider-request', dependencies: { kind: 'image' }, payload: { state: 'unknown' } };
    const app = { id: () => 'c', state: { snapshot: snapshot(), turn: null }, run: action => action(), notice() {}, api: {} };
    assert.equal(imageJobState(job, app.state).actionable, false);
    const unknown = jobView(app, job, async () => {});
    assert.match(unknown.textContent, /不能重新提交/);
    assert.ok(descendants(unknown).filter(node => node.tag === 'button').every(node => node.disabled));
    job.payload.jobId = 'persisted-handle';
    assert.equal(imageJobState(job, { ...app.state, turn: { status: 'generating' } }).actionable, false);
    let calls = 0; app.api.resumeJob = async (...args) => { assert.deepEqual(args, ['c', 'job']); calls++; return { state: 'running' }; };
    const view = jobView(app, job, async () => {});
    await descendants(view).find(node => node.tag === 'button' && node.textContent.startsWith('查询')).listeners.click();
    assert.equal(calls, 1);
    job.payload.state = 'completed'; job.payload.result = { media: [{ type: 'image', attachmentId: 'real', mimeType: 'image/png' }] };
    app.api.attachmentUrl = id => `/attachments/${id}`;
    const complete = jobView(app, job, async () => {});
    assert.equal(descendants(complete).find(node => node.tag === 'img').src, '/attachments/real');
    assert.ok(descendants(complete).filter(node => node.tag === 'button').every(node => node.disabled));
}));

test('index not-ready and error states are visible without claiming semantic success', () => withDOM(async () => {
    const { indexStatusView } = await import('../../../../public/modern/conversation/retrieval/view.js');
    const pending = indexStatusView({ status: 'not-ready', semanticReady: false, count: 0 });
    assert.match(pending.textContent, /语义索引未就绪/);
    assert.match(pending.textContent, /关键词检索仍可用/);
    const error = indexStatusView({ status: 'error', semanticReady: false, error: { code: 'index-failed', message: 'embedding failed' } });
    assert.match(error.textContent, /embedding failed/);
    assert.match(error.textContent, /语义索引失败/);
    assert.throws(() => indexStatusView(null));
}));
test('changing retention invalidates the old cleanup preview token', () => withDOM(async () => {
    const { createMaintenance } = await import('../../../../public/modern/conversation/maintenance/view.js');
    const calls = [];
    const app = { id: () => 'c', run: action => action(), api: { maintenance: async (action, body) => { calls.push([action, body]); return { token: 'private-token', entries: [], traces: [{ id: 't' }], bytes: 0 }; } } };
    const view = createMaintenance(app);
    const click = label => descendants(view.root).find(node => node.tag === 'button' && node.textContent === label).listeners.click();
    await click('查看清理预览');
    assert.deepEqual(calls[0], ['cleanup-preview', { traceRetentionMs: 2592000000 }]);
    assert.match(view.root.textContent, /轨迹明细 1 项/);
    assert.doesNotMatch(view.root.textContent, /private-token/);
    const retention = descendants(view.root).find(node => node['aria-label'] === '轨迹明细保留天数');
    retention.value = '0'; retention.listeners.input();
    await assert.rejects(click('执行已预览的清理'), /预览/);
    assert.equal(calls.length, 1);
}));

test('proxy controls never echo secrets, blank preserves, explicit clear sends null', () => withDOM(async () => {
    const { createResources } = await import('../../../../public/modern/conversation/resources/view.js');
    const resource = { id: 'r', kind: 'connection', name: 'local', revision: 1, data: { provider: 'openai', executor: 'pi', type: 'chat', model: 'local', proxy: { url: 'http://secret:password@localhost:3128' } } };
    let pending; const writes = [];
    const app = { run: action => { pending = action(); return pending; }, notice() {}, api: { resources: async () => [resource], resource: async () => resource, updateResource: async (id, body) => { writes.push(body); } } };
    const view = createResources(app); await view.load();
    const click = text => descendants(view.root).find(node => node.tag === 'button' && node.textContent === text).listeners.click();
    const submit = async () => { descendants(view.root).find(node => node.tag === 'form').listeners.submit({ preventDefault() {} }); await pending; };
    await click('编辑');
    assert.doesNotMatch(view.root.textContent, /secret:password/);
    let proxy = descendants(view.root).find(node => node['aria-label'] === '代理 URL（只写）');
    assert.equal(proxy.value, ''); await submit(); assert.equal(Object.hasOwn(writes[0].data, 'proxy'), false);
    await click('编辑'); proxy = descendants(view.root).find(node => node['aria-label'] === '代理 URL（只写）');
    proxy.value = 'http://user:pass@localhost:3128'; await submit();
    assert.deepEqual(writes[1].data.proxy, { url: 'http://user:pass@localhost:3128' }); assert.equal(proxy.value, '');
    await click('编辑'); descendants(view.root).find(node => node['aria-label'] === '清除已保存代理').checked = true;
    await submit(); assert.equal(writes[2].data.proxy, null);
}));

test('storage status labels logical UTF-8 bytes and preserves unknown values', () => withDOM(async () => {
    const { storageStatusView } = await import('../../../../public/modern/conversation/maintenance/view.js');
    const view = storageStatusView({ traceCount: 2, traceBytes: 128, detailBytes: 0 });
    assert.match(view.textContent, /轨迹数量：2 · 轨迹逻辑字节：128 · 明细逻辑字节：0/);
    assert.match(view.textContent, /不代表 SQLite/);
    assert.match(storageStatusView({}).textContent, /轨迹数量：未知/);
}));
test('retrieval event supersedes pending reads and conversation changes discard stale responses', () => withDOM(async () => {
    const { createRetrievalStatus } = await import('../../../../public/modern/conversation/retrieval/view.js');
    let resolve;
    const app = { state: { snapshot: snapshot() }, api: { retrievalStatus: () => new Promise(done => { resolve = done; }) } };
    const view = createRetrievalStatus(app);
    const pending = view.load();
    view.onEvent({ type: 'retrieval.updated', conversationId: 'c', payload: { status: 'ready', semanticReady: true, count: 5 } });
    resolve({ status: 'indexing', semanticReady: false, count: 1 }); await pending;
    assert.match(view.root.textContent, /语义索引已就绪/);
    const next = view.load(); view.clear(); app.state.snapshot.conversation.id = 'other';
    resolve({ status: 'ready', semanticReady: true, count: 5 }); await next;
    assert.doesNotMatch(view.root.textContent, /语义索引已就绪/);
    app.api.retrievalStatus = async () => { throw new Error('offline'); }; await view.load();
    assert.match(view.root.textContent, /索引状态未知：offline/);
}));

test('settings preserve supported tool maps, write canonical arrays and reject auxiliary objects', () => withDOM(async () => {
    const { createSettings } = await import('../../../../public/modern/conversation/settings/view.js');
    const snap = snapshot(); snap.settings = { tools: { recall_memory: true } };
    let pending, writes = 0, saved;
    const app = { state: { snapshot: snap }, id: () => 'c', notice() {}, run: action => { pending = action(); return pending; },
        api: { resources: async () => [], automaticState: async () => ({ enabled: false }) },
        applyCommand: async (_type, body) => { writes++; saved = body.settings; } };
    const view = createSettings(app); await view.load();
    descendants(view.root).find(node => node.tag === 'form').onsubmit({ preventDefault() {} }); await pending;
    assert.deepEqual(saved.tools, ['recall_memory']);
    assert.equal(writes, 1);
    assert.doesNotMatch(view.root.textContent, /连接级配置|继承主连接 auxiliary/);
    const extra = descendants(view.root).find(node => node['aria-label'] === '高级会话设置');
    extra.value = JSON.stringify({ auxiliary: { memory: 'obsolete' } });
    descendants(view.root).find(node => node.tag === 'form').onsubmit({ preventDefault() {} });
    await assert.rejects(pending, /auxiliaryConnectionId/);
    assert.equal(writes, 1);
}));

test('candidate records require candidate identity rather than message identity aliases', () => withDOM(async () => {
    const snap = snapshot(); snap.messages = [{ id: 'm', role: 'assistant', content: 'reply', revision: 1, candidateId: 'current', candidateRevision: 1 }];
    const app = { id: () => 'c', state: { snapshot: snap, turn: null, activity: [] }, run: action => action(),
        api: { candidates: async () => [{ id: 'old-shape', revision: 1, content: 'invalid' }] } };
    const view = createChat(app); view.render();
    const control = descendants(view.root).find(node => node.tag === 'button' && node.textContent.includes('候选'));
    await assert.rejects(control.listeners.click(), /candidateId/);
}));

test('connection editor preserves canonical reasoning and media fields in flat resource data', () => withDOM(async () => {
    const { createResources } = await import('../../../../public/modern/conversation/resources/view.js');
    const resource = { id: 'conn', kind: 'connection', name: 'Google', revision: 1, data: { provider: 'google', executor: 'pi', type: 'chat', model: 'test', baseUrl: 'https://example.invalid',
        reasoning: 'budget', reasoningBudget: 1024, capabilities: { media: ['text', 'video'], mediaTokenCost: { video: 4096 }, verified: false } } };
    let pending, saved;
    const app = { run: action => { pending = action(); return pending; }, notice() {}, api: { resources: async () => [resource], resource: async () => resource,
        updateResource: async (_id, body) => { saved = body.data; } } };
    const view = createResources(app); await view.load();
    await descendants(view.root).find(node => node.tag === 'button' && node.textContent === '编辑').listeners.click();
    const text = view.root.textContent;
    assert.match(text, /字符串 reasoning/); assert.match(text, /capabilities.mediaTokenCost/);
    assert.doesNotMatch(text, /reasoning\.effort|使用 effort/);
    descendants(view.root).find(node => node.tag === 'form').listeners.submit({ preventDefault() {} }); await pending;
    assert.equal(saved.reasoning, 'budget'); assert.equal(saved.reasoningBudget, 1024);
    assert.deepEqual(saved.capabilities, resource.data.capabilities);
    assert.equal(Object.hasOwn(saved, 'data'), false); assert.equal(Object.hasOwn(saved, 'mediaTokenCost'), false);
}));

test('default tool selection still enables four read-only utilities and leaves paid/write tools off', () => withDOM(async () => {
    const { createSettings } = await import('../../../../public/modern/conversation/settings/view.js');
    let pending, saved;
    const app = { state: { snapshot: snapshot() }, id: () => 'c', notice() {}, run: action => { pending = action(); return pending; },
        api: { resources: async () => [], automaticState: async () => ({ enabled: false }) }, applyCommand: async (_type, body) => { saved = body.settings; } };
    const view = createSettings(app); await view.load();
    descendants(view.root).find(node => node.tag === 'form').onsubmit({ preventDefault() {} }); await pending;
    assert.deepEqual(saved.tools, ['recall_memory', 'search_lore', 'roll_dice', 'get_time']);
}));
