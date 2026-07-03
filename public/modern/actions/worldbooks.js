import { createWorldbookDetailActions } from './worldbook-details.js';
import { createWorldbookEntryBulkActions } from './worldbook-entry-bulk.js';
import { createWorldbookEntryCrudActions } from './worldbook-entry-crud.js';
import { createWorldbookEntryDataHelpers } from './worldbook-entry-data.js';
import { createWorldbookEntryListHelpers } from './worldbook-entry-list.js';
import { createWorldbookFileActions } from './worldbook-files.js';

export function createWorldbookActions({
    state,
    apiFetch,
    loadData,
    render,
    showToast,
    downloadFile,
    arrayToEntryInput,
    entryInputToArray,
    formatNumber,
    normalizeText,
    numberInput,
    setObjectPath,
    worldEntryDefaults,
}) {
    const {
        createWorldEntry,
        deleteWorldEntryOriginalData,
        formToWorldEntry,
        getFreeWorldEntryUid,
        getWorldEntryTitle,
        syncWorldEntryOriginalData,
        worldEntryToForm,
    } = createWorldbookEntryDataHelpers({
        arrayToEntryInput,
        entryInputToArray,
        numberInput,
        setObjectPath,
        worldEntryDefaults,
    });
    const {
        getVisibleWorldEntries,
        getWorldEntryListState,
        setWorldEntryPage,
        toggleWorldEntrySelection,
        updateWorldEntryListField,
    } = createWorldbookEntryListHelpers({
        state,
        render,
        getWorldEntryTitle,
        formatSearchText: normalizeText,
    });

    const detailActions = createWorldbookDetailActions({
        state,
        apiFetch,
        loadData,
        showToast,
    });
    const {
        loadWorldDetail,
        saveWorldbookDetail,
        getGlobalWorldNames,
        isGlobalWorldEnabled,
        toggleGlobalWorld,
    } = detailActions;
    const fileActions = createWorldbookFileActions({
        state,
        apiFetch,
        loadData,
        render,
        showToast,
        downloadFile,
        loadWorldDetail,
        getGlobalWorldNames,
    });
    const entryBulkActions = createWorldbookEntryBulkActions({
        state,
        loadWorldDetail,
        saveWorldbookDetail,
        render,
        showToast,
        formatNumber,
        syncWorldEntryOriginalData,
        deleteWorldEntryOriginalData,
    });
    const entryCrudActions = createWorldbookEntryCrudActions({
        state,
        loadWorldDetail,
        saveWorldbookDetail,
        render,
        showToast,
        createWorldEntry,
        deleteWorldEntryOriginalData,
        formToWorldEntry,
        getFreeWorldEntryUid,
        getWorldEntryTitle,
        syncWorldEntryOriginalData,
        worldEntryToForm,
    });

    return {
        loadWorldDetail,
        isGlobalWorldEnabled,
        toggleGlobalWorld,
        getWorldEntryListState,
        updateWorldEntryListField,
        setWorldEntryPage,
        toggleWorldEntrySelection,
        getVisibleWorldEntries,
        getWorldEntryTitle,
        createWorldEntry,
        worldEntryToForm,
        ...fileActions,
        ...entryBulkActions,
        ...entryCrudActions,
    };
}
