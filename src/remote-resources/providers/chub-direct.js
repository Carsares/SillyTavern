import { downloadChubCharacter, downloadChubLorebook } from '../../chub.js';
import { SECRET_KEYS, readSecret } from '../../endpoints/secrets.js';
import { searchChubViaCdp } from '../chub-cdp.js';
import { REMOTE_RESOURCE_TYPES, clampLimit, formatRemoteResource } from './shared.js';

export const chubDirectProvider = {
    id: 'chub',
    name: 'Chub / CharacterHub',
    description: 'Chub 角色和世界书搜索通过本机 Chrome/CDP 捕获公开搜索页请求；URL 导入继续复用现有 Chub 下载链路。',
    authMode: 'cookie',
    supportsSearch: true,
    supportsDownload: true,
    supportsInstall: false,
    supportsUrlImport: true,

    async search(params, context) {
        const limit = clampLimit(params.limit);
        const result = await searchChubViaCdp(
            {
                ...params,
                limit,
            },
            {
                directories: context.directories,
                cookie: readSecret(context.directories, SECRET_KEYS.REMOTE_RESOURCES_CHUB_COOKIE),
            },
        );

        return {
            items: result.items.slice(0, limit).map(item => formatRemoteResource(this, item)),
            total: result.total,
        };
    },

    async download(params) {
        const resourceType = params.resourceType || REMOTE_RESOURCE_TYPES.CHARACTER;
        const id = String(params.resourceId || '').trim();
        if (!id) {
            throw new Error('Chub resource ID is required.');
        }

        if (resourceType === REMOTE_RESOURCE_TYPES.CHARACTER) {
            return {
                ...(await downloadChubCharacter(id.replace(/^characters\//, ''))),
                resourceType,
            };
        }

        if (resourceType === REMOTE_RESOURCE_TYPES.WORLDBOOK) {
            const lorebookId = id.startsWith('lorebooks/') ? id : `lorebooks/${id}`;
            return {
                ...(await downloadChubLorebook(lorebookId)),
                resourceType,
            };
        }

        throw new Error(`Chub does not support downloading ${resourceType}.`);
    },
};
