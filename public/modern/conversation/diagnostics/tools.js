import { toolMediaView } from '../media/view.js';
import { el, button, json } from '../core/dom.js';
import { redact } from '../core/state.js';

export function resultReferences(value) {
    const refs = new Set();
    function visit(item) {
        if (!item || typeof item !== 'object') return;
        if (!Array.isArray(item) && typeof item.resultRef === 'string' && item.resultRef) refs.add(item.resultRef);
        // Some executors wrap structured tool results in a JSON text block.
        if (item.type === 'text' && typeof item.text === 'string' && item.text.includes('resultRef')) {
            try { visit(JSON.parse(item.text)); } catch { /* Ordinary tool text is not JSON. */ }
        }
        for (const child of Object.values(item)) visit(child);
    }
    visit(value);
    return [...refs];
}
export function toolResultsView(app, value) {
    return el('div', {}, resultReferences(value).map(id => {
        const output = el('div');
        const load = button(`展开完整工具结果 ${id}`, async () => {
            load.disabled = true;
            output.replaceChildren(el('p', {}, '正在读取完整工具结果…'));
            try { const record = await app.api.tool(id); output.replaceChildren(json(redact(record)), toolMediaView(app.api, record, app.state?.snapshot?.attachments)); } catch (error) { output.replaceChildren(el('p', { class: 'banner error', role: 'alert' }, `工具结果读取失败：${error.message}`)); } finally { load.disabled = false; }
        });
        return el('section', {}, load, output);
    }));
}
