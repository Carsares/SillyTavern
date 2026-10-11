import fs from 'node:fs';
import path from 'node:path';

import { sync as writeFileAtomicSync } from 'write-file-atomic';

const PREFERENCE_DIR = 'remote-resources';
const PREFERENCE_FILE = 'provider-preferences.json';

// A provider is enabled unless the user has explicitly stored a disabled state for it.
const DEFAULT_ENABLED = true;

export function readProviderPreferences(directories) {
    const filePath = getPreferencePath(directories);
    if (!fs.existsSync(filePath)) {
        return {};
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

export function isProviderEnabled(directories, providerId) {
    const preferences = readProviderPreferences(directories);
    return providerEnabledFromMap(preferences, providerId);
}

export function setProviderEnabled(directories, providerId, enabled) {
    const id = String(providerId || '');
    if (!id) {
        throw new Error('Provider id is required.');
    }

    const preferences = readProviderPreferences(directories);
    preferences[id] = Boolean(enabled);
    writeProviderPreferences(directories, preferences);
    return preferences[id];
}

// Resolves the enabled state from an already loaded preference map, defaulting to enabled.
export function providerEnabledFromMap(preferences, providerId) {
    const stored = preferences?.[providerId];
    return typeof stored === 'boolean' ? stored : DEFAULT_ENABLED;
}

function writeProviderPreferences(directories, preferences) {
    const filePath = getPreferencePath(directories);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileAtomicSync(filePath, JSON.stringify(preferences, null, 4), 'utf8');
}

function getPreferencePath(directories) {
    return path.join(directories.root, PREFERENCE_DIR, PREFERENCE_FILE);
}
