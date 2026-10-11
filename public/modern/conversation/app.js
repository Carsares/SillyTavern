import { createClient, subscribe } from './core/client.js';
import { initialState, hydrate, reduceEvent, turnRequest, versionedCommand, terminal, list } from './core/state.js';
import { el, button, input, empty } from './core/dom.js';
import { createChat } from './chat/view.js';
import { createResources } from './resources/view.js';
import { createMemory } from './memory/view.js';
import { createSettings } from './settings/view.js';
import { createDiagnostics } from './diagnostics/view.js';
import { createMaintenance } from './maintenance/view.js';

const read = key => { try { return sessionStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { value == null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, value); } catch { /* Server remains authoritative when storage is unavailable. */ } };
const app = {
    api: createClient(), state: initialState(), conversations: [], currentTab: 'chat', epoch: 0,
    id() { if (!this.state.snapshot) throw new Error('请先选择会话'); return this.state.snapshot.conversation.id; },
    notice(text) { this.state.notice = text; renderStatus(); },
    async run(action) {
        if (this.state.busy) return;
        this.state.busy = true; this.state.error = ''; this.state.notice = ''; renderStatus();
        try { return await action(); } catch (error) {
            this.state.error = `${error.code ? `${error.code}: ` : ''}${error.message}`;
            if (error.status === 409) this.state.error += '\n版本冲突：请重新读取最新状态，检查后再提交。';
        } finally { this.state.busy = false; renderStatus(); }
    },
    async reloadConversations() {
        this.conversations = list(await this.api.conversations(), 'conversations'); renderList();
    },
    async choose(id) {
        disconnect?.(); clearTimeout(refreshTimer); refreshTimer = null; refreshHint = null; this.epoch++; this.refreshSerial = 0;
        this.state = { ...initialState(), busy: this.state.busy };
        chat.clearDraft(); render();
        const epoch = this.epoch;
        const snapshot = await this.api.snapshot(id);
        if (epoch !== this.epoch) return;
        let persisted = null;
        try { persisted = JSON.parse(read(`conversation.pending.${id}`) || 'null'); } catch { /* Ignore corrupt browser state. */ }
        this.state.pending = persisted;
        this.state.snapshot = snapshot;
        write('conversation.selected', id);
        // Recover server-persisted active work; a saved turn ID also recovers terminal drafts.
        const turnId = snapshot.conversation.activeTurnId || read(`conversation.turn.${id}`) || snapshot.messages?.at(-1)?.turnId;
        if (turnId) {
            try {
                const turn = await this.api.turn(turnId);
                if (turn.conversationId !== id) throw new Error('轮次不属于当前会话');
                this.state.turn = turn;
            } catch (error) { this.state.error = `恢复轮次失败：${error.message}`; }
        }
        render();
        disconnect = subscribe(this.api, id, {
            onReset: async () => {
                if (epoch !== this.epoch) return;
                await this.refresh();
                if (epoch !== this.epoch) return;
                this.state.cursor = 0; this.state.activity = [];
            },
            onEvent: event => {
                if (epoch !== this.epoch) return;
                this.state = reduceEvent(this.state, event);
                settings.onEvent(event);
                if (event.turnId) refreshHint = event.turnId;
                if (this.state.needsRefresh) {
                    if (!refreshTimer) refreshTimer = setTimeout(() => {
                        refreshTimer = null;
                        if (epoch !== this.epoch) return;
                        const hint = refreshHint; refreshHint = null;
                        this.refresh(hint).catch(error => { if (epoch !== this.epoch) return; this.state.error = `刷新失败：${error.message}`; renderStatus(); });
                    }, 120);
                }
                chat.render();
                if (this.currentTab === 'memory' && (event.type === 'job.updated' || event.type === 'memory.updated')) memory.render();
            },
            onStatus: (status, error) => {
                if (epoch !== this.epoch) return;
                this.state.stream = status;
                this.state.streamError = error?.message || '';
                renderStatus();
            },
        });
        renderList();
        await activate(this.currentTab, false);
    },
    async refresh(hintTurnId) {
        if (!this.state.snapshot) return;
        const epoch = this.epoch;
        const serial = this.refreshSerial = (this.refreshSerial || 0) + 1;
        const id = this.id();
        const snapshot = await this.api.snapshot(id);
        const turnId = snapshot.conversation.activeTurnId || hintTurnId || this.state.turn?.id;
        const turn = turnId ? await this.api.turn(turnId) : null;
        if (epoch !== this.epoch || serial !== this.refreshSerial) return;
        if (turn && turn.conversationId !== id) throw new Error('轮次不属于当前会话');
        const oldRevision = this.state.snapshot?.conversation.memoryRevision;
        const wasActive = this.state.snapshot?.conversation.activeTurnId;
        this.state = hydrate(this.state, snapshot, turn);
        this.state.needsRefresh = false;
        if (turn) write(`conversation.turn.${id}`, turn.id);
        renderStatus(); chat.render();
        if ((oldRevision !== snapshot.conversation.memoryRevision || wasActive !== snapshot.conversation.activeTurnId) && this.currentTab === 'memory') memory.render();
    },
    async start(type, content = '', targetMessageId, options = {}) {
        if (!terminal(this.state.turn) || this.state.snapshot?.conversation.activeTurnId) throw new Error('请等待或停止当前轮次');
        if (this.state.pending) throw new Error('请先重试结果未知的原请求');
        const request = turnRequest(this.state.snapshot, type, content, targetMessageId, crypto.randomUUID(), options);
        this.state.pending = request;
        write(`conversation.pending.${this.id()}`, JSON.stringify(request));
        await this.retry();
    },
    async retry() {
        const id = this.id();
        const request = this.state.pending;
        if (!request) return;
        let accepted;
        try { accepted = await this.api.start(id, request); } catch (error) {
            // A structured 4xx rejection proves non-acceptance; network/5xx remains uncertain.
            if (error.status >= 400 && error.status < 500 && error.code !== 'invalid-response') {
                this.state.pending = null; write(`conversation.pending.${id}`, null);
            }
            chat.render(); throw error;
        }
        if (!accepted?.turnId) throw new Error('服务器未返回轮次编号，发送结果待确认');
        write(`conversation.turn.${id}`, accepted.turnId);
        this.state.pending = null; write(`conversation.pending.${id}`, null);
        await this.refresh(accepted.turnId);
        chat.render();
    },
    async applyCommand(type, fields, snapshot = this.state.snapshot) {
        if (!terminal(this.state.turn) || this.state.snapshot?.conversation.activeTurnId) throw new Error('生成期间不能修改会话内容');
        await this.api.command(this.id(), versionedCommand(snapshot, type, fields));
        await this.refresh();
        if (this.currentTab === 'memory') memory.render();
    },
    command(type, fields) { return this.run(() => this.applyCommand(type, fields)); },
};
let disconnect;
let refreshTimer;
let refreshHint;
const chat = createChat(app);
const resources = createResources(app);
const memory = createMemory(app);
const settings = createSettings(app);
const diagnostics = createDiagnostics(app);
const maintenance = createMaintenance(app);
const panels = { chat, resources, memory, settings, diagnostics, maintenance };
const labels = { chat: '对话', resources: '资源', memory: '记忆', settings: '设置', diagnostics: '轨迹', maintenance: '维护' };
const title = input('', { placeholder: '新会话名称', 'aria-label': '新会话名称' });
const rows = el('div', { class: 'conversation-list' });
const status = el('small', { role: 'status', 'aria-live': 'polite' });
const error = el('div', { class: 'banner error', role: 'alert' });
const notice = el('div', { class: 'banner', role: 'status' });
const panelRoot = el('fieldset', { class: 'panel-root' });
const navigation = el('nav', { 'aria-label': '功能导航' });
const sidebar = el('aside', { class: 'sidebar' }, el('h2', {}, '会话'), title,
    button('创建', () => app.run(async () => {
        const result = await app.api.createConversation({ title: title.value.trim() || '新会话', settings: {} });
        const id = result.conversation?.id || result.id;
        if (!id) throw new Error('服务器没有返回会话编号');
        title.value = ''; await app.reloadConversations(); await app.choose(id);
    })), button('刷新列表', () => app.run(() => app.reloadConversations())), rows,
);
const main = el('main', {}, el('header', { class: 'topbar' }, el('h1', {}, 'Modern · Conversation'), status,
    button('重新读取会话', () => app.run(async () => { await app.refresh(); await activate(app.currentTab, false); }))), navigation, error, notice, panelRoot);
