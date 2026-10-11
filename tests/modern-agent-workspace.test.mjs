import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { routes, routeLabels } from '../public/modern/core/constants.js';
import { createAgentRoute } from '../public/modern/routes/agent.js';
import { createAgentWorkspaceHost } from '../public/modern/components/agent-workspace.js';
import { createRenderer } from '../public/modern/shell/renderer.js';
import { createRouter } from '../public/modern/shell/router.js';
import { agentWorkspaceUrl, initialAgentConversation } from '../public/modern/core/agent-navigation.js';

const originalRoutes = ['dashboard', 'chat', 'characters', 'groups', 'worldbooks', 'presets', 'personas', 'assets', 'remoteResources', 'api', 'extensions', 'activity', 'settings'];
const source = file => readFile(new URL(`../public/modern/${file}`, import.meta.url), 'utf8');

// Minimal DOM implementation: no browser, app server, network or provider calls.
function contentFixture() {
    const hosts = [];
    const document = { createElement() {
        const listeners = {};
        const frame = { addEventListener: (type, fn) => { listeners[type] = fn; }, contentDocument: { querySelector: () => ({}) } };
        const status = { hidden: false };
        return { style: {}, hidden: false, writes: 0, focusCount: 0, frame, status, listeners,
            setAttribute(name, value) { this[name] = value; },
            focus() { this.focusCount++; },
            set innerHTML(value) { this.markup = value; this.writes++; },
            querySelector(selector) { return selector === 'iframe' ? frame : status; },
        };
    } };
    const content = { ownerDocument: document, style: { display: 'grid' }, hidden: false, innerHTML: '', focus() {},
        insertAdjacentElement(position, host) { assert.equal(position, 'afterend'); hosts.push(host); } };
    return { content, hosts };
}

