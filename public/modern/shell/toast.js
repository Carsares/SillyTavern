export function createToast({
    elements,
    escapeHtml,
}) {
    function showToast(title, message) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
        elements.toastStack.append(toast);
        window.setTimeout(() => toast.remove(), 4200);
    }

    return { showToast };
}
