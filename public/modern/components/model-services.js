// 设置中心「模型连接」里的模型服务列表和场景（对话、翻译）。事件在 routes/api-events.js，动作在 actions/model-services.js。
import { MODEL_SERVICE_PROVIDERS, describeServiceProblem, readChatConnectionService, readModelServices } from '../../shared/model-services.js';
import { CHAT_SCENE_OTHER } from '../actions/model-services.js';

export function createModelServiceComponents(ctx) {
    const {
        state,
        escapeHtml,
        getModelServiceUi,
        hasModelServiceSecret,
        describeModelServiceUsage,
        getChatSceneServiceId,
    } = ctx;

    function providerOptions(selected) {
        return Object.entries(MODEL_SERVICE_PROVIDERS)
            .map(([id, profile]) => `<option value="${escapeHtml(id)}" ${id === selected ? 'selected' : ''}>${escapeHtml(profile.label)}</option>`)
            .join('');
    }

    function renderModelsDatalist(id, models) {
        return models.length ? `<datalist id="${escapeHtml(id)}">${models.map(item => `<option value="${escapeHtml(item)}"></option>`).join('')}</datalist>` : '';
    }

    function renderAddForm(ui) {
        const provider = ui.addProvider || 'custom';
        const profile = MODEL_SERVICE_PROVIDERS[provider];
        return `
            <form class="model-service-add" data-model-service-add-form autocomplete="off" novalidate>
                <div class="form-grid two-columns">
                    <label class="field-label">
                        <span>类型</span>
                        <select class="select-input" data-new-service-provider>${providerOptions(provider)}</select>
                    </label>
                    <label class="field-label">
                        <span>名称</span>
                        <input class="text-input" type="text" maxlength="80" data-new-service-name placeholder="${escapeHtml(profile.label)}">
                    </label>
                    <label class="field-label" data-new-service-base-url-field ${profile.requiresBaseUrl ? '' : 'hidden'}>
                        <span>服务地址</span>
                        <input class="text-input" type="url" data-new-service-base-url placeholder="例如 https://api.deepseek.com">
                    </label>
                    <label class="field-label">
                        <span>API Key</span>
                        <input class="text-input" type="password" autocomplete="new-password" data-new-service-key placeholder="只保存在本机，不会显示出来">
                    </label>
                    <label class="field-label">
                        <span>默认模型</span>
                        <input class="text-input" type="text" data-new-service-model placeholder="可以先留空，添加后获取模型列表再选">
                    </label>
                </div>
                ${ui.addError ? `<p class="field-error" role="alert" data-model-service-add-error>${escapeHtml(ui.addError)}</p>` : ''}
                <div class="message-edit-actions">
                    <button class="primary-button compact-button" type="submit" data-model-service-add-submit>添加</button>
                    <button class="secondary-button compact-button" type="button" data-model-service-add-cancel>取消</button>
                </div>
            </form>`;
    }

    function renderServiceCard(service, registry, ui) {
        const profile = MODEL_SERVICE_PROVIDERS[service.provider];
        const usage = describeModelServiceUsage(registry, service.id);
        const keySaved = hasModelServiceSecret(service);
        const problem = describeServiceProblem(keySaved ? service : { ...service, secretId: '' });
        const models = ui.models[service.id] || { loading: false, items: [], error: '' };
        const test = ui.tests[service.id];
        const confirming = ui.deleteConfirm === service.id;
        const id = escapeHtml(service.id);
        const listId = `service-models-${service.id}`;
        return `
            <article class="resource-card model-service-card" data-model-service-card="${id}">
                <div class="card-head">
                    <div>
                        <h3 class="card-title">${escapeHtml(service.name)}</h3>
                        <div class="card-meta">${escapeHtml(profile.label)}${usage.length ? ` · ${escapeHtml(usage.join('、'))}在用` : ''}</div>
                    </div>
                    <span class="badge ${problem ? 'danger' : 'active'}" data-model-service-state>${escapeHtml(problem || '可用')}</span>
                </div>
                <div class="form-grid two-columns">
                    <label class="field-label">
                        <span>名称</span>
                        <input class="text-input" type="text" maxlength="80" data-service-field="name" data-service-id="${id}" value="${escapeHtml(service.name)}">
                    </label>
                    ${profile.requiresBaseUrl ? `
                    <label class="field-label">
                        <span>服务地址</span>
                        <input class="text-input" type="url" data-service-field="baseUrl" data-service-id="${id}" value="${escapeHtml(service.baseUrl)}" placeholder="例如 https://api.deepseek.com">
                    </label>` : ''}
                    <label class="field-label">
                        <span class="field-label-row">
                            API Key
                            <span class="field-state ${keySaved ? 'is-saved' : ''}">${keySaved ? '已保存' : '未保存'}</span>
                        </span>
                        <input class="text-input" type="password" autocomplete="new-password" data-service-key data-service-id="${id}" placeholder="${keySaved ? '已保存；粘贴新密钥会替换' : '粘贴后离开输入框即保存'}">
                    </label>
                    <label class="field-label">
                        <span class="field-label-row">
                            默认模型
                            <button class="secondary-button compact-button" type="button" data-model-service-models="${id}" ${models.loading ? 'disabled' : ''}>${models.loading ? '读取中…' : '获取模型列表'}</button>
                        </span>
                        <input class="text-input" type="text" data-service-field="defaultModel" data-service-id="${id}" value="${escapeHtml(service.defaultModel)}" ${models.items.length ? `list="${escapeHtml(listId)}"` : ''} placeholder="新场景默认用这个模型">
                        ${renderModelsDatalist(listId, models.items)}
                        ${models.error ? `<span class="field-help warning-text">${escapeHtml(models.error)}</span>` : ''}
                        ${models.items.length ? `<span class="field-help">已读取 ${models.items.length} 个模型，输入时可以从列表里选。</span>` : ''}
                    </label>
                </div>
                ${test ? `<p class="model-service-test ${test.ok ? 'success' : (test.running ? 'muted' : 'danger')}" data-model-service-test-result>${escapeHtml(test.text)}</p>` : ''}
                ${confirming ? `
                <div class="connection-profile-confirm" role="group" aria-label="确认删除模型服务">
                    <span>确定删除「${escapeHtml(service.name)}」？不再被引用的密钥会一起从本机删除。</span>
                    <div class="connection-profile-actions">
                        <button class="secondary-button compact-button danger-action" type="button" data-model-service-delete-confirm="${id}">删除</button>
                        <button class="secondary-button compact-button" type="button" data-model-service-delete-cancel>取消</button>
                    </div>
                </div>` : `
                <div class="connection-profile-actions">
                    <button class="secondary-button compact-button" type="button" data-model-service-test="${id}" ${test?.running ? 'disabled' : ''}>
                        <i class="fa-solid fa-plug-circle-check" aria-hidden="true"></i>
                        测试
                    </button>
                    <button class="secondary-button compact-button danger-action" type="button" data-model-service-delete="${id}" ${usage.length ? `disabled title="${escapeHtml(`${usage.join('、')}场景在用，先给场景换一个服务`)}"` : ''}>
                        <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                        删除
                    </button>
                </div>`}
            </article>`;
    }

    // 模型服务列表：登记一次地址和密钥，各场景直接选用
    function renderModelServicesPanel() {
        const registry = readModelServices(state.settings);
        const ui = getModelServiceUi();
        return `
        <section class="panel section-panel model-services" data-model-services>
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">模型服务</h2>
                    <p class="panel-subtitle">在这里登记模型服务的地址和 API Key，下面的对话、翻译等场景直接选用，不用重复填写。密钥只保存在本机。</p>
                </div>
                <div class="panel-actions">
                    ${ui.addOpen ? '' : `
                    <button class="secondary-button" type="button" data-model-service-add-open>
                        <i class="fa-solid fa-plus" aria-hidden="true"></i>
                        添加模型服务
                    </button>`}
                </div>
            </div>
            ${ui.addOpen ? renderAddForm(ui) : ''}
            ${registry.services.length ? `
            <div class="grid-list model-service-list">
                ${registry.services.map(service => renderServiceCard(service, registry, ui)).join('')}
            </div>` : `
            <div class="connection-profiles-empty">
                <i class="fa-solid fa-server" aria-hidden="true"></i>
                <strong>还没有模型服务</strong>
                <span>点「添加模型服务」登记一个，或在下面的对话场景里把当前连接登记为模型服务。</span>
            </div>`}
        </section>`;
    }

    /**
     * 场景：对话和翻译各选一个模型服务。
     * @param {() => string} renderChatSceneEditor 对话场景下方的编辑器（聊天补全或其他接口）
     * @returns {string} HTML
     */
    function renderModelScenesPanel(renderChatSceneEditor) {
        const registry = readModelServices(state.settings);
        const ui = getModelServiceUi();
        const mainApi = state.settings.main_api || 'openai';
        const chatServiceId = mainApi === 'openai' ? getChatSceneServiceId(registry) : '';
        const chatConnection = readChatConnectionService(state.settings);
        const chatValue = mainApi !== 'openai' ? CHAT_SCENE_OTHER : chatServiceId;
        const translation = registry.scenes.translation;
        const translationService = registry.services.find(item => item.id === translation.serviceId) || null;
        const translationModels = translationService ? (ui.models[translationService.id]?.items || []) : [];
        const followText = chatConnection && chatConnection.model
            ? `跟随对话场景（${chatServiceId ? registry.services.find(item => item.id === chatServiceId)?.name : chatConnection.service.name} · ${chatConnection.model}）`
            : '跟随对话场景';

        return `
        <section class="panel section-panel model-scenes" data-model-scenes>
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">场景</h2>
                    <p class="panel-subtitle">每个场景选用一个模型服务和模型，改动会自动保存。</p>
                </div>
            </div>
            <div class="model-scene" data-model-scene="chat">
                <div class="form-grid two-columns">
                    <label class="field-label">
                        <span>对话</span>
                        <select class="select-input" data-scene-chat-service>
                            ${registry.services.map(service => `<option value="${escapeHtml(service.id)}" ${chatValue === service.id ? 'selected' : ''}>${escapeHtml(service.name)}</option>`).join('')}
                            <option value="" ${chatValue === '' ? 'selected' : ''}>直接配置聊天补全来源（不使用模型服务）</option>
                            <option value="${CHAT_SCENE_OTHER}" ${chatValue === CHAT_SCENE_OTHER ? 'selected' : ''}>其他接口：文本补全、KoboldAI、NovelAI、AI Horde</option>
                        </select>
                        <span class="field-help">角色聊天用的模型。选择后立即生效。</span>
                    </label>
                </div>
                ${renderChatSceneEditor()}
            </div>
            <div class="model-scene" data-model-scene="translation">
                <div class="form-grid two-columns">
                    <label class="field-label">
                        <span>翻译</span>
                        <select class="select-input" data-scene-translation-service>
                            <option value="" ${translation.serviceId ? '' : 'selected'}>${escapeHtml(followText)}</option>
                            ${registry.services.map(service => `<option value="${escapeHtml(service.id)}" ${translation.serviceId === service.id ? 'selected' : ''}>${escapeHtml(service.name)}</option>`).join('')}
                        </select>
                        <span class="field-help">「设置 → 聊天工具 → 翻译」选择大模型翻译时使用。</span>
                    </label>
                    ${translationService ? `
                    <label class="field-label">
                        <span class="field-label-row">
                            翻译模型
                            <button class="secondary-button compact-button" type="button" data-model-service-models="${escapeHtml(translationService.id)}">获取模型列表</button>
                        </span>
                        <input class="text-input" type="text" data-scene-translation-model value="${escapeHtml(translation.model)}" ${translationModels.length ? 'list="translation-scene-models"' : ''} placeholder="${escapeHtml(translationService.defaultModel || '例如 deepseek-chat')}">
                        ${renderModelsDatalist('translation-scene-models', translationModels)}
                    </label>` : ''}
                    <label class="field-label">
                        <span>翻译回复上限</span>
                        <input class="text-input" type="number" inputmode="numeric" min="256" max="65536" step="1" data-scene-translation-max-tokens value="${escapeHtml(translation.maxOutputTokens)}">
                        <span class="field-help">一段译文最多多少 token；太小时长消息会被截断。</span>
                    </label>
                </div>
            </div>
        </section>`;
    }

    return {
        renderModelServicesPanel,
        renderModelScenesPanel,
    };
}