test('Agent is additive to every original Modern page and the existing route registry', async () => {
    assert.deepEqual(routes.filter(route => route.id !== 'agent').map(route => route.id), originalRoutes);
    assert.equal(routes.length, 14); assert.equal(routeLabels.agent, 'Agent 会话');
    const registry = await source('shell/routes.js');
    for (const route of originalRoutes) assert.match(registry, new RegExp(`${route}: create\\w+Route\\(routeContext\\)`));
    assert.match(registry, /agent: createAgentRoute\(\)/);
    // Sidebar and command palette derive their entries from this same registry.
    for (const file of ['shell/nav.js', 'shell/palette.js']) assert.match(await source(file), /routes\.map\(/);
});

test('Agent route hosts the complete same-origin client and exposes a standalone alternative', async () => {
    const markup = createAgentRoute().render();
    assert.match(markup, /<h1>Agent 会话<\/h1>/);
    assert.match(markup, /<iframe[^>]+src="\/modern\/conversation\/"[^>]+title="Agent 会话工作区"/);
    assert.match(markup, /target="_blank" rel="noopener noreferrer"/);
    assert.doesNotMatch(markup, /apiKey|postMessage|sessionStorage|localStorage/);
    const html = await source('conversation/index.html');
    assert.match(html, /href="\/modern\/\?view=agent" target="_top"/);
    assert.match(html, /src="\.\/app.js"/);
    assert.match(await source('index.html'), /routes\/agent.css/);
});

test('shell redraws and route switches retain the connected iframe and unsent client state', () => {
    const { content, hosts } = contentFixture();
    const state = { route: 'agent', loading: true, loaded: false, errors: [] };
    const rendered = [];
    const routeRenderers = Object.fromEntries(originalRoutes.map(route => [route, () => { rendered.push(route); return `<p>${route}</p>`; }]));
    routeRenderers.agent = createAgentRoute().render;
    const renderer = createRenderer({ state, elements: { content }, routeRenderers, renderLoading: () => 'loading', renderRouteErrorBanner: () => '' });
    renderer.renderContent();
    assert.equal(hosts.length, 1); assert.equal(content.hidden, true);
    const host = hosts[0], frame = host.frame;
    frame.unsentDraft = 'keep my draft';
    renderer.renderContent(); renderer.renderContent();
    assert.equal(host.writes, 1); assert.equal(host.focusCount, 1);
    state.loading = false; state.loaded = true;
    for (const route of originalRoutes) {
        state.route = route; renderer.renderContent();
        assert.equal(content.innerHTML, `<p>${route}</p>`);
        assert.equal(content.hidden, false); assert.equal(content.style.display, 'grid');
        assert.equal(host.hidden, true);
    }
    assert.deepEqual(rendered, originalRoutes);
    state.route = 'agent'; renderer.renderContent();
    assert.equal(hosts.length, 1); assert.equal(host.writes, 1);
    assert.equal(host.frame, frame); assert.equal(frame.unsentDraft, 'keep my draft');
    assert.equal(host.hidden, false);
});

test('workspace exposes embedding failures without replacing Modern navigation', () => {
    const { content, hosts } = contentFixture();
    const host = createAgentWorkspaceHost(content);
    host.show(createAgentRoute().render());
    const node = hosts[0];
    node.listeners.load(); assert.equal(node.status.hidden, true);
    node.frame.contentDocument = null;
    node.listeners.load(); assert.equal(node.status.hidden, false); assert.match(node.status.textContent, /新标签页/);
    node.listeners.error(); assert.match(node.status.textContent, /加载失败/);
    host.hide(); assert.equal(content.hidden, false);
});

test('deep links forward only an encoded cid into both Agent entry points', () => {
    const id = '\"<&/中文?x=1#fragment';
    const search = `?view=agent&unrelated=secret&${new URLSearchParams({ cid: id })}`;
    const url = agentWorkspaceUrl(search);
    assert.equal(new URL(url, 'http://local.test').searchParams.get('cid'), id);
    assert.doesNotMatch(url, /unrelated|secret|["<>]/);
    const markup = createAgentRoute().render(search);
    assert.ok(markup.includes(`src="${url}"`));
    assert.ok(markup.includes(`href="${url}"`));
    assert.equal(agentWorkspaceUrl('?view=agent'), '/modern/conversation/');
    assert.equal(agentWorkspaceUrl('?cid='), '/modern/conversation/?cid=');
});

test('initial selection requires API list membership and preserves ordinary saved selection', async () => {
    const conversations = [{ id: 'requested' }, { id: 'saved' }];
    assert.equal(initialAgentConversation(conversations, 'requested', 'saved'), 'requested');
    for (const id of ['unknown', '']) {
        assert.throws(() => initialAgentConversation(conversations, id, 'saved'), /不存在或当前用户无权访问/);
    }
    assert.throws(() => initialAgentConversation([], 'requested', null), /不存在/);
    assert.equal(initialAgentConversation(conversations, null, 'saved'), 'saved');
    assert.equal(initialAgentConversation(conversations, null, 'missing'), null);
    assert.equal(initialAgentConversation(conversations, null, null), null);
    const app = await source('conversation/app.js');
    const startup = app.slice(app.lastIndexOf('void app.run'));
    assert.ok(startup.indexOf('await app.reloadConversations()') < startup.indexOf('initialAgentConversation('));
    assert.match(startup, /if \(selected\) await app.choose\(selected\)/);
    assert.doesNotMatch(startup, /createConversation/);
    assert.match(app, /requireSnapshot\(await this.api.snapshot\(id\), id\)/);
});

test('a stale shell cid never resets navigation inside an already mounted iframe', () => {
    const { content, hosts } = contentFixture();
    const host = createAgentWorkspaceHost(content);
    host.show(createAgentRoute().render('?cid=initial'));
    const node = hosts[0];
    node.frame.selectedConversation = 'user-selected';
    host.show(createAgentRoute().render('?cid=initial'));
    host.hide();
    host.show(createAgentRoute().render('?cid=other'));
    assert.equal(node.writes, 1);
    assert.equal(node.frame.selectedConversation, 'user-selected');
    assert.match(node.markup, /src="\/modern\/conversation\/\?cid=initial"/);
});

test('normal Modern routing reaches Agent and returns to dashboard without invoking chat preparation', async () => {
    const previous = globalThis.window;
    const visited = [];
    globalThis.window = { location: { href: 'http://local.test/modern/?view=dashboard' }, history: { replaceState(_state, _title, url) { visited.push(url.searchParams.get('view')); } } };
    try {
        const state = { route: 'dashboard' };
        let prepared = 0, rendered = 0;
        const router = createRouter({ state, elements: { content: { focus() {} }, app: { querySelector: () => null } }, routeModules: {},
            render: () => { rendered++; }, prepareChatForSelectedContext: () => { prepared++; }, selectLatestUnreadChatTarget() {} });
        for (const route of ['agent', 'dashboard']) {
            const button = { dataset: { route } };
            await router.handleClick({ target: { closest: selector => selector === 'button[data-route], a[data-route]' ? button : null } });
            assert.equal(state.route, route);
        }
        assert.deepEqual(visited, ['agent', 'dashboard']); assert.equal(rendered, 2); assert.equal(prepared, 0);
    } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});
