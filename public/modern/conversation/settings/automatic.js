export function automaticRequest(snapshot, enabled, { intervalMs, content } = {}) {
    if (!enabled) return { enabled: false };
    const settings = snapshot?.settings || snapshot?.conversation.settings || {};
    if (!settings.groupId || !settings.connectionId) throw new Error('请先保存群组与连接选择');
    if (!Number.isSafeInteger(snapshot?.conversation.contentRevision)) throw new Error('请重新读取会话版本');
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 1000 || intervalMs > 3600000) throw new Error('自动群聊间隔必须为 1000–3600000 毫秒的整数');
    if (typeof content !== 'string' || !content.trim()) throw new Error('请输入自动群聊触发内容');
    return { enabled: true, intervalMs, content, expectedContentRevision: snapshot.conversation.contentRevision };
}

/** Readback, not the local toggle, determines displayed scheduling state. */
export function createAutomaticControl({ api, conversationId, onChange }) {
    let serial = 0;
    let disposed = false;
    let state = { enabled: null, loading: false, error: '' };
    function publish(patch) {
        state = { ...state, ...patch };
        if (!disposed) onChange(state);
    }
    async function refresh() {
        if (disposed) return;
        const request = ++serial;
        publish({ loading: true, error: '' });
        try {
            const result = await api.automaticState(conversationId);
            if (disposed || request !== serial) return;
            if (typeof result?.enabled !== 'boolean') throw new Error('服务器未返回有效的自动群聊状态');
            publish({ enabled: result.enabled, loading: false });
        } catch (error) {
            if (disposed || request !== serial) return;
            publish({ enabled: null, loading: false, error: error.message });
        }
    }
    return {
        refresh,
        async set(snapshot, enabled, options) {
            const body = automaticRequest(snapshot, enabled, options);
            if (disposed) return;
            ++serial;
            publish({ loading: true, error: '' });
            try {
                await api.automatic(conversationId, body);
                await refresh();
            } catch (error) {
                publish({ enabled: null, loading: false, error: error.message });
                throw error;
            }
        },
        dispose() { disposed = true; ++serial; },
    };
}
