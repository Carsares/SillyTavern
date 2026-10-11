/* global globalThis */
import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM double: only what routes/chat-scroll.js reads. No browser or layout engine.
class FakeElement {
    constructor({ classes = [], data = {}, scrollHeight = 0, clientHeight = 0, children = [] } = {}) {
        this.classes = classes; this.dataset = data; this.scrollHeight = scrollHeight; this.clientHeight = clientHeight;
        this.children = children; this.parentElement = null; this.listeners = {}; this.top = 0; this.isConnected = true;
        for (const child of children) child.parentElement = this;
    }
    get scrollTop() { return this.top; }
    set scrollTop(value) { this.top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); }
    addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
    scrollBy(top) { this.scrollTop = top; for (const listener of this.listeners.scroll ?? []) listener({}); }
    matches(selector) {
        if (/^\.[\w-]+$/.test(selector)) return this.classes.includes(selector.slice(1));
        const attribute = selector.match(/^\[data-([\w-]+)\]$/);
        return Boolean(attribute) && attribute[1].replace(/-(\w)/g, (_, letter) => letter.toUpperCase()) in this.dataset;
    }
    closest(selector) {
        for (let element = this; element; element = element.parentElement) if (element.matches(selector)) return element;
        return null;
    }
    querySelector(selector) {
        for (const child of this.children) {
            const found = child.matches(selector) ? child : child.querySelector(selector);
            if (found) return found;
        }
        return null;
    }
}

const observed = [];
function withDom(action) {
    const previous = { HTMLElement: globalThis.HTMLElement, MutationObserver: globalThis.MutationObserver };
    globalThis.HTMLElement = FakeElement;
    globalThis.MutationObserver = class { constructor(callback) { this.callback = callback; } observe(target) { observed.push({ target, fire: this.callback }); } disconnect() {} };
    return Promise.resolve().then(action).finally(() => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
        }
    });
}

// The Agent panel's message list grows with its content; at desktop width .chat-thread scrolls.
function agentThread(key, scrollHeight) {
    const list = new FakeElement({ classes: ['message-list'], data: { chatAgentMessages: key }, scrollHeight: 300, clientHeight: 300 });
    const thread = new FakeElement({ classes: ['panel', 'chat-thread'], scrollHeight, clientHeight: 400, children: [new FakeElement({ children: [list] })] });
    return { thread, list };
}

test('Agent panel renders keep the reader position or the newest message in the scrolling chat thread', () => withDom(async () => {
    const { createChatScrollController } = await import('../../../../public/modern/routes/chat-scroll.js');
    let screen = null;
    const root = { querySelector: selector => screen?.querySelector(selector) ?? null, querySelectorAll: () => [] };
    const controller = createChatScrollController({ root });
    const renderInto = next => { controller.beforeRender(); screen = new FakeElement({ children: [next.thread] }); return Promise.resolve(); };

    // Entering the panel starts at the newest message.
    const first = agentThread('hero.png#c', 1000);
    await renderInto(first);
    assert.equal(first.thread.scrollTop, 600);

    // A reader who scrolled up stays there although render() replaced the whole thread.
    first.thread.scrollBy(120);
    const second = agentThread('hero.png#c', 1100);
    await renderInto(second);
    assert.equal(second.thread.scrollTop, 120);

    // Back at the bottom, a longer reply keeps the thread pinned to the newest message.
    second.thread.scrollBy(700);
    const third = agentThread('hero.png#c', 1500);
    await renderInto(third);
    assert.equal(third.thread.scrollTop, 1100);

    // Text written into the turn bubble without a render follows while pinned.
    third.thread.scrollHeight = 1600;
    observed.findLast(entry => entry.target === third.list).fire();
    assert.equal(third.thread.scrollTop, 1200);

    // Another Agent conversation starts at its newest message.
    const other = agentThread('hero.png#d', 900);
    third.thread.scrollBy(10);
    await renderInto(other);
    assert.equal(other.thread.scrollTop, 500);
}));

test('ordinary message list keeps scrolling itself rather than the chat thread', () => withDom(async () => {
    const { createChatScrollController } = await import('../../../../public/modern/routes/chat-scroll.js');
    const list = new FakeElement({ classes: ['message-list'], data: { messageList: '', chatKey: 'hero.png::chat', firstIndex: '0' }, scrollHeight: 2000, clientHeight: 500 });
    const thread = new FakeElement({ classes: ['chat-thread'], scrollHeight: 800, clientHeight: 400, children: [list] });
    let screen = null;
    const controller = createChatScrollController({ root: { querySelector: selector => screen?.querySelector(selector) ?? null, querySelectorAll: () => [] } });
    controller.beforeRender();
    screen = new FakeElement({ children: [thread] });
    await Promise.resolve();
    assert.equal(list.scrollTop, 1500);
    assert.equal(thread.scrollTop, 0);
}));
