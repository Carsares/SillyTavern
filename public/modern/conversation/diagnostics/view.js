import { el, button, empty, json } from '../core/dom.js';
import { toolResultsView } from './tools.js';
import { usageView } from './usage.js';
import { contextView } from './context.js';
import { list, redact } from '../core/state.js';
export function createDiagnostics(app) {
    const rows = el('div');
    const usage = el('div');
    const root = el('section', {}, el('h2', {}, '真实执行轨迹与用量'),
        el('p', {}, '仅展示后端已记录的数据；缺失用量不按零计算。'), button('刷新用量与轨迹', () => app.run(load)), usage, rows);
    async function load() {
        const id = app.id();
        usage.replaceChildren(empty('正在读取服务端用量…')); rows.replaceChildren(empty('正在读取轨迹…'));
        const [usageResult, traceResult] = await Promise.allSettled([app.api.usage(id), app.api.traces(id)]);
        if (app.state.snapshot?.conversation.id !== id) return;
        try {
            if (usageResult.status === 'rejected') throw usageResult.reason;
            usage.replaceChildren(usageView(usageResult.value));
        } catch (error) { usage.replaceChildren(el('p', { class: 'banner error', role: 'alert' }, `用量读取失败：${error.message}`)); }
        if (traceResult.status === 'rejected') { rows.replaceChildren(el('p', { class: 'banner error', role: 'alert' }, `轨迹读取失败：${traceResult.reason.message}`)); return; }
        const traces = list(traceResult.value, 'traces');
        rows.replaceChildren(...(traces.length ? traces.map(trace => {
            const detail = el('div');
            return el('article', { class: 'card' }, el('strong', {}, trace.name || trace.type || trace.id),
                el('small', {}, trace.turnId || '会话轨迹'),
                button('读取完整轨迹', () => app.run(async () => { const full = await app.api.trace(trace.id); detail.replaceChildren(contextView(full.requestPlan), json(redact(full)), toolResultsView(app, full)); })),
                json(redact(trace)), toolResultsView(app, trace), detail,
            );
        }) : [empty('服务器尚未记录执行轨迹')]));
    }
    return { root, load };
}
