// The renderer rebuilds #content with innerHTML on every render, so the chat message list is a new
// element each time and its scrollTop starts at 0. This controller snapshots the list right before
// the chat route renders and, in a microtask after the new markup is in place, either keeps the
// list pinned to the newest message or restores where the reader was.
const nearBottomPx = 80;
const messageListSelector = '[data-message-list]';
// The Agent panel's message list (components/chat-agent.js) grows with its messages instead of scrolling;
// at desktop width the surrounding .chat-thread scrolls (styles/routes/chat.css), so that element is kept
// at the newest message or at the reader's position.
const agentMessageListSelector = '[data-chat-agent-messages]';
const agentScrollContainerSelector = '.chat-thread';
const jumpButtonSelector = '[data-scroll-to-latest]';
// Other chat-route scroll containers rebuilt by render whose position should survive it.
const preservedScrollSelectors = ['[data-chat-backup-list]', '.backup-preview textarea', '[data-chat-tools-body]'];
// Sidebar lists (rendered by components/chat-sidebar.js). The reader's positions are also remembered
// while the chat route is not shown, and the attribute value names the list content (chat mode /
// owner) so a position is only restored onto the same list.
const sidebarLists = [
    { selector: '[data-chat-entity-list]', datasetKey: 'chatEntityList' },
    { selector: '[data-chat-file-list]', datasetKey: 'chatFileList' },
];
const activeRowSelector = '.resource-row.active';
// Second step of the message manage panel (components/chat-message.js), kept open across renders.
const messageDeleteStepSelector = 'details[data-message-delete-step]';

function getDistanceFromBottom(element) {
    return element.scrollHeight - element.scrollTop - element.clientHeight;
}

function isNearBottom(element) {
    return getDistanceFromBottom(element) <= nearBottomPx;
}

function scrollToBottom(element) {
    element.scrollTop = element.scrollHeight;
}

// scrollIntoView({ block: 'nearest' }) limited to one list: it never scrolls the page or other ancestors.
function revealRowInList(list, row) {
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const top = rowRect.top - listRect.top - list.clientTop;
    const bottom = top + rowRect.height;
    if (top < 0) {
        list.scrollTop += top;
    } else if (bottom > list.clientHeight) {
        list.scrollTop += Math.min(bottom - list.clientHeight, top);
    }
}

/**
 * @param {{ root?: Document, afterRender?: () => void }} [options]
 */
