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

/** A structured 4xx answer proves the server did not apply the write; 408 comes from a timeout on the way. */
export const writeRejected = error => error?.status >= 400 && error.status < 500 && error.status !== 408 && error.code !== 'invalid-response';

/**
 * Long writes (compression, index rebuild, restore, image job actions) keep running on the server after the
 * browser stops waiting, and some of them bill model calls. A timeout, lost connection or server failure
 * leaves the result unknown: re-read the state and say so instead of inviting a duplicate submission.
 * The thrown error carries resultUnknown so a view can tell it from a rejection.
 */
export async function runUncertainWrite(write, refresh) {
    try { return await write(); } catch (error) {
        if (writeRejected(error)) throw error;
        const reason = error?.name === 'TimeoutError' ? '等待服务器响应超时' : error?.message || '连接中断';
        let reread = '已重新读取状态，请核对结果';
        try { await refresh(); } catch (refreshError) { reread = `重新读取状态失败（${refreshError.message}），请稍后重新读取状态`; }
        throw Object.assign(new Error(`操作结果未知（${reason}）：服务器可能仍在处理或已经完成。${reread}，不要重复提交。`), { resultUnknown: true });
    }
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
