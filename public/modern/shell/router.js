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
    beginCharacterCreate,
    beginGroupCreate,
    beginWorldbookCreate,
    selectPreset,
    toggleInspector,
    toggleChatSidebar,
    closePalette,
    closeChatSidebarForMobileSelection,
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
            await prepareChatForSelectedContext();
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

    async function handleClick(event) {
        if (event.target.closest('[data-toggle-inspector]')) {
            toggleInspector();
            return;
        }

        if (event.target.closest('[data-toggle-chat-sidebar]')) {
            toggleChatSidebar();
            return;
        }

        const routeButton = event.target.closest('[data-route]');
        if (routeButton) {
            if (routeButton.dataset.openCharacterChat) {
                state.chatMode = 'character';
                localStorage.setItem('st-modern-chat-mode', 'character');
                state.selected.character = routeButton.dataset.openCharacterChat;
                state.selected.chat = '';
                clearChatSearch();
            }
            if (routeButton.dataset.openGroupChat) {
                state.chatMode = 'group';
                localStorage.setItem('st-modern-chat-mode', 'group');
                state.selected.group = routeButton.dataset.openGroupChat;
                state.selected.chat = '';
                clearChatSearch();
            }
            await setRoute(routeButton.dataset.route);
            elements.app.querySelector('.sidebar')?.classList.remove('open');
            return;
        }

        const characterButton = event.target.closest('[data-select-character]');
        if (characterButton) {
            state.chatMode = 'character';
            localStorage.setItem('st-modern-chat-mode', 'character');
            state.selected.character = characterButton.dataset.selectCharacter;
            state.selected.chat = '';
            clearChatSearch();
            if (state.route === 'chat') {
                await prepareChatForSelectedContext();
                closeChatSidebarForMobileSelection();
            }
            render();
            return;
        }

        const groupButton = event.target.closest('[data-select-group]');
        if (groupButton) {
            state.chatMode = 'group';
            localStorage.setItem('st-modern-chat-mode', 'group');
            state.selected.group = groupButton.dataset.selectGroup;
            state.selected.chat = '';
            clearChatSearch();
            if (state.route === 'chat') {
                await prepareChatForSelectedContext();
                closeChatSidebarForMobileSelection();
            }
            render();
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
