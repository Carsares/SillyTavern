export function createDataLoader({
    state,
    apiFetch,
    render,
    showToast,
    ensureAvailableChatMode,
    prepareChatForSelectedContext,
    loadWorldDetail,
}) {
    async function loadData({ silent = false, notify = !silent } = {}) {
        state.loading = true;
        state.errors = [];
        if (!silent) {
            render();
        }

        const requests = {
            me: apiFetch('/api/users/me', { method: 'GET' }),
            settingsBundle: apiFetch('/api/settings/get'),
            characters: apiFetch('/api/characters/all'),
            groups: apiFetch('/api/groups/all'),
            worldbooks: apiFetch('/api/worldinfo/list'),
            backgrounds: apiFetch('/api/backgrounds/all'),
            backgroundFolders: apiFetch('/api/backgrounds/folders'),
            assets: apiFetch('/api/assets/get'),
            extensions: apiFetch('/api/extensions/discover', { method: 'GET' }),
            secrets: apiFetch('/api/secrets/settings'),
            secretState: apiFetch('/api/secrets/read'),
            stats: apiFetch('/api/stats/get'),
        };

        const entries = await Promise.all(Object.entries(requests).map(async ([key, promise]) => {
            try {
                return [key, await promise, null];
            } catch (error) {
                return [key, null, error];
            }
        }));

        for (const [key, value, error] of entries) {
            if (error) {
                state.errors.push({ key, message: error.message });
                continue;
            }

            state[key] = value;
        }

        try {
            state.settings = state.settingsBundle?.settings ? JSON.parse(state.settingsBundle.settings) : {};
        } catch (error) {
            state.settings = {};
            state.errors.push({ key: 'settings', message: `设置解析失败：${error.message}` });
        }

        if (!state.selected.character && state.characters[0]) {
            state.selected.character = state.characters[0].avatar;
        }
        if (!state.selected.group && state.groups[0]) {
            state.selected.group = state.groups[0].id;
        }
        if (!state.selected.worldbook && state.worldbooks[0]) {
            state.selected.worldbook = state.worldbooks[0].file_id;
        }
        ensureAvailableChatMode();
        if (state.route === 'chat') {
            await prepareChatForSelectedContext();
        }
        if (state.route === 'worldbooks') {
            await loadWorldDetail(state.selected.worldbook);
        }

        state.loaded = true;
        state.loading = false;
        render();

        if (notify) {
            const summary = state.errors.length ? '部分数据读取失败，详情见右侧检查器。' : '已同步当前用户数据。';
            showToast('刷新完成', summary);
        }
    }

    return { loadData };
}
