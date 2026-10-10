export function createWorldbookEntryListHelpers({
    state,
    render,
    getWorldEntryTitle,
    formatSearchText,
}) {
    // entries 传入当前世界书的条目（[key, entry] 数组）时，顺带剔除已不存在的选中条目（被删除或刷新后消失），
    // 让批量按钮上的计数始终等于实际可操作的条目数。
    function getWorldEntryListState(worldbookId, entries = null) {
        if (state.worldEntryList.worldbookId !== worldbookId) {
            state.worldEntryList = { worldbookId, query: '', sort: 'order', page: 1, selectedKeys: [] };
        }
        if (Array.isArray(entries) && state.worldEntryList.selectedKeys.length) {
            const existingKeys = new Set(entries.map(([entryKey]) => String(entryKey)));
            const selectedKeys = state.worldEntryList.selectedKeys.filter(entryKey => existingKeys.has(String(entryKey)));
            if (selectedKeys.length !== state.worldEntryList.selectedKeys.length) {
                state.worldEntryList.selectedKeys = selectedKeys;
            }
        }
        return state.worldEntryList;
    }

    function updateWorldEntryListField(field, value) {
        state.worldEntryList[field] = value;
        if (field === 'query' || field === 'sort') {
            state.worldEntryList.page = 1;
        }
        render();
    }

    function setWorldEntryPage(page) {
        state.worldEntryList.page = Math.max(1, Number(page) || 1);
        render();
    }

    function toggleWorldEntrySelection(entryKey, checked) {
        const keys = new Set(state.worldEntryList.selectedKeys);
        if (checked) {
            keys.add(String(entryKey));
        } else {
            keys.delete(String(entryKey));
        }
        state.worldEntryList.selectedKeys = [...keys];
        render();
    }

    function getWorldEntrySearchText(entryKey, entry) {
        return formatSearchText([
            entryKey,
            entry?.comment,
            entry?.name,
            Array.isArray(entry?.key) ? entry.key.join(', ') : entry?.key,
            Array.isArray(entry?.keysecondary) ? entry.keysecondary.join(', ') : entry?.keysecondary,
            entry?.content,
        ].filter(Boolean).join(' '));
    }

    function sortWorldEntries(entries, sort) {
        const sortedEntries = [...entries];
        sortedEntries.sort(([leftKey, leftEntry], [rightKey, rightEntry]) => {
            if (sort === 'comment') {
                return getWorldEntryTitle(leftEntry, leftKey).localeCompare(getWorldEntryTitle(rightEntry, rightKey), 'zh-Hans-CN');
            }
            if (sort === 'status') {
                return Number(!!leftEntry.disable) - Number(!!rightEntry.disable) || Number(leftKey) - Number(rightKey);
            }
            if (sort === 'key') {
                const leftValue = Array.isArray(leftEntry.key) ? leftEntry.key.join(', ') : String(leftEntry.key || '');
                const rightValue = Array.isArray(rightEntry.key) ? rightEntry.key.join(', ') : String(rightEntry.key || '');
                return leftValue.localeCompare(rightValue, 'zh-Hans-CN') || Number(leftKey) - Number(rightKey);
            }
            return Number(leftEntry.order ?? 0) - Number(rightEntry.order ?? 0) || Number(leftKey) - Number(rightKey);
        });
        return sortedEntries;
    }

    function getVisibleWorldEntries(entries, listState) {
        const query = formatSearchText(listState.query);
        const filteredEntries = query
            ? entries.filter(([entryKey, entry]) => getWorldEntrySearchText(entryKey, entry).includes(query))
            : entries;
        return sortWorldEntries(filteredEntries, listState.sort);
    }

    return {
        getVisibleWorldEntries,
        getWorldEntryListState,
        setWorldEntryPage,
        toggleWorldEntrySelection,
        updateWorldEntryListField,
    };
}
