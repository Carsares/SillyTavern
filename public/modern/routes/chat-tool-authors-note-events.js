// 作者注释（A5）的事件绑定，约定见 chat-tools-events.js 顶部注释。
// 输入框 / 单选 / 复选 / 下拉的改动只写进草稿（updateAuthorsNoteDraft），再按返回的视图就地更新界面联动，不重新渲染，
// 输入焦点和光标位置因此不会丢。点击类动作（切换分区、保存、还原）由 actions/chat-authors-note.js 完成并重新渲染。

function setHidden(element, hidden) {
    if (element) {
        element.hidden = hidden;
    }
}

// 草稿变化后，把就地可更新的部分对齐到视图：未保存标记、「默认」标记、校验错误、下次插入时间、深度和角色的显隐
function syncAuthorsNoteDom(view) {
    if (!view?.ready) {
        return;
    }

    const root = /** @type {HTMLElement | null} */ (document.querySelector(`.authors-note-form[data-an-scope="${view.scope}"]`));
    if (!root) {
        return;
    }

    setHidden(root.querySelector('[data-an-dirty]'), !view.dirty);
    for (const chip of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('[data-an-chip]'))) {
        setHidden(chip, !view.chips?.[chip.dataset.anChip]);
    }
    for (const error of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('[data-an-error]'))) {
        const message = view.errors?.[error.dataset.anError] || '';
        error.textContent = message;
        setHidden(error, !message);
    }
    for (const input of /** @type {NodeListOf<HTMLInputElement>} */ (root.querySelectorAll('input[data-an-field], textarea[data-an-field]'))) {
        if (input.type !== 'radio' && input.type !== 'checkbox') {
            input.setAttribute('aria-invalid', view.errors?.[input.dataset.anField] ? 'true' : 'false');
        }
    }
    setHidden(root.querySelector('[data-an-message="notice"]'), !view.notice);

    if (view.schedule) {
        const schedule = /** @type {HTMLElement | null} */ (root.querySelector('[data-an-schedule]'));
        if (schedule) {
            schedule.dataset.scheduleKind = view.schedule.kind;
            const text = schedule.querySelector('[data-an-schedule-text]');
            if (text) {
                text.textContent = view.schedule.text;
            }
            const detail = schedule.querySelector('[data-an-schedule-detail]');
            if (detail) {
                detail.textContent = view.schedule.detail;
                setHidden(detail, !view.schedule.detail);
            }
        }
    }

    setHidden(root.querySelector('[data-an-depth-group]'), view.draft?.position !== '1');
}

export function bindChatToolAuthorsNoteEvents(ctx) {
    const {
        showToast,
        render,
        state,
        resetAuthorsNoteDraft,
        saveAuthorsNoteCharacter,
        saveAuthorsNoteChat,
        saveAuthorsNoteDefaults,
        setAuthorsNoteSection,
        updateAuthorsNoteDraft,
    } = ctx;

    const saveActions = {
        chat: saveAuthorsNoteChat,
        chara: saveAuthorsNoteCharacter,
        default: saveAuthorsNoteDefaults,
    };

    // input 和 change 都走这里：同一个值写两次没有副作用，这样文本框、单选、复选、下拉各自触发哪个事件都能接住
    function applyFieldEvent(event) {
        const field = /** @type {HTMLInputElement | null} */ (event.target instanceof Element ? event.target.closest('[data-an-field][data-an-scope]') : null);
        if (!field) {
            return false;
        }

        const value = field.type === 'checkbox' ? (field.checked ? '1' : '') : field.value;
        syncAuthorsNoteDom(updateAuthorsNoteDraft(field.dataset.anScope, field.dataset.anField, value));
        return true;
    }

    async function handleClick(event) {
        const target = event.target instanceof Element ? event.target : null;
        const sectionButton = /** @type {HTMLElement | null | undefined} */ (target?.closest('[data-an-section]'));
        if (sectionButton) {
            setAuthorsNoteSection(sectionButton.dataset.anSection);
            return true;
        }

        const saveButton = /** @type {HTMLElement | null | undefined} */ (target?.closest('[data-an-save]'));
        if (saveButton) {
            try {
                await saveActions[saveButton.dataset.anSave]?.();
            } catch (error) {
                state.errors.push({ key: 'authors-note-save', message: error.message });
                showToast('作者注释保存失败', error.message);
                render();
            }
            return true;
        }

        const resetButton = /** @type {HTMLElement | null | undefined} */ (target?.closest('[data-an-reset]'));
        if (resetButton) {
            resetAuthorsNoteDraft(resetButton.dataset.anReset);
            return true;
        }

        return false;
    }

    return {
        handleClick,
        handleInput: applyFieldEvent,
        handleChange: applyFieldEvent,
    };
}
