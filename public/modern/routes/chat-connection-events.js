// 输入框下方连接标签（B1）的事件绑定。别的功能不要改这个文件。
// 返回的处理函数都是可选的，约定与 chat-tools-events.js 顶部注释一致，已经接到 routes/chat.js 的点击、输入、change、keydown 和渲染后回调上。
//
// 弹层的展开、收起和创建档案的表单只改 state.connectionSwitcher 并就地替换输入框下方这一小块 DOM（replaceSwitcher），
// 不重绘整个聊天页，输入框里的草稿和光标不受影响。真正会改连接的动作（应用档案、换模型）由 actions/connection-profiles.js 完成，
// 它们结束时会整页重绘，这里再把键盘焦点放回对应的按钮。
// 点弹层外面要关闭，而路由器会先处理侧栏、导航这类点击，到不了聊天页的点击处理函数，所以这里另外挂一个只注册一次的捕获阶段监听。
import { createChatConnectionChipComponent } from '../components/chat-connection-chip.js';
import { getSwitcherState } from '../actions/connection-profiles.js';

const focusableSelector = '[data-connection-popover] [data-connection-focusable]:not(:disabled)';

/** @type {((event: Event) => void) | null} */
let activeOutsideClickListener = null;

/**
 * @param {string} value 属性值
 * @returns {string} 可放进属性选择器的值
 */