export function createChatScrollController({ root = document, afterRender = () => {} } = {}) {
    let renderPending = false;
    /** @type {HTMLElement | null} */
    let trackedList = null;
    /** @type {MutationObserver | null} */
    let trackedObserver = null;
    // Follows scroll events of the tracked list; content that grows without a render (streaming
    // text, late image loads) only drags the list down while this is true.
    let pinned = true;
    // Sidebar lists. A render, a loading pass or a layout that is not final yet can show a list that
    // is shorter or taller than the settled one; the browser then clamps scrollTop. Those positions,
    // and the ones this controller sets itself, are never taken as the reader's position: only a
    // scroll this controller did not cause updates the memory.
    /** @type {Map<string, number>} reader's scrollTop per sidebar list and content key */
    const sidebarPositions = new Map();
    /** @type {WeakMap<HTMLElement, number>} scrollTop right after this controller positioned a list */
    const positionedScrollTop = new WeakMap();
    /** @type {WeakMap<HTMLElement, { selector: string, datasetKey: string }>} */
    const trackedSidebarLists = new WeakMap();
    // Lists whose active row is kept in view: set when the lists (re)appear (entering the chat route,
    // opening the sidebar) or show content without a remembered position; cleared by a reader scroll.
    const revealActive = new Set();
    // scrollTop the message list got from this controller's last move to the newest message. Its scroll
    // event can arrive after the list shrank again (the composer growing line by line between frames) and
    // must not unpin the reader then.
    /** @type {WeakMap<HTMLElement, number>} */
    const followedScrollTop = new WeakMap();
    // The list shrinks when the composer grows with a longer draft (and on window resizes) without a
    // render or a scroll event; a reader pinned to the newest message stays there.
    const listResizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(entries => {
            for (const { target } of entries) {
                if (target instanceof HTMLElement) {
                    followIfPinned(target);
                }
            }
        })
        : null;
    const sidebarResizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(entries => {
            for (const { target } of entries) {
                repositionAfterResize(target);
            }
        })
        : null;

    function getSidebarPositionKey(element, { selector, datasetKey }) {
        return `${selector}\n${element.dataset[datasetKey] || ''}`;
    }

    function getMaxScrollTop(element) {
        return Math.max(element.scrollHeight - element.clientHeight, 0);
    }

    // True when the current scrollTop was produced by the reader (or other code moving the list on
    // purpose), not by this controller and not by the browser clamping a remembered position.
    function isReaderPosition(element, sidebarList) {
        const scrollTop = element.scrollTop;
        if (positionedScrollTop.get(element) === scrollTop) {
            return false;
        }
        const remembered = sidebarPositions.get(getSidebarPositionKey(element, sidebarList));
        const clamped = remembered !== undefined && scrollTop < remembered && scrollTop >= getMaxScrollTop(element) - 1;
        return !clamped;
    }

    function rememberReaderPosition(element, sidebarList) {
        sidebarPositions.set(getSidebarPositionKey(element, sidebarList), element.scrollTop);
        revealActive.delete(sidebarList.selector);
    }

    function positionSidebarList(element, sidebarList) {
        const remembered = sidebarPositions.get(getSidebarPositionKey(element, sidebarList));
        if (remembered !== undefined) {
            element.scrollTop = remembered;
        }
        const activeRow = element.querySelector(activeRowSelector);
        if (revealActive.has(sidebarList.selector) && activeRow instanceof HTMLElement) {
            revealRowInList(element, activeRow);
        }
        positionedScrollTop.set(element, element.scrollTop);
    }

    // A list that changes size in place (e.g. its layout becomes final after a clamped restore) gets
    // its remembered position and active row back, unless the reader scrolled it meanwhile.
    function repositionAfterResize(element) {
        const sidebarList = element instanceof HTMLElement ? trackedSidebarLists.get(element) : undefined;
        if (!sidebarList || !element.isConnected) {
            sidebarResizeObserver?.unobserve(element);
            return;
        }
        if (root.querySelector(sidebarList.selector) === element && !isReaderPosition(element, sidebarList)) {
            positionSidebarList(element, sidebarList);
        }
    }

    function captureSidebarLists() {
        let present = false;
        for (const sidebarList of sidebarLists) {
            const element = root.querySelector(sidebarList.selector);
            if (element instanceof HTMLElement) {
                present = true;
                if (isReaderPosition(element, sidebarList)) {
                    rememberReaderPosition(element, sidebarList);
                }
            }
        }
        return present;
    }

    function restoreSidebarLists() {
        for (const sidebarList of sidebarLists) {
            const element = root.querySelector(sidebarList.selector);
            if (!(element instanceof HTMLElement)) {
                continue;
            }

            if (!sidebarPositions.has(getSidebarPositionKey(element, sidebarList))) {
                revealActive.add(sidebarList.selector);
            }
            positionSidebarList(element, sidebarList);
            if (!trackedSidebarLists.has(element)) {
                trackedSidebarLists.set(element, sidebarList);
                element.addEventListener('scroll', () => {
                    if (element.isConnected && isReaderPosition(element, sidebarList)) {
                        rememberReaderPosition(element, sidebarList);
                    }
                }, { passive: true });
                sidebarResizeObserver?.observe(element);
            }
        }
    }

    /**
     * The message list on screen and the element that scrolls it. data-chat-key / data-first-index
     * (components/chat-message.js) tell a chat switch or a "load earlier" prepend apart from an update.
     * @returns {{ scroller: HTMLElement, list: HTMLElement, chatKey: string, firstIndex: number } | null}
     */
    function findMessageList() {
        const list = root.querySelector(messageListSelector);
        if (list instanceof HTMLElement) {
            return { scroller: list, list, chatKey: list.dataset.chatKey || '', firstIndex: Number(list.dataset.firstIndex) || 0 };
        }
        const agentList = root.querySelector(agentMessageListSelector);
        if (!(agentList instanceof HTMLElement)) {
            return null;
        }
        const container = agentList.closest(agentScrollContainerSelector);
        return {
            scroller: container instanceof HTMLElement ? container : agentList,
            list: agentList,
            chatKey: `agent:${agentList.dataset.chatAgentMessages || ''}`,
            firstIndex: 0,
        };
    }

    function captureSnapshot() {
        const preserved = new Map();
        for (const selector of preservedScrollSelectors) {
            const element = root.querySelector(selector);
            if (element instanceof HTMLElement) {
                preserved.set(selector, element.scrollTop);
            }
        }
        // No sidebar lists on screen yet: the chat route is being entered or the sidebar opened.
        const sidebarPresent = captureSidebarLists();
        if (!sidebarPresent) {
            for (const { selector } of sidebarLists) {
                revealActive.add(selector);
            }
        }
        const openDeleteStep = root.querySelector(`${messageDeleteStepSelector}[open]`);
        const openDeleteStepKey = openDeleteStep instanceof HTMLElement ? openDeleteStep.dataset.messageDeleteStep || '' : '';

        const found = findMessageList();
        if (!found) {
            return { preserved, openDeleteStepKey, list: null };
        }

        const { scroller } = found;
        return {
            preserved,
            openDeleteStepKey,
            list: {
                chatKey: found.chatKey,
                firstIndex: found.firstIndex,
                scrollTop: scroller.scrollTop,
                distanceFromBottom: getDistanceFromBottom(scroller),
                nearBottom: isNearBottom(scroller),
            },
        };
    }

    function updateJumpButton(list) {
        const button = list.parentElement?.querySelector(jumpButtonSelector);
        if (button instanceof HTMLElement) {
            button.hidden = isNearBottom(list);
        }
    }

    function followToBottom(list) {
        scrollToBottom(list);
        followedScrollTop.set(list, list.scrollTop);
    }

    function followIfPinned(list) {
        if (list !== trackedList) {
            return;
        }
        if (pinned) {
            followToBottom(list);
        }
        updateJumpButton(list);
    }

    /** @param {{ scroller: HTMLElement, list: HTMLElement } | null} found */
    function track(found) {
        const scroller = found?.scroller ?? null;
        if (scroller === trackedList) {
            return;
        }

        trackedObserver?.disconnect();
        trackedObserver = null;
        listResizeObserver?.disconnect();
        trackedList = scroller;
        if (!found) {
            return;
        }

        const current = found.scroller;
        current.addEventListener('scroll', () => {
            if (current !== trackedList) {
                return;
            }
            const followed = followedScrollTop.get(current) === current.scrollTop;
            followedScrollTop.delete(current);
            if (followed) {
                return;
            }
            pinned = isNearBottom(current);
            updateJumpButton(current);
        }, { passive: true });
        // Media inside messages loads after the scroll position was set; load does not bubble, so capture it.
        current.addEventListener('load', () => followIfPinned(current), true);
        // Message text changed without a render (the streaming bubble) follows the newest message too.
        trackedObserver = new MutationObserver(() => followIfPinned(current));
        trackedObserver.observe(found.list, { childList: true, subtree: true, characterData: true });
        listResizeObserver?.observe(current);
    }

    function restoreDeleteStep(openDeleteStepKey) {
        if (!openDeleteStepKey) {
            return;
        }
        for (const step of root.querySelectorAll(messageDeleteStepSelector)) {
            if (step instanceof HTMLDetailsElement && step.dataset.messageDeleteStep === openDeleteStepKey) {
                step.open = true;
            }
        }
    }

    function applySnapshot(snapshot) {
        for (const [selector, scrollTop] of snapshot.preserved) {
            const element = root.querySelector(selector);
            if (element instanceof HTMLElement) {
                element.scrollTop = scrollTop;
            }
        }
        restoreSidebarLists();
        restoreDeleteStep(snapshot.openDeleteStepKey);

        const found = findMessageList();
        track(found);
        if (!found) {
            return;
        }

        const list = found.scroller;
        const previous = snapshot.list;
        if (!previous || previous.chatKey !== found.chatKey) {
            // Opened or switched to a chat: start at the newest message.
            followToBottom(list);
        } else if (found.firstIndex < previous.firstIndex) {
            // "加载更早消息" inserted messages above: keep the messages the reader was looking at in place.
            list.scrollTop = list.scrollHeight - list.clientHeight - previous.distanceFromBottom;
        } else if (previous.nearBottom) {
            followToBottom(list);
        } else {
            list.scrollTop = previous.scrollTop;
        }

        pinned = isNearBottom(list);
        updateJumpButton(list);
    }

    // Call right before the chat route builds its markup. Several renders in the same task share the
    // first snapshot, because later ones would only see the not-yet-positioned list of the first.
    function beforeRender() {
        if (renderPending) {
            return;
        }

        renderPending = true;
        const snapshot = captureSnapshot();
        queueMicrotask(() => {
            renderPending = false;
            applySnapshot(snapshot);
            afterRender();
        });
    }

    function scrollToLatest() {
        const list = findMessageList()?.scroller;
        if (!list) {
            return false;
        }

        followToBottom(list);
        pinned = true;
        updateJumpButton(list);
        return true;
    }

    return {
        beforeRender,
        scrollToLatest,
    };
}
