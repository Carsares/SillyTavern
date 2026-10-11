import { el, json, empty } from '../core/dom.js';
import { redact } from '../core/state.js';
const layerNames = { L1: '固定设定和工具', L2: '记忆和摘要', L3: '世界书和检索', L4: '历史消息', L5: '当前输入和提示' };
export function contextView(plan) {
    if (!plan) return empty('服务器未返回上下文计划');
    const root = el('details', {}, el('summary', {}, `上下文 · ${plan.estimatedTokens ?? '未知'} tokens（估算，不是实际用量）`),
        json({ mode: plan.mode, tokenCount: plan.tokenCount, budget: plan.budget, warnings: plan.warnings }));
    for (const [layer, label] of Object.entries(layerNames)) {
        const blocks = (plan.blocks || []).filter(block => block.layer === layer);
        root.append(el('details', {}, el('summary', {}, `${layer} ${label} · ${blocks.length} 块`),
            ...blocks.map(block => el('article', { class: 'card' }, el('strong', {}, block.id), json(redact(block)))),
            ...(!blocks.length ? [empty('没有返回此层内容')] : [])));
    }
    root.append(el('details', {}, el('summary', {}, '省略条目与来源'), json(redact({ omitted: plan.omitted, sourceRefs: plan.sourceRefs }))),
        el('details', {}, el('summary', {}, '编译消息和效果提案'), json(redact({ messages: plan.messages, effects: plan.effects, prompt: plan.prompt, tools: plan.tools }))));
    return root;
}
