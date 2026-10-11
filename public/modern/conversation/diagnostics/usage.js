import { el } from '../core/dom.js';
export const USAGE_FIELDS = Object.freeze([
    ['calls', '已发出调用数'], ['inputTokens', '输入 tokens'], ['outputTokens', '输出 tokens'],
    ['cacheReadTokens', '缓存读取 tokens（子计数）'], ['cacheWriteTokens', '缓存写入 tokens（子计数）'],
    ['reasoningTokens', '推理 tokens（子计数）'], ['totalTokens', '总 tokens'], ['costUsd', '费用 USD'], ['complete', '统计完整性'],
]);
export function usageValue(value, field) {
    if (field === 'complete') return value === true ? '完整' : value === false ? '不完整' : '未知';
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(value) : '未知';
}
export function usageRows(report) {
    const columns = [report?.totals, ...['generation', 'memory', 'embedding', 'image'].map(key => report?.categories?.[key])];
    return USAGE_FIELDS.map(([key, label]) => ({ label, cells: columns.map(column => usageValue(column?.[key], key)) }));
}
function table(headers, rows) {
    return el('div', { class: 'table-scroll' }, el('table', {},
        el('thead', {}, el('tr', {}, headers.map(header => el('th', { scope: 'col' }, header)))),
        el('tbody', {}, rows.map(row => el('tr', {}, row.map((cell, index) => el(index ? 'td' : 'th', index ? {} : { scope: 'row' }, cell)))))));
}
export function usageView(report) {
    if (!report?.totals || !report.categories || !Array.isArray(report.turns)) throw new Error('服务器未返回完整用量汇总结构');
    return el('section', {}, el('h3', {}, '服务端用量汇总'),
        el('p', {}, '调用数包括部分回复及失败前已发出的请求，不包含仅准备的请求。未知费用显示“未知”。总 tokens 原样读取服务端字段，缓存和推理子计数不重复累加。'),
        table(['指标', '总计', '生成', '记忆', '嵌入', '图像'], usageRows(report).map(row => [row.label, ...row.cells])),
        el('h3', {}, '逐轮用量'),
        report.turns.length ? table(['轮次', ...USAGE_FIELDS.map(([, label]) => label)], report.turns.map(turn => [turn.turnId, ...USAGE_FIELDS.map(([key]) => usageValue(turn[key], key))])) : el('p', { class: 'empty' }, '暂无逐轮用量'));
}
