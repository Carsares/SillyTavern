// 设置中心「模型连接」里的模型服务和场景：登记、编辑、删除服务，给场景选服务和模型，拉取模型列表，测试服务。
// 数据结构见 public/shared/model-services.js。所有写入走 actions/settings-autosave.js（改动即保存、失败回滚、通知引擎重载）。
//
// 对话场景选中一个服务时，把它的来源、地址、模型写进 oai_settings，并把它的密钥切为该来源当前启用的那条
// （/api/secrets/rotate），所以生成链路不用改；其它场景（翻译）由服务端按 secretId 读取，不受「当前启用」影响。
import {
    MODEL_SERVICE_PROVIDERS,
    isServiceBaseUrl,
    readChatConnectionService,
    readModelServices,
} from '../../shared/model-services.js';
import { resolveChatContextUnlock } from './chat-completion-limits.js';

/** 对话场景下拉里「其他接口」（文本补全、KoboldAI、NovelAI、AI Horde）的值。 */
export const CHAT_SCENE_OTHER = '__other__';
const REGISTRY_PATH = ['extension_settings', 'modelServices'];

/**
 * @param {string} baseUrl 地址
 * @returns {string} 用地址的主机名做服务名，解析不了时为空
 */
function hostName(baseUrl) {
    try {
        return new URL(baseUrl).host;
    } catch {
        return '';
    }
}

/**
 * @returns {string} 新的服务 id
 */
