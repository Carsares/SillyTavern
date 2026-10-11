import { el, json, button } from '../core/dom.js';
import { redact } from '../core/state.js';
const labels = { 'not-ready': '语义索引未就绪', 'keyword-only': '仅关键词检索', indexing: '正在构建语义索引', ready: '语义索引已就绪', stale: '语义索引已过期，需要重建', error: '语义索引失败', superseded: '索引构建已被更新替代' };
export function indexStatusView(status) {
    if (!status || typeof status.status !== 'string') throw new Error('服务器未返回索引状态');
    return el('section', { class: 'card', 'aria-label': '检索索引状态' }, el('h3', {}, labels[status.status] ?? `索引状态：${status.status}`),
        el('p', {}, `语义检索：${status.semanticReady === true ? '可用' : '未就绪'} · 索引条目 ${status.count ?? '未知'}`),
        el('p', {}, '关键词检索仍可用；语义索引未就绪或失败不代表历史已丢失。'),
        ...(status.error ? [el('p', { class: 'banner error', role: 'alert' }, `${status.error.code || 'index-error'}: ${status.error.message || '索引操作失败'}`)] : []), el('details', {}, el('summary', {}, '索引详情'), json(redact(status))));
}

export function createRetrievalStatus(app) {
    const output = el('div');
    const root = el('section', {}, button('刷新检索索引状态', () => load()), output);
    let serial = 0;
    async function load() {
        const id = app.state.snapshot?.conversation.id;
        const request = ++serial;
        if (!id) { output.replaceChildren(); return; }
        output.replaceChildren(el('p', {}, '正在读取索引状态…'));
        try {
            const value = await app.api.retrievalStatus(id);
            if (request === serial && id === app.state.snapshot?.conversation.id) output.replaceChildren(indexStatusView(value));
        } catch (error) {
            if (request === serial && id === app.state.snapshot?.conversation.id) output.replaceChildren(el('p', { role: 'alert', class: 'banner error' }, `索引状态未知：${error.message}`));
        }
    }
    return { root, load, clear() { serial++; output.replaceChildren(); }, onEvent(event) {
        if (event.type === 'retrieval.updated' && event.conversationId === app.state.snapshot?.conversation.id) {
            serial++; output.replaceChildren(indexStatusView(event.payload));
        }
    } };
}
