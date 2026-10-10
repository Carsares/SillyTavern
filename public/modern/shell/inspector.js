import { routeLabels } from '../core/constants.js';
import { createInspectorSections } from './inspector-sections.js';

// Two stored values:
// - st-modern-inspector-open: the 设置 page's「默认展开上下文抽屉」preference. core/state.js seeds the initial
//   state from it and only saving Modern preferences writes it. Older builds also wrote it on every toggle,
//   so for upgrading users it still holds their last drawer state and keeps opening the drawer as before.
// - st-modern-inspector-state ('open' | 'closed'): where the user last left the drawer. Every open and close
//   (toggle, close button, Esc, outside click) writes it, and when present it wins over the preference.
//   Saving the preference removes it (actions/settings.js), so the saved preference decides the next load.
const inspectorStateKey = 'st-modern-inspector-state';

function readStoredInspectorState() {
    const value = localStorage.getItem(inspectorStateKey);
    if (value === 'open') {
        return true;
    }
    return value === 'closed' ? false : null;
}

export function createInspector({
    state,
    elements,
    getPersonas,
    getPresetGroups,
    getChatEntityName,
    getChatModeLabel,
    getProviderInfo,
    getSelectedChatEntity,
    getSelectedChatList,
    isGroupChatMode,
    renderKeyValue,
}) {
    const {
        getSelectedChat,
        renderRouteContextSection,
        renderSection,
    } = createInspectorSections({
        state,
        getPersonas,
        getPresetGroups,
        getChatEntityName,
        getChatModeLabel,
        getSelectedChatList,
        isGroupChatMode,
        renderKeyValue,
    });

    const storedOpen = readStoredInspectorState();
    if (storedOpen !== null) {
        state.inspectorOpen = storedOpen;
    }

    function renderInspector() {
        const provider = getProviderInfo();
        const selectedCharacter = state.characters.find(character => character.avatar === state.selected.character);
        const selectedGroup = state.groups.find(group => group.id === state.selected.group);
        const selectedEntity = getSelectedChatEntity();
        const selectedChat = getSelectedChat(getSelectedChatList());

        elements.inspector.classList.toggle('open', state.inspectorOpen);
        elements.inspector.setAttribute('aria-hidden', state.inspectorOpen ? 'false' : 'true');
        document.querySelectorAll('[data-toggle-inspector]').forEach(button => {
            button.classList.toggle('active', state.inspectorOpen);
            button.setAttribute('aria-pressed', state.inspectorOpen ? 'true' : 'false');
        });

        elements.inspector.innerHTML = `
            <section class="inspector-section inspector-head">
                <div>
                    <h2 class="inspector-title">上下文</h2>
                    <p class="panel-subtitle">当前页面、连接和选中资源。</p>
                </div>
                <button class="icon-button mini" type="button" data-toggle-inspector title="关闭上下文">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </section>
            ${renderSection('会话', [
        ['用户', state.me?.name || state.me?.handle || '默认用户'],
        ['入口', routeLabels[state.route]],
        ['状态', state.errors.length ? '部分失败' : '正常'],
    ])}
            ${renderRouteContextSection(provider, selectedCharacter, selectedGroup, selectedEntity, selectedChat)}
            <section class="inspector-section">
                <h2 class="inspector-title">读取错误</h2>
                ${state.errors.length ? `
                    <div class="kv-list">
                        ${state.errors.map(error => renderKeyValue(error.key, error.message)).join('')}
                    </div>
                ` : '<p class="muted">暂无错误。</p>'}
            </section>
        `;
    }

    function setInspectorOpen(open) {
        state.inspectorOpen = open;
        localStorage.setItem(inspectorStateKey, open ? 'open' : 'closed');
        renderInspector();
    }

    function toggleInspector() {
        setInspectorOpen(!state.inspectorOpen);
    }

    function isInsideInspectorControls(path) {
        return path.some(node => node === elements.inspector
            || node === elements.topbar
            || node === elements.commandPalette
            || node === elements.toastStack
            || (node instanceof Element && node.matches('[data-toggle-inspector]')));
    }

    // Bound on window so these run after the document-level handlers in events.js / router.js: an Esc
    // already consumed there (command palette, message edit, chat drawers) is defaultPrevented, and the
    // toggle buttons have already flipped the drawer by the time the click arrives here.
    function bindInspectorDismiss() {
        window.addEventListener('keydown', event => {
            if (event.key !== 'Escape' || event.defaultPrevented || !state.inspectorOpen || !elements.commandPalette.hidden) {
                return;
            }

            const focusWasInside = elements.inspector.contains(document.activeElement);
            setInspectorOpen(false);
            event.preventDefault();
            if (focusWasInside) {
                /** @type {HTMLElement | null} */ (elements.topbar?.querySelector('[data-toggle-inspector]'))?.focus();
            }
        });
        // Captured before any click handler runs, so the bubbling listener below can tell whether this click
        // saved the 默认展开 preference
        let preferenceRevisionAtClick = state.inspectorPreferenceRevision;
        window.addEventListener('click', () => {
            preferenceRevisionAtClick = state.inspectorPreferenceRevision;
        }, { capture: true });
        window.addEventListener('click', event => {
            // The click that saved the preference re-declared the drawer default: it is not an outside click, and
            // dismissing here would record a drawer state right after the save cleared it
            if (state.inspectorPreferenceRevision !== preferenceRevisionAtClick) {
                return;
            }
            // composedPath() is fixed at dispatch time, so a click on a control that re-rendered the drawer
            // (and detached itself) still counts as inside
            const path = event.composedPath();
            if (!state.inspectorOpen || isInsideInspectorControls(path)) {
                return;
            }

            setInspectorOpen(false);
        });
    }

    bindInspectorDismiss();

    return {
        renderInspector,
        toggleInspector,
    };
}
