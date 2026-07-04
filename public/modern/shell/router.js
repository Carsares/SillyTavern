import { routeLabels } from '../core/constants.js';

export function createRouter({
    state,
    elements,
    routeModules,
    render,
    loadData,
    loadWorldDetail,
    prepareChatForSelectedContext,
    clearChatSearch,
    clearChatTransientState,
    beginCharacterCreate,
    beginGroupCreate,
    beginWorldbookCreate,
    selectPreset,
    toggleInspector,
    toggleChatSidebar,
    closePalette,
    closeChatSidebarForMobileSelection,
    getBackgroundFilename,
}) {
    async function setRoute(routeId) {
        if (!routeLabels[routeId]) {
            return;
        }

        state.route = routeId;
        const url = new URL(window.location.href);
        url.searchParams.set('view', routeId);
        window.history.replaceState({}, '', url);
        elements.content.focus({ preventScroll: true });
        render();

        if (routeId === 'chat') {
            await prepareChatForSelectedContext({ forceList: true });
            render();
        }
        if (routeId === 'worldbooks') {
            await loadWorldDetail(state.selected.worldbook);
            render();
        }
    }

    function startCommandAction(action) {
        switch (action) {
            case 'create-character':
                beginCharacterCreate();
                break;
            case 'create-group':
                beginGroupCreate();
                break;
            case 'create-worldbook':
                beginWorldbookCreate();
                break;
            default:
                break;
        }
    }

    function getChatResourceListScrollTop() {
        const list = elements.content.querySelector('.chat-browser .chat-browser-panel:first-child .resource-list');
        return list instanceof HTMLElement ? list.scrollTop : null;
    }

    function restoreChatResourceListScrollTop(scrollTop) {
        if (scrollTop === null) {
            return;
        }

        const list = elements.content.querySelector('.chat-browser .chat-browser-panel:first-child .resource-list');
        if (list instanceof HTMLElement) {
            list.scrollTop = scrollTop;
        }
    }

    async function handleClick(event) {
        if (event.target.closest('[data-toggle-inspector]')) {
            toggleInspector();
            return;
        }

        if (event.target.closest('[data-toggle-chat-sidebar]')) {
            toggleChatSidebar();
            return;
        }

        const routeButton = event.target.closest('button[data-route], a[data-route]');
        if (routeButton) {
            if (routeButton.dataset.openCharacterChat) {
                state.chatMode = 'character';
                localStorage.setItem('st-modern-chat-mode', 'character');
                state.selected.character = routeButton.dataset.openCharacterChat;
                state.selected.chat = '';
                clearChatTransientState();
                clearChatSearch();
            }
            if (routeButton.dataset.openGroupChat) {
                state.chatMode = 'group';
                localStorage.setItem('st-modern-chat-mode', 'group');
                state.selected.group = routeButton.dataset.openGroupChat;
                state.selected.chat = '';
                clearChatTransientState();
                clearChatSearch();
            }
            await setRoute(routeButton.dataset.route);
            elements.app.querySelector('.sidebar')?.classList.remove('open');
            return;
        }

        const characterButton = event.target.closest('[data-select-character]');
        if (characterButton) {
            const resourceListScrollTop = state.route === 'chat' ? getChatResourceListScrollTop() : null;
            state.chatMode = 'character';
            localStorage.setItem('st-modern-chat-mode', 'character');
            state.selected.character = characterButton.dataset.selectCharacter;
            state.selected.chat = '';
            clearChatTransientState();
            clearChatSearch();
            if (state.route === 'chat') {
                await prepareChatForSelectedContext({ forceList: true });
                closeChatSidebarForMobileSelection();
            }
            if (state.route === 'characters' && routeModules.characters?.renderSelection?.()) {
                return;
            }
            render();
            restoreChatResourceListScrollTop(resourceListScrollTop);
            return;
        }

        const groupButton = event.target.closest('[data-select-group]');
        if (groupButton) {
            const resourceListScrollTop = state.route === 'chat' ? getChatResourceListScrollTop() : null;
            state.chatMode = 'group';
            localStorage.setItem('st-modern-chat-mode', 'group');
            state.selected.group = groupButton.dataset.selectGroup;
            state.selected.chat = '';
            clearChatTransientState();
            clearChatSearch();
            if (state.route === 'chat') {
                await prepareChatForSelectedContext({ forceList: true });
                closeChatSidebarForMobileSelection();
            }
            render();
            restoreChatResourceListScrollTop(resourceListScrollTop);
            return;
        }

        const routeClickHandler = routeModules[state.route]?.handleClick;
        if (routeClickHandler && await routeClickHandler(event) !== false) {
            return;
        }

        const commandButton = event.target.closest('[data-command-route]');
        if (commandButton) {
            const select = commandButton.dataset.commandSelect;
            const id = commandButton.dataset.commandId;
            const action = commandButton.dataset.commandAction;
            const presetApi = commandButton.dataset.commandPresetApi;
            const presetName = commandButton.dataset.commandPresetName;
            if (select && id) {
                state.selected[select] = id;
                if (select === 'extension') {
                    state.extensionView = 'all';
                    localStorage.setItem('st-modern-extension-view', 'all');
                }
                if (select === 'background') {
                    state.assetTab = 'backgrounds';
                    state.backgroundFolderFilter = '';
                    state.query = '';
                    elements.search.value = '';
                    localStorage.setItem('st-modern-asset-tab', 'backgrounds');
                    const backgroundIndex = (state.backgrounds?.images || []).findIndex(background => getBackgroundFilename(background) === id);
                    if (backgroundIndex >= 0) {
                        state.backgroundVisibleCount = Math.max(state.backgroundVisibleCount, backgroundIndex + 1);
                    }
                }
                if (select === 'asset') {
                    state.assetTab = 'files';
                    state.query = '';
                    elements.search.value = '';
                    localStorage.setItem('st-modern-asset-tab', 'files');
                    const [category] = id.split(':');
                    if (category && !state.assetExpandedGroups.includes(category)) {
                        state.assetExpandedGroups = [...state.assetExpandedGroups, category];
                    }
                }
            }
            closePalette();
            await setRoute(commandButton.dataset.commandRoute);
            if (presetApi && presetName) {
                selectPreset(presetApi, presetName);
            }
            if (action) {
                startCommandAction(action);
            }
            return;
        }

        if (event.target.closest('[data-refresh]')) {
            await loadData();
        }
    }

    return {
        handleClick,
        setRoute,
    };
}
