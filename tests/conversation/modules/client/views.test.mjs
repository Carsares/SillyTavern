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
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) await check(new URL(match[1], entry));
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
        { type: 'image', externalURL: 'https://example.com/image.png', mimeType: 'image/png' },
    ] } }, { real: { mime: 'image/png', name: 'persisted' } });
    const images = descendants(view).filter(node => node.tag === 'img');
    assert.equal(images.length, 1);
    assert.equal(images[0].src, '/api/conversation/v1/attachments/real');
    const external = descendants(view).find(node => node.tag === 'a' && node.href === 'https://example.com/image.png');
    assert.equal(external.rel, 'noopener noreferrer');
    assert.match(view.textContent, /未持久化/);
    const unsafe = mediaView(api, { externalURL: 'javascript:alert(1)' });
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
