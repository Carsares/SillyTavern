export function getElementScrollTop(element) {
    return element instanceof HTMLElement ? element.scrollTop : null;
}

export function restoreElementScrollTop(element, scrollTop) {
    if (scrollTop === null || !(element instanceof HTMLElement)) {
        return;
    }

    element.scrollTop = scrollTop;
}

export function getScrollTop(selector, root = document) {
    return getElementScrollTop(root.querySelector(selector));
}

export function restoreScrollTop(selector, scrollTop, root = document) {
    restoreElementScrollTop(root.querySelector(selector), scrollTop);
}