function newServiceId() {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `svc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @param {object} options 依赖
 * @param {any} options.state 页面状态
 * @param {(path: string, options?: object) => Promise<any>} options.apiFetch 请求
 * @param {() => void} options.render 整页重绘
 * @param {(title: string, message: string) => void} options.showToast 提示
 * @param {ReturnType<typeof import('./settings-autosave.js').createSettingsAutosave>} options.autosave 改动即保存
 */
export function createModelServiceActions({ state, apiFetch, render, showToast, autosave }) {
    let migrationAttempted = false;

    function getRegistry() {
        return readModelServices(state.settings);
    }

    /** @returns {Record<string, any>} 界面状态：添加表单、删除确认、模型列表、测试结果 */
    function getUi() {
        state.modelServicesUi ??= { addOpen: false, addError: '', deleteConfirm: '', models: {}, tests: {} };
        return state.modelServicesUi;
    }

    /**
     * 整份登记表写回（替换 services 和 scenes），一起写入的还有 extraChanges。
     * @param {import('../../shared/model-services.js').ModelServiceRegistry} registry 新登记表
     * @param {string} label 状态提示名称
     * @param {Array<[string[], unknown]>} [extraChanges] 其它要一起写入的设置
     */
    function commitRegistry(registry, label, extraChanges = []) {
        return autosave.commit({ changes: [[REGISTRY_PATH, structuredClone(registry)], ...extraChanges], label });
    }

    /**
     * 某个密钥名下当前启用的那条的 id。
     * @param {string} secretKey 密钥名
     * @returns {string} id，没有时为空
     */
    function getActiveSecretId(secretKey) {
        const entries = state.secretState?.[secretKey];
        return Array.isArray(entries) ? (entries.find(entry => entry?.active)?.id || '') : '';
    }

    /**
     * @param {import('../../shared/model-services.js').ModelService} service 服务
     * @returns {boolean} 密钥库里有这个服务的那条密钥
     */
    function hasServiceSecret(service) {
        const entries = state.secretState?.[service.secretKey];
        return Boolean(service.secretId) && Array.isArray(entries) && entries.some(entry => entry?.id === service.secretId);
    }

    /**
     * 设置里还从没有过登记表时，用当前对话连接建第一条服务并设为对话场景。只尝试一次；不改现有的连接设置和密钥。
     * 登记表一旦存在（哪怕用户把服务都删了）就不再自动建。
     * @returns {Promise<boolean>} 是否新建了服务
     */
    async function ensureMigrated() {
        if (migrationAttempted || !state.loaded || !state.secretState) {
            return false;
        }
        migrationAttempted = true;
        if (state.settings?.extension_settings?.modelServices !== undefined || !readChatConnectionService(state.settings)) {
            return false;
        }
        const result = await registerCurrentConnection();
        return result.ok;
    }

    /**
     * 把当前对话连接登记为模型服务并设为对话场景（「登记为模型服务」按钮）。
     * @returns {Promise<{ ok: boolean, error?: string }>} 结果
     */
    async function registerCurrentConnection() {
        const chat = readChatConnectionService(state.settings);
        if (!chat) {
            return { ok: false, error: '当前对话来源不能登记为模型服务。' };
        }
        const registry = getRegistry();
        const profile = MODEL_SERVICE_PROVIDERS[chat.service.provider];
        const service = {
            ...chat.service,
            id: newServiceId(),
            name: (chat.service.provider === 'custom' && hostName(chat.service.baseUrl)) || profile.label,
            secretId: getActiveSecretId(chat.service.secretKey),
            defaultModel: chat.model,
        };
        registry.services.push(service);
        registry.scenes.chat.serviceId = service.id;
        const result = await commitRegistry(registry, '模型服务');
        render();
        return result.ok ? { ok: true } : { ok: false, error: '模型服务没有保存成功。' };
    }

    /**
     * 新增一个服务；有 API Key 时写进密钥库但不改变当前启用的那条。
     * @param {{ provider: string, name: string, baseUrl: string, apiKey: string, defaultModel: string }} input 表单取值
     * @returns {Promise<{ ok: boolean, error?: string, id?: string }>} 结果
     */
    async function addService(input) {
        const profile = MODEL_SERVICE_PROVIDERS[input.provider];
        if (!profile) {
            return { ok: false, error: '请选择服务类型。' };
        }
        const baseUrl = String(input.baseUrl || '').trim();
        if (profile.requiresBaseUrl && !baseUrl) {
            return { ok: false, error: '这个类型需要填写服务地址，例如 https://api.deepseek.com。' };
        }
        if (baseUrl && !isServiceBaseUrl(baseUrl)) {
            return { ok: false, error: '服务地址需是以 http:// 或 https:// 开头的完整地址。' };
        }
        const apiKey = String(input.apiKey || '').trim();
        let secretId = '';
        if (apiKey) {
            const written = await autosave.commitSecret({ key: profile.secretKey, value: apiKey, label: `model service: ${input.name || profile.label}`, description: 'API Key', activate: false });
            if (!written.ok || !written.id) {
                return { ok: false, error: 'API Key 没有保存成功，服务没有添加。' };
            }
            secretId = written.id;
        }
        const registry = getRegistry();
        const service = {
            id: newServiceId(),
            name: String(input.name || '').trim() || (profile.requiresBaseUrl && hostName(baseUrl)) || profile.label,
            provider: input.provider,
            baseUrl: profile.requiresBaseUrl ? baseUrl : '',
            secretKey: profile.secretKey,
            secretId,
            defaultModel: String(input.defaultModel || '').trim(),
        };
        registry.services.push(service);
        const result = await commitRegistry(registry, '模型服务');
        return result.ok ? { ok: true, id: service.id } : { ok: false, error: '模型服务没有保存成功。' };
    }

    /**
     * 改服务的名称、地址或默认模型。对话场景正在用这个服务时，地址也同步到 oai_settings。
     * @param {string} serviceId 服务 id
     * @param {'name' | 'baseUrl' | 'defaultModel'} field 字段
     * @param {string} value 新值
     * @returns {Promise<{ ok: boolean, error?: string }>} 结果
     */
    async function updateServiceField(serviceId, field, value) {
        const registry = getRegistry();
        const service = registry.services.find(item => item.id === serviceId);
        if (!service) {
            return { ok: false, error: '这个模型服务已经不存在了。' };
        }
        const text = String(value ?? '').trim();
        if (field === 'baseUrl') {
            if (MODEL_SERVICE_PROVIDERS[service.provider].requiresBaseUrl && !text) {
                return { ok: false, error: '这个类型需要填写服务地址。' };
            }
            if (text && !isServiceBaseUrl(text)) {
                return { ok: false, error: '服务地址需是以 http:// 或 https:// 开头的完整地址。' };
            }
        }
        if (field === 'name' && !text) {
            return { ok: false, error: '请填写服务名称。' };
        }
        service[field] = text;
        /** @type {Array<[string[], unknown]>} */
        const extra = [];
        if (field === 'baseUrl' && registry.scenes.chat.serviceId === service.id && service.provider === 'custom') {
            extra.push([['oai_settings', 'custom_url'], text]);
        }
        const label = { name: '服务名称', baseUrl: '服务地址', defaultModel: '默认模型' }[field] || '模型服务';
        const result = await commitRegistry(registry, label, extra);
        return result.ok ? { ok: true } : { ok: false, error: `${label}没有保存成功。` };
    }

    /**
     * 换服务的 API Key：写一条新的密钥（不改变当前启用项），记到服务上；对话场景正在用这个服务时把新密钥切为当前。
     * 旧的那条没有别的服务引用、也不是当前启用的就删掉。
     * @param {string} serviceId 服务 id
     * @param {string} apiKey 新密钥
     * @returns {Promise<{ ok: boolean, error?: string }>} 结果
     */
    async function updateServiceKey(serviceId, apiKey) {
        const registry = getRegistry();
        const service = registry.services.find(item => item.id === serviceId);
        const value = String(apiKey || '').trim();
        if (!service || !value) {
            return { ok: false, error: service ? '' : '这个模型服务已经不存在了。' };
        }
        const written = await autosave.commitSecret({ key: service.secretKey, value, label: `model service: ${service.name}`, description: 'API Key', activate: false });
        if (!written.ok || !written.id) {
            return { ok: false, error: 'API Key 没有保存成功。' };
        }
        const oldSecretId = service.secretId;
        service.secretId = written.id;
        const result = await commitRegistry(registry, 'API Key');
        if (!result.ok) {
            return { ok: false, error: 'API Key 已写入密钥库，但服务记录没有更新成功。' };
        }
        if (registry.scenes.chat.serviceId === service.id) {
            await rotateSecret(service.secretKey, service.secretId);
        }
        const stillUsed = registry.services.some(item => item.secretKey === service.secretKey && item.secretId === oldSecretId);
        if (oldSecretId && !stillUsed && getActiveSecretId(service.secretKey) !== oldSecretId) {
            await apiFetch('/api/secrets/delete', { body: { key: service.secretKey, id: oldSecretId } }).catch(() => {});
            await refreshSecretState();
        }
        return { ok: true };
    }

    async function refreshSecretState() {
        try {
            state.secretState = await apiFetch('/api/secrets/read');
        } catch {
            // 读不到最新状态不影响已经完成的写入，下次整页刷新会再读
        }
    }

    /**
     * @param {string} key 密钥名
     * @param {string} id 条目 id
     */
    async function rotateSecret(key, id) {
        if (!id || getActiveSecretId(key) === id) {
            return;
        }
        try {
            await apiFetch('/api/secrets/rotate', { body: { key, id } });
        } catch (error) {
            showToast('切换密钥失败', error.message);
        }
        await refreshSecretState();
    }

    /**
     * 删除服务。场景正在用的服务不能删；它的密钥没有别的服务引用、也不是当前启用的就一起删掉。
     * @param {string} serviceId 服务 id
     * @returns {Promise<{ ok: boolean, error?: string }>} 结果
     */
    async function deleteService(serviceId) {
        const registry = getRegistry();
        const service = registry.services.find(item => item.id === serviceId);
        if (!service) {
            return { ok: true };
        }
        const usedBy = describeServiceUsage(registry, serviceId);
        if (usedBy.length) {
            return { ok: false, error: `「${service.name}」正在被${usedBy.join('、')}场景使用，先给场景换一个服务再删除。` };
        }
        registry.services = registry.services.filter(item => item.id !== serviceId);
        const result = await commitRegistry(registry, '模型服务');
        if (!result.ok) {
            return { ok: false, error: '模型服务没有删除成功。' };
        }
        const stillUsed = registry.services.some(item => item.secretKey === service.secretKey && item.secretId === service.secretId);
        if (service.secretId && !stillUsed && getActiveSecretId(service.secretKey) !== service.secretId) {
            await apiFetch('/api/secrets/delete', { body: { key: service.secretKey, id: service.secretId } }).catch(() => {});
            await refreshSecretState();
        }
        return { ok: true };
    }

    /**
     * 哪些场景在用这个服务。
     * @param {ReturnType<typeof readModelServices>} registry 登记表
     * @param {string} serviceId 服务 id
     * @returns {string[]} 场景名
     */
    function describeServiceUsage(registry, serviceId) {
        const chatService = getChatSceneServiceId(registry);
        return [
            chatService === serviceId ? '对话' : '',
            registry.scenes.translation.serviceId === serviceId || (!registry.scenes.translation.serviceId && chatService === serviceId) ? '翻译' : '',
        ].filter(Boolean);
    }

    /**
     * 对话场景实际在用的服务 id：场景记录的服务和当前对话来源一致时才算（应用连接档案后可能已经换了来源）。
     * @param {ReturnType<typeof readModelServices>} [registry] 登记表
     * @returns {string} 服务 id，没有时为空（主 API 不是聊天补全，或当前连接还没登记）
     */
    function getChatSceneServiceId(registry = getRegistry()) {
        const chat = readChatConnectionService(state.settings);
        if (!chat) {
            return '';
        }
        const service = registry.services.find(item => item.id === registry.scenes.chat.serviceId);
        return service && service.provider === chat.service.provider ? service.id : '';
    }

    /**
     * 对话场景选服务：写主 API、来源、地址和模型，把服务的密钥切为当前，再重载引擎。选「其他接口」时切到文本补全编辑器。
     * @param {string} serviceId 服务 id 或 CHAT_SCENE_OTHER
     * @returns {Promise<void>}
     */
    async function selectChatService(serviceId) {
        if (!serviceId) {
            // 直接配置聊天补全来源：不再记录对话场景的服务，来源、地址和密钥保持现状
            const registry = getRegistry();
            registry.scenes.chat.serviceId = '';
            const extra = (state.settings.main_api || 'openai') === 'openai' ? [] : [[['main_api'], 'openai']];
            await commitRegistry(registry, '对话场景', /** @type {Array<[string[], unknown]>} */ (extra));
            render();
            return;
        }
        if (serviceId === CHAT_SCENE_OTHER) {
            if ((state.settings.main_api || 'openai') === 'openai') {
                await autosave.commit({ changes: [[['main_api'], 'textgenerationwebui']], label: '对话场景' });
            }
            render();
            return;
        }
        const registry = getRegistry();
        const service = registry.services.find(item => item.id === serviceId);
        if (!service) {
            return;
        }
        const profile = MODEL_SERVICE_PROVIDERS[service.provider];
        const oai = state.settings.oai_settings || {};
        const model = oai[profile.modelField] || service.defaultModel || '';
        registry.scenes.chat.serviceId = service.id;
        /** @type {Array<[string[], unknown]>} */
        const changes = [
            [['main_api'], 'openai'],
            [['chat_completion_source'], service.provider],
            [['oai_settings', 'chat_completion_source'], service.provider],
        ];
        if (service.provider === 'custom') {
            changes.push([['oai_settings', 'custom_url'], service.baseUrl]);
        }
        if (model) {
            changes.push([['oai_settings', profile.modelField], model]);
        }
        const context = Number(oai.openai_max_context);
        const unlocked = Number.isFinite(context) ? resolveChatContextUnlock({ source: service.provider, model, context }) : null;
        if (unlocked !== null) {
            changes.push([['oai_settings', 'max_context_unlocked'], unlocked]);
        }
        const result = await commitRegistry(registry, '对话场景', changes);
        if (result.ok && hasServiceSecret(service)) {
            await rotateSecret(service.secretKey, service.secretId);
        }
        render();
    }

    /**
     * 翻译场景：选服务（空 = 跟随对话场景）、模型或回复上限。
     * @param {'serviceId' | 'model' | 'maxOutputTokens'} field 字段
     * @param {string} value 新值
     * @returns {Promise<{ ok: boolean, error?: string }>} 结果
     */
    async function updateTranslationScene(field, value) {
        const registry = getRegistry();
        const scene = registry.scenes.translation;
        if (field === 'maxOutputTokens') {
            const number = Number(value);
            if (!Number.isSafeInteger(number) || number < 256 || number > 65536) {
                return { ok: false, error: '回复上限需为 256 到 65,536 之间的整数。' };
            }
            scene.maxOutputTokens = number;
        } else if (field === 'serviceId') {
            scene.serviceId = String(value || '');
            if (!scene.serviceId) {
                scene.model = '';
            } else {
                const service = registry.services.find(item => item.id === scene.serviceId);
                scene.model = service?.defaultModel || '';
            }
        } else {
            scene.model = String(value || '').trim();
        }
        const label = { serviceId: '翻译场景', model: '翻译模型', maxOutputTokens: '翻译回复上限' }[field];
        const result = await commitRegistry(registry, label);
        if (result.ok && field === 'serviceId') {
            render();
        }
        return result.ok ? { ok: true } : { ok: false, error: `${label}没有保存成功。` };
    }

    /**
     * 拉取服务的模型列表（复用 /api/backends/chat-completions/status，按 secretId 读密钥）。结果放在界面状态里，不写设置。
     * @param {string} serviceId 服务 id
     * @returns {Promise<void>}
     */
    async function loadServiceModels(serviceId) {
        const service = getRegistry().services.find(item => item.id === serviceId);
        if (!service) {
            return;
        }
        const ui = getUi();
        ui.models[serviceId] = { loading: true, items: ui.models[serviceId]?.items || [], error: '' };
        render();
        try {
            const result = await apiFetch('/api/backends/chat-completions/status', {
                body: {
                    chat_completion_source: service.provider,
                    ...(service.baseUrl ? { custom_url: service.baseUrl } : {}),
                    ...(service.secretId ? { secret_id: service.secretId } : {}),
                },
            });
            const list = Array.isArray(result?.data) ? result.data : (Array.isArray(result?.models) ? result.models : []);
            const items = [...new Set(list.map(item => (typeof item === 'string' ? item : item?.id || item?.name)).filter(id => typeof id === 'string' && id))].sort();
            ui.models[serviceId] = { loading: false, items, error: result?.error && !items.length ? '服务没有返回模型列表，可以直接手填模型名。' : '' };
        } catch (error) {
            ui.models[serviceId] = { loading: false, items: [], error: `模型列表读取失败：${error.message}。可以直接手填模型名。` };
        }
        render();
    }

    /**
     * 测试服务：用服务的默认模型（或传入的模型）发一句「只回复 OK」。
     * @param {string} serviceId 服务 id
     * @returns {Promise<void>}
     */
    async function testService(serviceId) {
        const ui = getUi();
        ui.tests[serviceId] = { running: true, ok: false, text: '测试中…' };
        render();
        await autosave.flush();
        try {
            const result = await apiFetch('/api/model-services/test', { body: { serviceId } });
            const reply = String(result?.content || '').trim();
            ui.tests[serviceId] = {
                running: false,
                ok: true,
                text: reply ? `可用：${result.model} 回复「${reply.slice(0, 40)}」` : `可用：${result.model} 只返回了推理内容`,
            };
        } catch (error) {
            ui.tests[serviceId] = { running: false, ok: false, text: describeServiceTestFailure(error) };
        }
        render();
    }

    return {
        getRegistry,
        getUi,
        hasServiceSecret,
        ensureMigrated,
        registerCurrentConnection,
        addService,
        updateServiceField,
        updateServiceKey,
        deleteService,
        describeServiceUsage,
        getChatSceneServiceId,
        selectChatService,
        updateTranslationScene,
        loadServiceModels,
        testService,
    };
}

/**
 * 服务测试失败的说明。后端失败时返回 `{ error, message, detail? }`（src/endpoints/model-services.js）。
 * @param {any} error apiFetch 抛出的错误
 * @returns {string} 说明
 */
export function describeServiceTestFailure(error) {
    /** @type {any} */
    let body = null;
    try {
        body = typeof error?.body === 'string' ? JSON.parse(error.body) : null;
    } catch {
        body = null;
    }
    switch (body?.error) {
        case 'model-missing':
            return '还没有默认模型：先填写默认模型再测试。';
        case 'secret-missing':
            return '还没有保存 API Key。';
        case 'invalid-service':
            return '服务配置不完整或无效，检查类型和地址。';
        case 'provider-http-error':
            return `服务返回了错误：${body.detail || body.message}`;
        case 'provider-timeout':
            return '服务太久没有回复。';
        case 'provider-network-error':
            return '连不上服务，检查网络、代理和地址。';
        default:
            return `测试失败：${body?.message || error?.message || '未知错误'}`;
    }
}
