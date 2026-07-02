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

export function downloadFile(content, fileName, contentType = 'application/octet-stream') {
    const blob = content instanceof Blob ? content : new Blob([content], { type: contentType });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
}

export function arrayToEntryInput(value) {
    return Array.isArray(value) ? value.join(', ') : String(value || '');
}

export function entryInputToArray(value) {
    return String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

export function alternateGreetingsToInput(value) {
    return Array.isArray(value) ? value.join('\n---\n') : '';
}

export function inputToAlternateGreetings(value) {
    return String(value || '')
        .split(/\n\s*---\s*\n/g)
        .map(item => item.trim())
        .filter(Boolean);
}

export function numberInput(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

export function setObjectPath(target, path, value) {
    const parts = String(path || '').split('.').filter(Boolean);
    if (!target || !parts.length) {
        return;
    }

    let cursor = target;
    for (const part of parts.slice(0, -1)) {
        if (!cursor[part] || typeof cursor[part] !== 'object') {
            cursor[part] = {};
        }
        cursor = cursor[part];
    }
    cursor[parts.at(-1)] = value;
}

export function parsePreset(rawPreset) {
    if (!rawPreset) {
        return null;
    }
    if (typeof rawPreset === 'string') {
        try {
            return JSON.parse(rawPreset);
        } catch {
            return null;
        }
    }
    return structuredClone(rawPreset);
}

export function maskEndpoint(value) {
    if (!value) {
        return '';
    }

    try {
        const url = new URL(value);
        return `${url.origin}${url.pathname.replace(/\/+$/, '') || '/'}`;
    } catch {
        return String(value).replace(/(key|token|secret)=([^&]+)/gi, '$1=***');
    }
}

export function formatDurationMs(value) {
    const ms = Number(value || 0);
    if (!ms) {
        return '0s';
    }
    if (ms < 1000) {
        return `${formatNumber(ms)}ms`;
    }
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) {
        return `${formatNumber(seconds)}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${formatNumber(minutes)}m ${formatNumber(rest)}s`;
}
