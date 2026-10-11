export function createWorldbookEntryDataHelpers({
    arrayToEntryInput,
    entryInputToArray,
    numberInput,
    setObjectPath,
    worldEntryDefaults,
}) {
    function getWorldEntryTitle(entry, entryKey) {
        return entry?.comment || entry?.name || (Array.isArray(entry?.key) ? entry.key.join(', ') : '') || `条目 ${entryKey}`;
    }

    function getFreeWorldEntryUid(detail) {
        if (!detail?.entries) {
            return null;
        }

        for (let uid = 0; uid < 1_000_000; uid++) {
            if (!(uid in detail.entries)) {
                return uid;
            }
        }

        return null;
    }

    function createWorldEntry(uid) {
        return {
            uid,
            ...structuredClone(worldEntryDefaults),
        };
    }

    function worldEntryToForm(entry) {
        return {
            key: arrayToEntryInput(entry?.key),
            keysecondary: arrayToEntryInput(entry?.keysecondary),
            comment: entry?.comment || '',
            content: entry?.content || '',
            order: String(entry?.order ?? worldEntryDefaults.order),
            position: String(entry?.position ?? worldEntryDefaults.position),
            depth: String(entry?.depth ?? worldEntryDefaults.depth),
            role: entry?.role == null ? '' : String(entry.role),
            probability: String(entry?.probability ?? worldEntryDefaults.probability),
            selectiveLogic: String(entry?.selectiveLogic ?? worldEntryDefaults.selectiveLogic),
            scanDepth: entry?.scanDepth == null ? '' : String(entry.scanDepth),
            caseSensitive: entry?.caseSensitive == null ? '' : String(Boolean(entry.caseSensitive)),
            matchWholeWords: entry?.matchWholeWords == null ? '' : String(Boolean(entry.matchWholeWords)),
            useGroupScoring: entry?.useGroupScoring == null ? '' : String(Boolean(entry.useGroupScoring)),
            constant: !!entry?.constant,
            vectorized: !!entry?.vectorized,
            selective: entry?.selective !== false,
            addMemo: !!entry?.addMemo,
            useProbability: entry?.useProbability !== false,
            disable: !!entry?.disable,
            ignoreBudget: !!entry?.ignoreBudget,
            excludeRecursion: !!entry?.excludeRecursion,
            preventRecursion: !!entry?.preventRecursion,
        };
    }

    function nullableBooleanInput(value) {
        if (value === '' || value == null) {
            return null;
        }

        return value === true || value === 'true';
    }

    function nullableNumberInput(value) {
        if (value === '' || value == null) {
            return null;
        }

        return numberInput(value, null);
    }

    function formToWorldEntry(form, uid, previous = {}) {
        return {
            ...previous,
            uid,
            key: entryInputToArray(form.key),
            keysecondary: entryInputToArray(form.keysecondary),
            comment: String(form.comment || ''),
            content: String(form.content || ''),
            order: numberInput(form.order, worldEntryDefaults.order),
            position: numberInput(form.position, worldEntryDefaults.position),
            depth: numberInput(form.depth, worldEntryDefaults.depth),
            role: form.role === '' ? null : numberInput(form.role, worldEntryDefaults.role),
            probability: Math.max(0, Math.min(100, numberInput(form.probability, worldEntryDefaults.probability))),
            selectiveLogic: numberInput(form.selectiveLogic, worldEntryDefaults.selectiveLogic),
            scanDepth: nullableNumberInput(form.scanDepth),
            caseSensitive: nullableBooleanInput(form.caseSensitive),
            matchWholeWords: nullableBooleanInput(form.matchWholeWords),
            useGroupScoring: nullableBooleanInput(form.useGroupScoring),
            constant: !!form.constant,
            vectorized: !!form.vectorized,
            selective: !!form.selective,
            addMemo: !!form.addMemo,
            useProbability: !!form.useProbability,
            disable: !!form.disable,
            ignoreBudget: !!form.ignoreBudget,
            excludeRecursion: !!form.excludeRecursion,
            preventRecursion: !!form.preventRecursion,
        };
    }

    function syncWorldEntryOriginalData(detail, uid, entry) {
        if (!detail?.originalData || !Array.isArray(detail.originalData.entries)) {
            return;
        }

        const originalEntry = detail.originalData.entries.find(item => item.uid === uid);
        if (!originalEntry) {
            return;
        }

        const fieldMap = {
            comment: ['comment', entry.comment],
            content: ['content', entry.content],
            constant: ['constant', entry.constant],
            order: ['insertion_order', entry.order],
            depth: ['extensions.depth', entry.depth],
            probability: ['extensions.probability', entry.probability],
            position: ['extensions.position', entry.position],
            role: ['extensions.role', entry.role],
            key: ['keys', entry.key],
            keysecondary: ['secondary_keys', entry.keysecondary],
            selective: ['selective', entry.selective],
            selectiveLogic: ['selectiveLogic', entry.selectiveLogic],
            addMemo: ['addMemo', entry.addMemo],
            vectorized: ['extensions.vectorized', entry.vectorized],
            scanDepth: ['extensions.scan_depth', entry.scanDepth],
            caseSensitive: ['extensions.case_sensitive', entry.caseSensitive],
            matchWholeWords: ['extensions.match_whole_words', entry.matchWholeWords],
            useGroupScoring: ['extensions.use_group_scoring', entry.useGroupScoring],
            ignoreBudget: ['extensions.ignore_budget', entry.ignoreBudget],
            excludeRecursion: ['extensions.exclude_recursion', entry.excludeRecursion],
            preventRecursion: ['extensions.prevent_recursion', entry.preventRecursion],
            enabled: ['enabled', !entry.disable],
        };

        for (const [path, value] of Object.values(fieldMap)) {
            setObjectPath(originalEntry, path, value);
        }
    }

    function deleteWorldEntryOriginalData(detail, entryKey) {
        if (!detail?.originalData || !Array.isArray(detail.originalData.entries)) {
            return;
        }

        const originalIndex = detail.originalData.entries.findIndex(item => item.uid == entryKey);
        if (originalIndex >= 0) {
            detail.originalData.entries.splice(originalIndex, 1);
        }
    }

    return {
        createWorldEntry,
        deleteWorldEntryOriginalData,
        formToWorldEntry,
        getFreeWorldEntryUid,
        getWorldEntryTitle,
        syncWorldEntryOriginalData,
        worldEntryToForm,
    };
}
