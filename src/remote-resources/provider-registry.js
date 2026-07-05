import { officialContentProvider } from './providers/official-content.js';
import { githubExtensionsProvider } from './providers/github-extensions.js';
import { gitLabExtensionsProvider } from './providers/gitlab-extensions.js';
import { risuRealmProvider } from './providers/risu-realm.js';
import { chubDirectProvider } from './providers/chub-direct.js';
import { characterTavernProvider } from './providers/character-tavern.js';
import { aiCharacterCardsProvider } from './providers/ai-character-cards.js';
import { loreBaryProvider } from './providers/lorebary.js';
import { bronyaRandArchiveProvider } from './providers/bronya-rand-archive.js';
import { jannyAiProvider } from './providers/jannyai.js';
import { huggingFaceSillyTavernProvider } from './providers/huggingface-sillytavern.js';
import { chatbotsWebringProvider } from './providers/chatbots-webring.js';
import { getRemoteCredentialState } from './credentials.js';

const PROVIDERS = [
    officialContentProvider,
    githubExtensionsProvider,
    gitLabExtensionsProvider,
    risuRealmProvider,
    chubDirectProvider,
    characterTavernProvider,
    aiCharacterCardsProvider,
    loreBaryProvider,
    bronyaRandArchiveProvider,
    jannyAiProvider,
    huggingFaceSillyTavernProvider,
    chatbotsWebringProvider,
];

export function getRemoteResourceProviders(directories) {
    const credentialState = getRemoteCredentialState(directories);
    return PROVIDERS.map(provider => ({
        id: provider.id,
        name: provider.name,
        description: provider.description,
        authMode: provider.authMode || 'none',
        supportsSearch: Boolean(provider.supportsSearch),
        supportsDownload: Boolean(provider.supportsDownload),
        supportsInstall: Boolean(provider.supportsInstall),
        supportsUrlImport: Boolean(provider.supportsUrlImport),
        credentials: credentialState[provider.id] || [],
    }));
}

export async function searchRemoteResources(params, directories) {
    const providerIds = Array.isArray(params.providers) && params.providers.length ? params.providers : PROVIDERS.filter(provider => provider.supportsSearch).map(provider => provider.id);
    const resourceType = params.resourceType || '';
    const searches = providerIds
        .map(id => PROVIDERS.find(provider => provider.id === id))
        .filter(provider => provider?.supportsSearch)
        .map(provider => searchProvider(provider, { ...params, resourceType }, directories));

    const results = await Promise.allSettled(searches);
    const items = [];
    const errors = [];
    let total = 0;

    for (const result of results) {
        if (result.status === 'fulfilled') {
            items.push(...result.value.items);
            total += Number(result.value.total) || result.value.items.length;
        } else {
            errors.push(result.reason?.message || String(result.reason));
        }
    }

    return { items, total, errors };
}

export async function downloadRemoteResource(params, directories) {
    const provider = PROVIDERS.find(item => item.id === params.providerId);
    if (!provider?.supportsDownload || typeof provider.download !== 'function') {
        throw new Error('Remote provider does not support downloads.');
    }

    return provider.download(params, { directories });
}

async function searchProvider(provider, params, directories) {
    return provider.search(params, { directories });
}
