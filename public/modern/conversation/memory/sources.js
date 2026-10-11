import { el, button, empty, json } from '../core/dom.js';
import { mediaView } from '../media/view.js';

export function matchesSource(message, ref) {
    return message.id === ref.messageId && ['revision', 'candidateId', 'candidateRevision'].every(key => ref[key] == null || message[key] === ref[key]);
}
export function validateHistory(value, conversationId, messageId) {
    if (value?.conversationId !== conversationId || value?.messageId !== messageId || !Array.isArray(value.versions)) throw new Error('服务器返回的消息历史归属或结构不正确');
    return value;
}
export function sourcesView(app, block, visited = new Set()) {
    const snapshot = app.state.snapshot;
    const conversationId = snapshot.conversation.id;
    const refs = block.sourceRefs || (block.messageId ? [{ messageId: block.messageId }] : []);
    const root = el('details', {}, el('summary', {}, '来源与依赖'));
    for (const ref of refs) {
        if (!ref.messageId) { root.append(json(ref)); continue; }
        const current = snapshot.messages.find(message => message.id === ref.messageId);
        const available = current && !current.deletedAt;
        const output = el('div');
        const read = button('读取来源历史 / 候选版本', async () => {
            read.disabled = true; output.replaceChildren(empty('正在读取消息历史…'));
            try {
                const history = validateHistory(await app.api.messageHistory(conversationId, ref.messageId), conversationId, ref.messageId);
                const matched = history.versions.some(version => matchesSource(version, ref));
                output.replaceChildren(el('p', {}, history.deletedAt ? '原消息已删除；以下为保留历史。' : '服务器保留的消息历史'),
                    ...(!matched ? [empty('未找到引用的精确版本；以下版本不能替代原始来源。')] : []),
                    ...history.versions.map(version => el('article', { class: 'card' },
                        el('strong', {}, `${matchesSource(version, ref) ? '引用版本 · ' : ''}版本 ${version.revision} · 候选 ${version.candidateId ?? '无'} / ${version.candidateRevision ?? '无'} · ${version.status || '状态未知'}`),
                        el('pre', {}, version.content ?? ''), ...(version.media || []).map(part => mediaView(app.api, part, snapshot.attachments?.[part.attachmentId])))),
                    ...(!history.versions.length ? [empty('没有保留版本')] : []));
            } catch (error) { output.replaceChildren(el('p', { class: 'banner error', role: 'alert' }, `来源读取失败：${error.message}`)); } finally { read.disabled = false; }
        });
        root.append(el('section', {}, json(ref), el('p', {}, current?.deletedAt ? '当前消息已删除' : !available ? '当前快照没有此消息；是否已删除需读取历史确认。' : matchesSource(current, ref) ? '引用与当前消息版本一致' : '当前消息版本已变化；请读取引用的历史版本。'),
            button('定位当前消息', () => app.run(() => app.locateMessage(conversationId, ref.messageId)), !available), read, output));
    }
    const next = new Set(visited).add(block.id);
    for (const ref of block.parentSummaryRefs || []) {
        const parent = snapshot.summaries?.find(summary => summary.id === (ref.id ?? ref.summaryId));
        root.append(el('details', {}, el('summary', {}, `父摘要 ${ref.id ?? ref.summaryId} · 引用版本 ${ref.revision}`),
            !parent ? empty('当前快照没有此父摘要') : next.has(parent.id) ? empty('循环依赖，停止展开') : el('section', {},
                el('p', {}, `当前版本 ${parent.revision} · ${parent.status}${parent.revision !== ref.revision ? ' · 版本已变化' : ''}`), el('pre', {}, parent.content), sourcesView(app, parent, next))));
    }
    if (!refs.length && !block.parentSummaryRefs?.length) root.append(empty('没有消息来源记录（例如手工记忆）'));
    return root;
}
