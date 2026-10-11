// 聊天背景（B5）的事件绑定：聊天工具抽屉里的「聊天背景」面板，以及消息列表背景图的加载探测。
// 返回的处理函数约定见 chat-tools-events.js 顶部注释：handleClick / handleInput / handleChange 返回 true 表示已处理，
// afterRender 在每次聊天页渲染完成后调用。
export function bindChatToolBackgroundEvents(ctx) {
    const {
        state,
        render,
        showToast,
        lockChatBackground,
        clearChatBackgroundLock,
        uploadChatBackground,
        setChatBackgroundEnabled,
        setChatBackgroundDim,
        markChatBackgroundImageFailed,
        markChatBackgroundImageVerified,
    } = ctx;
    // 正在探测的路径，避免连续渲染时对同一张图重复探测
    const probing = new Set();

    async function runAction(task, failureTitle) {
        try {
            await task();
        } catch (error) {
            state.errors.push({ key: 'chat-background', message: error.message });
            showToast(failureTitle, error.message);
            render();
        }
    }

    async function handleClick(event) {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) {
            return false;
        }

        const pickButton = target.closest('[data-chat-bg-pick]');
        if (pickButton instanceof HTMLElement) {
            await runAction(() => lockChatBackground({ file: pickButton.dataset.chatBgPick || '' }), '设置聊天背景失败');
            return true;
        }

        const pickChatButton = target.closest('[data-chat-bg-pick-chat]');
        if (pickChatButton instanceof HTMLElement) {
            await runAction(() => lockChatBackground({ chatImage: pickChatButton.dataset.chatBgPickChat || '' }), '设置聊天背景失败');
            return true;
        }

        if (target.closest('[data-chat-bg-pick-none]')) {
            await runAction(() => lockChatBackground({ none: true }), '设置聊天背景失败');
            return true;
        }

        if (target.closest('[data-chat-bg-follow-global]')) {
            await runAction(() => clearChatBackgroundLock(), '清除聊天背景锁定失败');
            return true;
        }

        if (target.closest('[data-chat-bg-more]')) {
            state.chatBackground.visibleCount += 24;
            render();
            return true;
        }

        return false;
    }

    function applyFilter(value) {
        state.chatBackground.query = value;
        state.chatBackground.visibleCount = 24;
        render();
        const next = document.querySelector('[data-chat-bg-filter]');
        if (next instanceof HTMLInputElement) {
            next.focus();
            const cursor = next.value.length;
            next.setSelectionRange(cursor, cursor);
        }
    }

    function handleInput(event) {
        const input = event.target;
        if (!(input instanceof HTMLInputElement)) {
            return false;
        }

        if (input.matches('[data-chat-bg-dim]')) {
            // 拖动滑块时不整页重渲染（会打断拖动），直接改页面上的 CSS 变量和读数
            const dim = setChatBackgroundDim(input.value);
            document.querySelectorAll('.chat-backdrop').forEach(element => {
                if (element instanceof HTMLElement) {
                    element.style.setProperty('--chat-bg-dim', `${dim}%`);
                }
            });
            const output = document.querySelector('[data-chat-bg-dim-value]');
            if (output) {
                output.textContent = `${dim}%`;
            }
            return true;
        }

        if (input.matches('[data-chat-bg-filter]')) {
            // 输入法组词期间只记下文字，组词结束（compositionend）再筛选，避免重渲染打断输入
            if (event.isComposing) {
                state.chatBackground.query = input.value;
                return true;
            }
            applyFilter(input.value);
            return true;
        }

        return false;
    }

    async function handleChange(event) {
        const input = event.target;
        if (!(input instanceof HTMLInputElement)) {
            return false;
        }

        if (input.matches('[data-chat-bg-enabled]')) {
            setChatBackgroundEnabled(input.checked);
            return true;
        }

        if (input.matches('[data-chat-bg-upload]')) {
            const file = input.files?.[0];
            await runAction(() => uploadChatBackground(file), '上传聊天背景失败');
            input.value = '';
            return true;
        }

        return false;
    }

    // 背景图能否加载只有浏览器知道：渲染后探测一次，失败的路径记下来，下一次渲染回退到全局背景（或无）。
    function probeBackdropImage() {
        const backdrop = document.querySelector('.chat-backdrop[data-chat-bg-path]');
        const path = backdrop instanceof HTMLElement ? backdrop.dataset.chatBgPath : '';
        if (!path || state.chatBackground.verified[path] || probing.has(path)) {
            return;
        }

        probing.add(path);
        const image = new Image();
        image.onload = () => {
            probing.delete(path);
            markChatBackgroundImageVerified(path);
        };
        image.onerror = () => {
            probing.delete(path);
            markChatBackgroundImageFailed(path);
        };
        image.src = path;
    }

    function afterRender() {
        probeBackdropImage();
        const filter = document.querySelector('[data-chat-bg-filter]');
        if (filter instanceof HTMLInputElement && !filter.dataset.compositionBound) {
            filter.dataset.compositionBound = '1';
            filter.addEventListener('compositionend', () => applyFilter(filter.value));
        }
    }

    return {
        handleClick,
        handleInput,
        handleChange,
        afterRender,
    };
}
