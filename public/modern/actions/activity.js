export function createActivityActions({
    state,
    apiFetch,
    loadData,
    render,
    showToast,
}) {
    async function recreateStats() {
        await apiFetch('/api/stats/recreate');
        await loadData({ silent: true });
        showToast('统计已重建', '已重新扫描聊天文件。');
        render();
    }

    function getActivityEntries() {
        return Object.entries(state.stats || {})
            .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
            .map(([id, stats]) => ({
                id,
                messages: Number(stats.user_msg_count || 0) + Number(stats.non_user_msg_count || 0),
                words: Number(stats.user_word_count || 0) + Number(stats.non_user_word_count || 0),
                size: Number(stats.chat_size || 0),
                swipes: Number(stats.total_swipe_count || 0),
                genTime: Number(stats.total_gen_time || 0),
                first: Number(stats.date_first_chat || 0),
                last: Number(stats.date_last_chat || 0),
            }))
            .sort((a, b) => b.last - a.last);
    }

    function getActivitySummary(entries) {
        return entries.reduce((summary, entry) => ({
            messages: summary.messages + entry.messages,
            words: summary.words + entry.words,
            size: summary.size + entry.size,
            swipes: summary.swipes + entry.swipes,
            genTime: summary.genTime + entry.genTime,
            last: Math.max(summary.last, entry.last),
        }), { messages: 0, words: 0, size: 0, swipes: 0, genTime: 0, last: 0 });
    }

    return {
        getActivityEntries,
        getActivitySummary,
        recreateStats,
    };
}