document.querySelector('#conversation-app').replaceChildren(el('div', { class: 'shell' }, sidebar, main));
for (const [id, label] of Object.entries(labels)) navigation.append(button(label, () => app.run(() => activate(id))));
async function activate(id, setTab = true) {
    if (setTab) app.currentTab = id;
    panelRoot.replaceChildren(panels[id].root);
    [...navigation.children].forEach((node, index) => node.setAttribute('aria-current', Object.keys(labels)[index] === id ? 'page' : 'false'));
    if (panels[id].load) await panels[id].load();
    if (panels[id].render) panels[id].render();
}
function renderStatus() {
    const stream = { disconnected: '未连接', connecting: '连接中', connected: '事件已同步', reconnecting: '连接断开，正在重连' }[app.state.stream];
    status.textContent = `${app.state.busy ? '处理中 · ' : ''}${stream}${app.state.streamError ? ` · ${app.state.streamError}` : ''}`;
    error.textContent = app.state.error;
    notice.textContent = app.state.notice;
    panelRoot.disabled = app.state.busy;
    chat.updateControls();
    main.setAttribute('aria-busy', String(app.state.busy));
}
function renderList() {
    rows.replaceChildren(...(app.conversations.length ? app.conversations.map(conversation => el('div', {},
        el('button', { type: 'button', class: conversation.id === app.state.snapshot?.conversation.id ? 'selected' : '', onclick: () => app.run(() => app.choose(conversation.id)) }, conversation.title || conversation.id),
        button('删除会话', () => app.run(async () => {
            if (!confirm(`永久删除会话“${conversation.title || conversation.id}”？`)) return;
            const snapshot = await app.api.snapshot(conversation.id);
            await app.api.deleteConversation(conversation.id, snapshot.conversation.contentRevision);
            if (app.state.snapshot?.conversation.id === conversation.id) {
                disconnect?.(); clearTimeout(refreshTimer); refreshTimer = null; app.epoch++; app.state = { ...initialState(), busy: true };
                chat.clearDraft(); write('conversation.selected', null); render();
            }
            write(`conversation.pending.${conversation.id}`, null); write(`conversation.turn.${conversation.id}`, null);
            await app.reloadConversations();
        })),
    )) : [empty('暂无会话')]));
}
function render() { renderStatus(); chat.render(); memory.render(); renderList(); }
window.addEventListener('pagehide', () => { disconnect?.(); clearTimeout(refreshTimer); });
void app.run(async () => {
    await activate('chat'); await app.reloadConversations();
    const selected = read('conversation.selected');
    if (selected && app.conversations.some(item => item.id === selected)) await app.choose(selected);
});
