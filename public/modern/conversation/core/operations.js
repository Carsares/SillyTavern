import { versionedCommand } from './state.js';

export function requireSnapshot(value, conversationId) {
    if (!value?.conversation || value.conversation.id !== conversationId || !Array.isArray(value.messages)
        || !Number.isSafeInteger(value.conversation.contentRevision) || !Number.isSafeInteger(value.conversation.memoryRevision)) {
        throw new Error('服务器未返回当前会话的有效 Snapshot');
    }
    return value;
}

/** A failed read must never turn a confirmed write into an invitation to resubmit. */
export async function refreshAfterWrite(refresh, onWarning) {
    try { await refresh(); } catch (error) { onWarning(`写入已获服务器确认，但刷新失败：${error.message}。请重新读取状态，不要重复提交。`); }
}

export async function applySnapshotCommand({ api, conversationId, snapshot, type, fields, onCommitted, refresh, onWarning }) {
    const result = await api.command(conversationId, versionedCommand(snapshot, type, fields));
    onCommitted(requireSnapshot(result, conversationId));
    await refreshAfterWrite(refresh, onWarning);
    return result;
}

export function acceptedTurn(accepted, request, conversationId, currentTurn) {
    if (!accepted?.turnId || typeof accepted.status !== 'string') throw new Error('服务器未返回完整轮次信息，发送结果待确认');
    if (currentTurn?.id === accepted.turnId && currentTurn.conversationId === conversationId) return currentTurn;
    return { id: accepted.turnId, conversationId, status: accepted.status, type: request.type, content: '', reasoning: '', usage: null };
}
