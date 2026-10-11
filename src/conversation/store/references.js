export const CONNECTION_SETTING_KEYS = ['connectionId', 'auxiliaryConnectionId', 'embeddingConnectionId', 'imageConnectionId'];

/** Connection references only; model names, URLs and other auxiliary configuration are not IDs. */
export function auxiliaryConnectionIds(auxiliary) {
    const ids = new Set();
    const roles = new Set(['memory', 'summary', 'summarization', 'embedding', 'image', 'text']);
    const visit = (value, key = '') => {
        if (typeof value === 'string') {
            if (value && (key === 'connectionId' || key.endsWith('ConnectionId') || roles.has(key))) ids.add(value);
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value) visit(item, key === 'connectionIds' ? 'connectionId' : key);
            return;
        }
        if (value && typeof value === 'object') for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
    };
    visit(auxiliary);
    return [...ids];
}
