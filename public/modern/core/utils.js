export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function formatNumber(value) {
    const number = Number(value || 0);
    return new Intl.NumberFormat('zh-CN').format(number);
}

export function formatBytes(value) {
    const number = Number(value || 0);
    if (!number) {
        return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(number) / Math.log(1024)), units.length - 1);
    return `${(number / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDate(value) {
    if (!value) {
        return '未知';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '未知';
    }

    return new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

export function stripJsonlExtension(value) {
    return String(value || '').replace(/\.jsonl$/i, '');
}

export function getAvatarUrl(character) {
    if (!character?.avatar) {
        return '';
    }

    return `/characters/${encodeURIComponent(character.avatar)}`;
}

export function getPersonaUrl(avatarId) {
    return `/User%20Avatars/${encodeURIComponent(avatarId)}`;
}

export function normalizeText(value) {
    return String(value ?? '').toLowerCase();
}

export function uniqueValues(values) {
    return [...new Set(values.filter(Boolean))];
}
