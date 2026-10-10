// The renderer rebuilds #content with innerHTML on every render, so the chat message list is a new
// element each time and its scrollTop starts at 0. This controller snapshots the list right before
// the chat route renders and, in a microtask after the new markup is in place, either keeps the
// list pinned to the newest message or restores where the reader was.
const nearBottomPx = 80;
const messageListSelector = '[data-message-list]';
const jumpButtonSelector = '[data-scroll-to-latest]';
// Other chat-route scroll containers rebuilt by render whose position should survive it.
const preservedScrollSelectors = ['[data-chat-backup-list]', '.backup-preview textarea'];

function getDistanceFromBottom(element) {
    return element.scrollHeight - element.scrollTop - element.clientHeight;
}

function isNearBottom(element) {
    return getDistanceFromBottom(element) <= nearBottomPx;
}

function scrollToBottom(element) {
    element.scrollTop = element.scrollHeight;
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

    function captureSnapshot() {
        const preserved = new Map();
        for (const selector of preservedScrollSelectors) {
            const element = root.querySelector(selector);
            if (element instanceof HTMLElement) {
                preserved.set(selector, element.scrollTop);
            }
        }

        const list = root.querySelector(messageListSelector);
        if (!(list instanceof HTMLElement)) {
            return { preserved, list: null };
        }

        return {
            preserved,
            list: {
                chatKey: list.dataset.chatKey || '',
                firstIndex: Number(list.dataset.firstIndex) || 0,
                scrollTop: list.scrollTop,
                distanceFromBottom: getDistanceFromBottom(list),
                nearBottom: isNearBottom(list),
            },
        };
    }

    function updateJumpButton(list) {
        const button = list.parentElement?.querySelector(jumpButtonSelector);
        if (button instanceof HTMLElement) {
            button.hidden = isNearBottom(list);
        }
    }

    function followIfPinned(list) {
        if (list !== trackedList) {
            return;
        }
        if (pinned) {
            scrollToBottom(list);
        }
        updateJumpButton(list);
    }

    function track(list) {
        if (list === trackedList) {
            return;
        }

        trackedObserver?.disconnect();
        trackedObserver = null;
        trackedList = list instanceof HTMLElement ? list : null;
        if (!trackedList) {
            return;
        }

        const current = trackedList;
        current.addEventListener('scroll', () => {
            if (current !== trackedList) {
                return;
            }
            pinned = isNearBottom(current);
            updateJumpButton(current);
        }, { passive: true });
        // Media inside messages loads after the scroll position was set; load does not bubble, so capture it.
        current.addEventListener('load', () => followIfPinned(current), true);
        trackedObserver = new MutationObserver(() => followIfPinned(current));
        trackedObserver.observe(current, { childList: true, subtree: true, characterData: true });
    }

    function applySnapshot(snapshot) {
        for (const [selector, scrollTop] of snapshot.preserved) {
            const element = root.querySelector(selector);
            if (element instanceof HTMLElement) {
                element.scrollTop = scrollTop;
            }
        }

        const list = root.querySelector(messageListSelector);
        track(list instanceof HTMLElement ? list : null);
        if (!(list instanceof HTMLElement)) {
            return;
        }

        const previous = snapshot.list;
        const firstIndex = Number(list.dataset.firstIndex) || 0;
        if (!previous || previous.chatKey !== (list.dataset.chatKey || '')) {
            // Opened or switched to a chat: start at the newest message.
            scrollToBottom(list);
        } else if (firstIndex < previous.firstIndex) {
            // "加载更早消息" inserted messages above: keep the messages the reader was looking at in place.
            list.scrollTop = list.scrollHeight - list.clientHeight - previous.distanceFromBottom;
        } else if (previous.nearBottom) {
            scrollToBottom(list);
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
        const list = root.querySelector(messageListSelector);
        if (!(list instanceof HTMLElement)) {
            return false;
        }

        scrollToBottom(list);
        pinned = true;
        updateJumpButton(list);
        return true;
    }

    return {
        beforeRender,
        scrollToLatest,
    };
}
