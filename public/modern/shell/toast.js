const toastLifetimeMs = 4200;
const stackEdgeGap = 18;
const actionClearance = 12;
// Bottom-anchored controls a toast must not cover: the chat composer (发送 / 继续 / 重生成) and the
// message list's jump-to-latest button right above it. No other route pins actions to the viewport bottom.
const bottomActionSelector = '.composer, .message-jump-latest';

export function createToast({
    elements,
    escapeHtml,
}) {
    let placementFrame = 0;

    function getAvoidedRects(stackRect, viewportHeight) {
        return [...document.querySelectorAll(bottomActionSelector)]
            .map(element => element.getBoundingClientRect())
            .filter(rect => rect.width > 0 && rect.height > 0
                && rect.bottom > 0 && rect.top < viewportHeight
                && rect.left < stackRect.right && rect.right > stackRect.left);
    }

    // Lift the stack above any bottom action it would cover; when there is no room left below the
    // topbar, pin it under the topbar instead
    function placeToastStack() {
        placementFrame = 0;
        const stack = elements.toastStack;
        if (!stack.childElementCount) {
            delete stack.dataset.placement;
            stack.style.removeProperty('--toast-stack-bottom');
            return;
        }

        const viewportHeight = window.innerHeight;
        const stackHeight = stack.offsetHeight;
        const avoidedRects = getAvoidedRects(stack.getBoundingClientRect(), viewportHeight)
            .sort((a, b) => b.top - a.top);
        let bottom = stackEdgeGap;
        for (const rect of avoidedRects) {
            const stackTop = viewportHeight - bottom - stackHeight;
            const stackBottom = viewportHeight - bottom;
            if (rect.top < stackBottom && rect.bottom > stackTop) {
                bottom = viewportHeight - rect.top + actionClearance;
            }
        }

        const topbarBottom = elements.topbar?.getBoundingClientRect().bottom || 0;
        const fitsAboveActions = viewportHeight - bottom - stackHeight >= topbarBottom + actionClearance;
        if (bottom > stackEdgeGap && !fitsAboveActions) {
            stack.dataset.placement = 'top';
            stack.style.removeProperty('--toast-stack-bottom');
            return;
        }

        delete stack.dataset.placement;
        stack.style.setProperty('--toast-stack-bottom', `${Math.round(bottom)}px`);
    }

    function schedulePlacement() {
        if (placementFrame || !elements.toastStack.childElementCount) {
            return;
        }
        placementFrame = window.requestAnimationFrame(placeToastStack);
    }

    function showToast(title, message) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
        elements.toastStack.append(toast);
        placeToastStack();
        window.setTimeout(() => {
            toast.remove();
            placeToastStack();
        }, toastLifetimeMs);
    }

    // Re-place visible toasts when the covered controls move: route renders replace #content,
    // the narrow layout scrolls the page, and the viewport can resize
    window.addEventListener('resize', schedulePlacement);
    document.addEventListener('scroll', schedulePlacement, { capture: true, passive: true });
    if (elements.content && typeof MutationObserver === 'function') {
        new MutationObserver(schedulePlacement).observe(elements.content, { childList: true });
    }

    return { showToast };
}