function cssEscape(value) {
    return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(value)
        : String(value).replace(/["\\]/g, '\\$&');
}

export function bindChatConnectionEvents(ctx) {
    const {
        state,
        applyConnectionProfile,
        createProfileFromCurrentConnection,
        suggestConnectionProfileName,
        switchModelQuick,
    } = ctx;
    const { renderChatConnectionChip } = createChatConnectionChipComponent(ctx);

    /**
     * 用最新状态重新生成标签和弹层，替换页面上现有的那一块。页面上还没有这一块时（不在聊天页）什么也不做。
     * @returns {boolean} 是否替换了
     */
    function replaceSwitcher() {
        const host = document.querySelector('[data-connection-switcher]');
        if (!(host instanceof HTMLElement)) {
            return false;
        }
        const template = document.createElement('template');
        template.innerHTML = renderChatConnectionChip().trim();
        const next = template.content.firstElementChild;
        if (next) {
            host.replaceWith(next);
        } else {
            host.remove();
        }
        return true;
    }

    function focusElement(selector) {
        const element = document.querySelector(selector);
        if (element instanceof HTMLElement) {
            element.focus();
        }
    }

    function focusChip() {
        focusElement('[data-connection-chip]');
    }

    function focusFirstOption() {
        focusElement(focusableSelector);
    }

    function openSwitcher() {
        const switcher = getSwitcherState(state);
        switcher.open = true;
        switcher.createOpen = false;
        switcher.createName = '';
        switcher.error = '';
        replaceSwitcher();
        focusFirstOption();
    }

    function closeSwitcher({ restoreFocus = true } = {}) {
        const switcher = getSwitcherState(state);
        if (!switcher.open) {
            return false;
        }
        switcher.open = false;
        switcher.createOpen = false;
        switcher.createName = '';
        switcher.error = '';
        replaceSwitcher();
        if (restoreFocus) {
            focusChip();
        }
        return true;
    }

    async function submitCreate() {
        const switcher = getSwitcherState(state);
        const input = document.querySelector('[data-connection-create-name]');
        if (input instanceof HTMLInputElement) {
            switcher.createName = input.value;
        }
        const result = await createProfileFromCurrentConnection(switcher.createName);
        if (result?.ok) {
            // 动作成功后已整页重绘并关闭了创建表单：焦点回到标签旁边的创建按钮
            focusElement('[data-connection-create-open]');
            return;
        }
        replaceSwitcher();
        focusElement('[data-connection-create-name]');
    }

    // 点弹层外面就收起。注册在 document 的捕获阶段，在路由器处理这次点击之前先收起，路由器随后的重绘看到的已经是收起状态
    if (typeof document !== 'undefined') {
        if (activeOutsideClickListener) {
            document.removeEventListener('click', activeOutsideClickListener, true);
        }
        activeOutsideClickListener = event => {
            if (!getSwitcherState(state).open || !(event.target instanceof Element)) {
                return;
            }
            const inside = event.target.closest('[data-connection-switcher]');
            // 弹层里去 API 页的链接会切换路由，点它也要先收起，免得回到聊天页时弹层还开着
            if (inside && !event.target.closest('[data-connection-popover] [data-route]')) {
                return;
            }
            closeSwitcher({ restoreFocus: false });
        };
        document.addEventListener('click', activeOutsideClickListener, true);
    }

    async function handleClick(event) {
        const target = event.target;
        if (!(target instanceof Element) || !target.closest('[data-connection-switcher]')) {
            return false;
        }
        const switcher = getSwitcherState(state);

        if (target.closest('[data-connection-chip]')) {
            if (switcher.open) {
                closeSwitcher();
            } else {
                openSwitcher();
            }
            return true;
        }

        if (target.closest('[data-connection-close]')) {
            closeSwitcher();
            return true;
        }

        if (target.closest('[data-connection-result-dismiss]')) {
            switcher.lastResult = null;
            replaceSwitcher();
            focusFirstOption();
            return true;
        }

        const profileButton = target.closest('[data-connection-profile-apply]');
        if (profileButton instanceof HTMLElement) {
            const id = profileButton.dataset.connectionProfileApply || '';
            await applyConnectionProfile(id);
            focusElement(`[data-connection-profile-apply="${cssEscape(id)}"]`);
            return true;
        }

        const modelButton = target.closest('[data-connection-model]');
        if (modelButton instanceof HTMLElement) {
            const model = modelButton.dataset.connectionModel || '';
            await switchModelQuick(model);
            focusElement(`[data-connection-model="${cssEscape(model)}"]`);
            return true;
        }

        if (target.closest('[data-connection-create-open]')) {
            switcher.createOpen = true;
            switcher.createName = suggestConnectionProfileName();
            switcher.error = '';
            replaceSwitcher();
            const input = document.querySelector('[data-connection-create-name]');
            if (input instanceof HTMLInputElement) {
                input.focus();
                input.select();
            }
            return true;
        }

        if (target.closest('[data-connection-create-cancel]')) {
            switcher.createOpen = false;
            switcher.createName = '';
            switcher.error = '';
            replaceSwitcher();
            focusElement('[data-connection-create-open]');
            return true;
        }

        if (target.closest('[data-connection-create-submit]')) {
            await submitCreate();
            return true;
        }

        return false;
    }

    function handleInput(event) {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || !target.matches('[data-connection-create-name]')) {
            return false;
        }
        const switcher = getSwitcherState(state);
        switcher.createName = target.value;
        if (switcher.error) {
            // 重新输入就撤掉上一次的错误提示，直接改 DOM，不重绘以免丢失光标
            switcher.error = '';
            target.removeAttribute('aria-invalid');
            target.removeAttribute('aria-describedby');
            document.querySelector('[data-connection-error]')?.remove();
        }
        return true;
    }

    function handleKeydown(event) {
        const switcher = getSwitcherState(state);
        if (!switcher.open) {
            return false;
        }
        const target = event.target;

        if (event.key === 'Escape') {
            event.preventDefault();
            closeSwitcher();
            return true;
        }

        if (!(target instanceof Element) || !target.closest('[data-connection-popover]')) {
            return false;
        }

        if (event.key === 'Enter' && target.matches('[data-connection-create-name]')) {
            event.preventDefault();
            submitCreate().catch(error => {
                console.warn('Creating a connection profile failed', error);
            });
            return true;
        }

        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !target.matches('input')) {
            const items = [...document.querySelectorAll(focusableSelector)];
            if (!items.length) {
                return false;
            }
            const index = items.indexOf(/** @type {Element} */ (document.activeElement));
            const step = event.key === 'ArrowDown' ? 1 : -1;
            const nextItem = items[(index + step + items.length) % items.length];
            event.preventDefault();
            if (nextItem instanceof HTMLElement) {
                nextItem.focus();
            }
            return true;
        }

        return false;
    }

    return {
        handleClick,
        handleInput,
        handleKeydown,
    };
}
