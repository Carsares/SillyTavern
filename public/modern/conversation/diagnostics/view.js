import { el, button, empty, json } from '../core/dom.js';
import { contextView } from './context.js';
import { list, redact } from '../core/state.js';
export function createDiagnostics(app) {
    const rows = el('div');
    const root = el('section', {}, el('h2', {}, '真实执行轨迹与用量'),
        el('p', {}, '仅展示后端已记录的数据；缺失用量不按零计算。'), button('刷新轨迹', () => app.run(load)), rows);
    async function load() {
        const traces = list(await app.api.traces(app.id()), 'traces');
        rows.replaceChildren(...(traces.length ? traces.map(trace => {
            const detail = el('div');
            return el('article', { class: 'card' }, el('strong', {}, trace.name || trace.type || trace.id),
                el('small', {}, trace.turnId || '会话轨迹'),
                button('读取完整轨迹', () => app.run(async () => { const full = await app.api.trace(trace.id); detail.replaceChildren(contextView(full.requestPlan), json(redact(full))); })),
                json(redact(trace)), detail,
            );
        }) : [empty('服务器尚未记录执行轨迹')]));
    }
    return { root, load };
}
