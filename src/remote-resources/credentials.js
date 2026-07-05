import { SECRET_KEYS, SecretManager, deleteSecret, readSecret, writeSecret } from '../endpoints/secrets.js';

export const REMOTE_PROVIDER_CREDENTIALS = Object.freeze({
    'github-extensions': [
        {
            id: 'token',
            key: SECRET_KEYS.REMOTE_RESOURCES_GITHUB,
            label: 'GitHub token',
            inputType: 'password',
            description: '用于提升 GitHub API 限流额度。',
        },
    ],
    'chub': [
        {
            id: 'cookie',
            key: SECRET_KEYS.REMOTE_RESOURCES_CHUB_COOKIE,
            label: 'Chub cookie',
            inputType: 'password',
            description: '预留给后续 Chub 登录态搜索和下载。',
        },
    ],
    'risu-realm': [
        {
            id: 'token',
            key: SECRET_KEYS.REMOTE_RESOURCES_RISU_TOKEN,
            label: 'RisuRealm token',
            inputType: 'password',
            description: '预留给后续需要账号权限的 RisuRealm 资源。',
        },
    ],
    'botbooru': [
        {
            id: 'token',
            key: SECRET_KEYS.REMOTE_RESOURCES_BOTBOORU_TOKEN,
            label: 'Botbooru token',
            inputType: 'password',
            description: '可选。粘贴 Botbooru localStorage token，后续用于登录态资源。',
        },
    ],
});

export function getRemoteCredentialValue(directories, providerId, credentialId) {
    const credential = getCredentialDefinition(providerId, credentialId);
    return credential ? readSecret(directories, credential.key) : '';
}

export function getRemoteCredentialState(directories) {
    const manager = new SecretManager(directories);
    const secretState = manager.getSecretState();
    const result = {};

    for (const [providerId, credentials] of Object.entries(REMOTE_PROVIDER_CREDENTIALS)) {
        result[providerId] = credentials.map(credential => {
            const states = secretState[credential.key];
            const activeState = Array.isArray(states) ? states.find(item => item.active) || states[0] : null;
            return {
                id: credential.id,
                label: credential.label,
                inputType: credential.inputType,
                description: credential.description,
                active: Boolean(activeState),
                maskedValue: activeState?.value || '',
                secretId: activeState?.id || '',
            };
        });
    }

    return result;
}

export function saveRemoteCredential(directories, providerId, credentialId, value) {
    const credential = getCredentialDefinition(providerId, credentialId);
    if (!credential) {
        throw new Error('Unknown remote resource credential.');
    }
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error('Credential value is required.');
    }
    return writeSecret(directories, credential.key, value.trim());
}

export function removeRemoteCredential(directories, providerId, credentialId) {
    const credential = getCredentialDefinition(providerId, credentialId);
    if (!credential) {
        throw new Error('Unknown remote resource credential.');
    }
    deleteSecret(directories, credential.key);
}

function getCredentialDefinition(providerId, credentialId) {
    return REMOTE_PROVIDER_CREDENTIALS[providerId]?.find(credential => credential.id === credentialId) || null;
}
