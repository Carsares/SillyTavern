// 设置中心「模型连接」→「图片模型」（WP1）的界面：配置摘要、连接、默认参数、密钥、诊断卡、「从消息生成提示词」设置。
// 方案见 docs/image-generation/FRONTEND-DESIGN.md 第 3 节；事件在 routes/image-model-events.js，动作在 actions/image-model-settings.js。
//
// 外层容器是 data-image-model-form，不是 data-api-connection-form（前端设计 F7）：图片字段的报错不能挡住文本连接的
// 「测试连接」，也不能被套上文本表单的回车保存。整块放在「模型连接」标签的 data-preserve-inputs 里，每个控件都有固定的
// data-image-model-* 属性，整页重绘时 core/preserve-inputs.js 能按它找回焦点和没提交的输入。
import { createApiFieldComponents } from './api-fields.js';
import { getEffectiveConnection } from '../core/connection-labels.js';
import {
    IMAGE_GENERATION_SECRET_KEY,
    IMAGE_PROVIDERS,
    PROMPT_SOURCE_LIMITS,
    getImageConfigReadiness,
    getImageGenerationConfig,
    getImageOptionTables,
    getImageProvider,
    isImageKeySaved,
} from '../core/image-generation-config.js';
import { getCachedImageCapabilities, getCapabilityCacheKey } from '../core/image-generation-capabilities.js';
import {
    describeImageCapabilityReason,
    describeImageModelParameters,
    ensureImageModelUiState,
    getImageModelParameterStates,
} from '../actions/image-model-settings.js';

/** 「模型连接」标签顶部的切换。 */
export const SETTINGS_CONNECTION_VIEWS = Object.freeze([
    Object.freeze({ id: 'text', icon: 'fa-message', label: '文本模型' }),
    Object.freeze({ id: 'image', icon: 'fa-image', label: '图片模型' }),
]);

const UNSUPPORTED_HINT = '当前供应商不支持';
const DIAG_ICONS = Object.freeze({ ok: 'fa-circle-check', warn: 'fa-triangle-exclamation', error: 'fa-circle-xmark', muted: 'fa-circle-info' });

/**
 * 「文本模型 / 图片模型」分段切换，沿用设置中心标签条的 .segmented-control。
 * @param {string} view 当前视图
 * @param {(value: unknown) => string} escapeHtml 转义函数
 * @returns {string} HTML
 */
export function renderSettingsConnectionViewSwitch(view, escapeHtml) {
    const current = view === 'image' ? 'image' : 'text';
    return `
            <div class="segmented-control settings-connection-switch" role="tablist" aria-label="模型类型">
                ${SETTINGS_CONNECTION_VIEWS.map(({ id, icon, label }) => `
                    <button class="${current === id ? 'active' : ''}" type="button" role="tab" data-settings-connection-view="${id}" aria-selected="${current === id}">
                        <i class="fa-solid ${icon}" aria-hidden="true"></i>
                        ${escapeHtml(label)}
                    </button>
                `).join('')}
            </div>`;
}

/**
 * @param {number} time 时间戳
 * @returns {string} 时:分:秒
 */
function formatClock(time) {
    return time ? new Date(time).toLocaleTimeString('zh-CN', { hour12: false }) : '';
}

/**
 * @param {object} ctx 路由上下文（state、escapeHtml、getProviderInfo、getNumberSetting，以及 ensureImageModelCapabilities 动作）
 */
export function createSettingsImageModelComponents(ctx) {
    const { state, escapeHtml, getProviderInfo } = ctx;
    const { renderSecretField } = createApiFieldComponents(ctx);

    /**
     * 选项列表；当前值不在候选里时放在最前面（选项表里没有的值也允许，见前端设计 3.2）。
     * @param {string[][]} list [值, 名称]
     * @param {string} current 当前值
     * @returns {string} HTML
     */
    function renderOptions(list, current) {
        const value = String(current ?? '');
        const items = list.some(([item]) => item === value) ? list : [[value, value ? `当前：${value}` : '供应商默认'], ...list];
        return items.map(([item, label]) => `<option value="${escapeHtml(item)}" ${item === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
    }

    /**
     * 默认参数里的一个字段：不支持时置灰并写明原因。
     * @param {{ field: string, label: string, supported: boolean | null, control: string, full?: boolean, hint?: string }} options 字段
     * @returns {string} HTML
     */
    function renderParameterField({ field, label, supported, control, full = false, hint = '' }) {
        const help = supported === false
            ? `<span class="field-help image-model-unsupported" data-image-model-unsupported="${escapeHtml(field)}">${UNSUPPORTED_HINT}</span>`
            : (hint ? `<span class="field-help">${escapeHtml(hint)}</span>` : '');
        return `
                    <label class="field-label ${full ? 'image-model-full' : ''} ${supported === false ? 'is-unsupported' : ''}">
                        <span>${escapeHtml(label)}</span>
                        ${control}
                        ${help}
                    </label>`;
    }

    /**
     * @param {boolean | null} supported 是否支持
     * @returns {string} 不支持时的 disabled 属性
     */
    function disabledAttr(supported) {
        return supported === false ? 'disabled' : '';
    }

    function getActiveSecret() {
        const entries = state.secretState?.[IMAGE_GENERATION_SECRET_KEY];
        return Array.isArray(entries) ? (entries.find(entry => entry?.active) || entries[0] || null) : null;
    }

    function describeTextConnection() {
        const connection = getEffectiveConnection(state.settings || {}, getProviderInfo());
        return connection.model ? connection.label : `${connection.label} · 未选择模型`;
    }

    /**
     * @param {ReturnType<typeof getImageGenerationConfig>} config 配置
     * @param {ReturnType<typeof getImageModelParameterStates>} states 参数是否可用
     * @returns {string} 摘要里的默认参数
     */
    function describeDefaults(config, states) {
        const tables = getImageOptionTables(config.provider, config.model);
        const findLabel = (list, value) => list.find(([item]) => item === value)?.[1] || value;
        const parts = [];
        if (states.size !== false && config.defaults.size) {
            parts.push(findLabel(tables.sizes, config.defaults.size));
        } else if (states.aspectRatio !== false && config.defaults.aspectRatio) {
            parts.push(findLabel(tables.aspects, config.defaults.aspectRatio));
        }
        if (states.quality !== false && config.defaults.quality) {
            parts.push(`质量${findLabel(tables.qualities, config.defaults.quality)}`);
        }
        parts.push(`${states.count === false ? 1 : config.defaults.count} 张`);
        return parts.join(' · ');
    }

    /**
     * @param {string} kind ok | warn | error | muted
     * @param {string} id data-image-model-diag 的值
     * @param {string} title 标题
     * @param {string} detail 说明
     * @param {string} status 右侧状态
     * @returns {string} HTML
     */
    function renderDiagRow(kind, id, title, detail, status) {
        return `
                <li class="image-model-diag is-${kind}" data-image-model-diag="${escapeHtml(id)}" data-image-model-diag-kind="${kind}">
                    <i class="fa-solid ${DIAG_ICONS[kind] || DIAG_ICONS.muted}" aria-hidden="true"></i>
                    <div class="image-model-diag-text">
                        <strong>${escapeHtml(title)}</strong>
                        <small>${escapeHtml(detail)}</small>
                    </div>
                    <span class="image-model-diag-state">${escapeHtml(status)}</span>
                </li>`;
    }

    function renderTestButtons(ui, canTest, blockedReason) {
        if (ui.test.running) {
            return `
                        <button class="primary-button" type="button" data-image-model-test disabled>
                            <i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>
                            试生成中…
                        </button>`;
        }
        if (ui.test.confirming) {
            return `
                        <button class="secondary-button danger-action" type="button" data-image-model-test data-image-model-test-confirming>
                            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                            确认试生成（会按次计费）
                        </button>
                        <button class="secondary-button" type="button" data-image-model-test-cancel>取消</button>`;
        }
        return `
                        <button class="primary-button" type="button" data-image-model-test ${canTest ? '' : 'disabled'} title="${escapeHtml(canTest ? '用固定提示词生成一张图，会按次计费' : blockedReason)}">
                            <i class="fa-solid fa-paintbrush" aria-hidden="true"></i>
                            试生成一张
                        </button>`;
    }

    function renderConnectionSection(config, provider) {
        const suggestions = provider.models.filter(model => model !== config.model);
        const placeholder = provider.defaultBaseUrl || provider.baseUrlHint;
        return `
            <section class="form-section" data-image-model-section="connection">
                <div>
                    <h3 class="form-section-title">连接</h3>
                    <p class="panel-subtitle">选择图片供应商、地址和模型。第一期支持下面 ${IMAGE_PROVIDERS.length} 家。</p>
                </div>
                <div class="form-grid two-columns">
                    <label class="field-label">
                        <span>供应商</span>
                        <select class="select-input" data-image-model-field="provider">
                            ${IMAGE_PROVIDERS.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === config.provider ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
                        </select>
                    </label>
                    <label class="field-label">
                        <span>地址${provider.requiresBaseUrl ? '<span class="required-marker">必填</span>' : ''}</span>
                        <input class="text-input" type="url" data-image-model-field="baseUrl" value="${escapeHtml(config.baseUrl)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" spellcheck="false">
                        ${provider.defaultBaseUrl ? `<span class="field-help">${escapeHtml(provider.baseUrlHint)}</span>` : ''}
                    </label>
                    <div class="image-model-full image-model-model-field">
                        <label class="field-label">
                            <span>模型${provider.id === 'automatic1111' ? '' : '<span class="required-marker">必填</span>'}</span>
                            <input class="text-input" type="text" data-image-model-field="model" value="${escapeHtml(config.model)}" placeholder="${escapeHtml(provider.models[0] || '模型名')}" autocomplete="off" spellcheck="false">
                        </label>
                        ${suggestions.length ? `
                        <div class="image-model-suggestions">
                            <span class="field-help">常用模型（点击填入）</span>
                            <span class="tag-row">
                                ${suggestions.map(model => `<button class="secondary-button compact-button" type="button" data-image-model-suggestion="${escapeHtml(model)}">${escapeHtml(model)}</button>`).join('')}
                            </span>
                        </div>` : ''}
                    </div>
                </div>
            </section>`;
    }

    function renderDefaultsSection(config, provider, capability, status) {
        const states = getImageModelParameterStates(capability?.parameters);
        const tables = getImageOptionTables(config.provider, config.model);
        const defaults = config.defaults;
        const countMax = Math.max(1, Math.min(4, Number(capability?.limits?.countMax) || 4));
        const counts = Array.from({ length: countMax }, (_, index) => [String(index + 1), `${index + 1} 张`]);
        // 不知道可用参数时尺寸和比例都显示；知道后只显示支持的那个，两个都不支持时显示置灰的尺寸
        const showSize = states.size !== false || states.aspectRatio !== true;
        const showAspect = states.aspectRatio !== false;
        let statusLine = '';
        if (status.loading) {
            statusLine = `<p class="panel-subtitle" data-image-model-capability-status="loading"><i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> 正在读取 ${escapeHtml(provider.label)} 支持的参数…</p>`;
        } else if (status.error) {
            statusLine = `<p class="field-error" role="alert" data-image-model-capability-status="error">读不到可用参数：${escapeHtml(status.error)} 下面的字段先都可以填，点「检查配置」重试。</p>`;
        }
        const fields = [
            showSize ? renderParameterField({
                field: 'size', label: '默认尺寸', supported: states.size,
                control: `<select class="select-input" data-image-model-field="size" ${disabledAttr(states.size)}>${renderOptions(tables.sizes, defaults.size)}</select>`,
                hint: capability?.limits?.dimensionMultiple ? `宽和高需是 ${capability.limits.dimensionMultiple} 的倍数` : '',
            }) : '',
            showAspect ? renderParameterField({
                field: 'aspectRatio', label: '默认比例', supported: states.aspectRatio,
                control: `<select class="select-input" data-image-model-field="aspectRatio" ${disabledAttr(states.aspectRatio)}>${renderOptions(tables.aspects, defaults.aspectRatio)}</select>`,
            }) : '',
            renderParameterField({
                field: 'quality', label: '默认质量', supported: states.quality,
                control: `<select class="select-input" data-image-model-field="quality" ${disabledAttr(states.quality)}>${renderOptions(tables.qualities, defaults.quality)}</select>`,
            }),
            renderParameterField({
                field: 'count', label: '默认数量', supported: states.count,
                control: `<select class="select-input" data-image-model-field="count" ${disabledAttr(states.count)}>${renderOptions(counts, String(defaults.count))}</select>`,
                hint: states.count !== false && countMax === 1 ? '当前模型一次只能生成 1 张' : '',
            }),
            renderParameterField({
                field: 'style', label: '默认风格', supported: states.style,
                control: `<select class="select-input" data-image-model-field="style" ${disabledAttr(states.style)}>${renderOptions(tables.styles, defaults.style)}</select>`,
            }),
            renderParameterField({
                field: 'seed', label: '默认种子', supported: states.seed,
                control: `<input class="text-input" type="number" inputmode="numeric" min="0" step="1" data-image-model-field="seed" value="${escapeHtml(defaults.seed ?? '')}" placeholder="留空随机" ${disabledAttr(states.seed)}>`,
            }),
            renderParameterField({
                field: 'steps', label: '默认步数', supported: states.steps,
                control: `<input class="text-input" type="number" inputmode="numeric" min="1" max="150" step="1" data-image-model-field="steps" value="${escapeHtml(defaults.steps ?? '')}" placeholder="留空使用供应商默认值" ${disabledAttr(states.steps)}>`,
            }),
            renderParameterField({
                field: 'negativePrompt', label: '默认反向提示词', supported: states.negativePrompt, full: true,
                control: `<textarea class="text-input" rows="2" data-image-model-field="negativePrompt" spellcheck="false" placeholder="不想出现在画面里的内容" ${disabledAttr(states.negativePrompt)}>${escapeHtml(defaults.negativePrompt || '')}</textarea>`,
            }),
        ];
        return `
            <section class="form-section" data-image-model-section="defaults">
                <div>
                    <h3 class="form-section-title">默认参数</h3>
                    <p class="panel-subtitle">聊天里每次生成都可以临时改，这里只决定默认值。可用字段随供应商变化，不支持的置灰。</p>
                </div>
                ${statusLine}
                <div class="form-grid two-columns">
                    ${fields.join('')}
                </div>
            </section>`;
    }

    function renderSecretSection(provider, ui) {
        const active = getActiveSecret();
        const saved = isImageKeySaved(state.secretState);
        return `
            <section class="form-section" data-image-model-section="secret">
                <div>
                    <h3 class="form-section-title">密钥</h3>
                    <p class="panel-subtitle">写入本地密钥库（键名 ${escapeHtml(IMAGE_GENERATION_SECRET_KEY)}），和文本模型的密钥互不影响，页面上不回显。</p>
                </div>
                <div class="form-grid two-columns">
                    ${renderSecretField({
        attribute: 'data-image-model-key',
        name: 'image_generation_api_key',
        saved,
        label: provider.requiresKey ? 'API Key' : 'API Key（可选）',
    })}
                    <div class="image-model-secret-status">
                        <span class="image-model-secret-state ${saved ? 'is-saved' : ''}" data-image-model-secret-state>${saved ? `已保存（${escapeHtml(active?.value ?? '')}）` : '未保存'}</span>
                        ${saved ? `
                        <button class="secondary-button compact-button" type="button" data-image-model-clear-key ${ui.secretBusy ? 'disabled' : ''}>
                            <i class="fa-solid ${ui.secretBusy ? 'fa-circle-notch fa-spin' : 'fa-eraser'}" aria-hidden="true"></i>
                            清除
                        </button>` : ''}
                    </div>
                </div>
                ${provider.requiresKey ? '' : '<p class="field-help">本地 WebUI 通常不需要密钥。</p>'}
            </section>`;
    }

    function renderDiagnostics(config, provider, capability, status, ui) {
        const saved = isImageKeySaved(state.secretState);
        const rows = [];
        const address = config.baseUrl || provider.defaultBaseUrl || '未填写地址';
        if (capability) {
            rows.push(capability.supported
                ? renderDiagRow('ok', 'provider', '供应商支持', `${provider.label} · ${address}`, '已支持')
                : renderDiagRow('warn', 'provider', '供应商支持', describeImageCapabilityReason(capability.reason), '不可用'));
        } else if (status.error) {
            rows.push(renderDiagRow('error', 'provider', '供应商支持', status.error, '读取失败'));
        } else {
            rows.push(renderDiagRow('muted', 'provider', '供应商支持', `${provider.label} · ${address}`, '读取中'));
        }

        if (config.model) {
            rows.push(renderDiagRow('ok', 'model', '模型', config.model, '已填写'));
        } else if (provider.id === 'automatic1111') {
            rows.push(renderDiagRow('muted', 'model', '模型', '留空：使用 WebUI 当前加载的模型', '留空'));
        } else {
            rows.push(renderDiagRow('warn', 'model', '模型', '在「连接」里填写模型，或点常用模型', '未填写'));
        }

        if (saved) {
            rows.push(renderDiagRow('ok', 'key', '密钥', IMAGE_GENERATION_SECRET_KEY, '已保存'));
        } else if (!provider.requiresKey) {
            rows.push(renderDiagRow('muted', 'key', '密钥', `${provider.label} 可以不填密钥`, '不需要'));
        } else {
            rows.push(renderDiagRow('warn', 'key', '密钥', '在「密钥」里粘贴 API Key，离开输入框即保存', '未保存'));
        }

        if (capability) {
            const labels = describeImageModelParameters(capability.parameters);
            rows.push(renderDiagRow('ok', 'parameters', '可用参数', labels.join('、') || '没有可调的参数', `${labels.length} 项`));
        } else {
            rows.push(renderDiagRow('muted', 'parameters', '可用参数', '还没有读到供应商支持的参数', '未读取'));
        }

        const check = ui.check;
        if (check?.running) {
            rows.push(renderDiagRow('muted', 'check', '最近一次检查', '正在调用 /capabilities，不计费', '检查中'));
        } else if (check) {
            const statusText = check.level === 'ok' ? '通过' : check.level === 'error' ? '失败' : '有问题';
            rows.push(renderDiagRow(check.level === 'ok' ? 'ok' : check.level === 'error' ? 'error' : 'warn', 'check', '最近一次检查', `${formatClock(check.at)} · ${check.text}`, statusText));
        } else {
            rows.push(renderDiagRow('muted', 'check', '最近一次检查', '点「检查配置」校验当前组合，不出图、不计费', '未检查'));
        }

        const result = ui.test.result;
        if (ui.test.running) {
            rows.push(renderDiagRow('muted', 'test', '最近一次试生成', `${formatClock(ui.test.startedAt)} 发出，最长等待 6 分钟`, '生成中'));
        } else if (result?.ok) {
            rows.push(renderDiagRow('ok', 'test', '最近一次试生成', `${formatClock(result.at)} · ${result.text}`, '成功'));
        } else if (result) {
            rows.push(renderDiagRow('error', 'test', '最近一次试生成', `${formatClock(result.at)} · ${result.text}`, result.outcomeLabel || '失败'));
        } else {
            rows.push(renderDiagRow('muted', 'test', '最近一次试生成', '「试生成一张」会真的调用供应商，按次计费', '未试生成'));
        }

        const image = result?.ok ? result.image : null;
        const url = image ? encodeURI(image.path) : '';
        const size = image?.width && image?.height ? ` · ${image.width}×${image.height}` : '';
        return `
        <section class="panel section-panel image-model-diagnostics" data-image-model-diagnostics>
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">配置诊断</h2>
                    <p class="panel-subtitle">「检查配置」只校验，不出图、不计费；「试生成一张」会调用供应商并按次计费。</p>
                </div>
            </div>
            <ul class="image-model-diag-list">
                ${rows.join('')}
            </ul>
            ${image ? `
            <figure class="image-model-test-image" data-image-model-test-image>
                <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
                    <img src="${escapeHtml(url)}" alt="试生成的图片" loading="lazy">
                </a>
                <figcaption>${escapeHtml(image.path)}${escapeHtml(size)}</figcaption>
            </figure>` : ''}
        </section>`;
    }

    function renderPromptSettings(config) {
        const promptGen = config.promptGen;
        const counts = Array.from({ length: PROMPT_SOURCE_LIMITS.maxMessages }, (_, index) => [String(index + 1), `${index + 1} 条`]);
        const chatCompletion = (state.settings?.main_api || 'openai') === 'openai';
        return `
        <section class="panel section-panel image-model-prompt-settings" data-image-model-section="prompt">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">从消息生成提示词</h2>
                    <p class="panel-subtitle">聊天里「从消息生成」用到的设置：把勾选的消息交给文本模型，写成一段图片提示词。</p>
                </div>
            </div>
            <div class="image-model-prompt-body">
                <div class="image-model-text-model" data-image-model-text-model>
                    <span class="image-model-caption">使用的文本模型</span>
                    <span class="tag"><i class="fa-solid fa-plug" aria-hidden="true"></i>跟随当前文本连接 · ${escapeHtml(describeTextConnection())}</span>
                    <span class="field-help">第一期固定跟随文本连接，只支持聊天补全类连接。</span>
                    ${chatCompletion ? '' : '<span class="image-model-warning" data-image-model-text-model-warning>当前文本连接不是聊天补全，聊天里的「从消息生成」暂时用不了。</span>'}
                </div>
                <label class="field-label">
                    <span>提示词模板</span>
                    <textarea class="text-input image-model-template" rows="6" data-image-model-field="promptTemplate" spellcheck="false">${escapeHtml(promptGen.template)}</textarea>
                    <span class="field-help">发送内容 = 模板 + 角色外貌（可选） + 勾选的消息。清空后恢复默认模板。</span>
                </label>
                <div class="form-grid two-columns">
                    <label class="field-label">
                        <span>默认勾选最近</span>
                        <select class="select-input" data-image-model-field="promptSelectCount">${renderOptions(counts, String(promptGen.defaultSelectCount))}</select>
                    </label>
                    <div class="field-label">
                        <span>角色外貌</span>
                        <label class="checkbox-card">
                            <input type="checkbox" data-image-model-field="promptAppearance" ${promptGen.includeAppearance ? 'checked' : ''}>
                            <span>默认附带角色外貌</span>
                        </label>
                    </div>
                </div>
            </div>
        </section>`;
    }

    /**
     * 「图片模型」视图的全部内容（不含外层 data-preserve-inputs 容器和切换条）。
     * @returns {string} HTML
     */
    function renderImageModelSettings() {
        ctx.ensureImageModelCapabilities?.();
        const config = getImageGenerationConfig(state.settings || {});
        const provider = getImageProvider(config.provider) || IMAGE_PROVIDERS[0];
        const ui = ensureImageModelUiState(state);
        const target = { provider: config.provider, model: config.model, baseUrl: config.baseUrl };
        const capability = getCachedImageCapabilities(state, target);
        const key = getCapabilityCacheKey(target);
        const status = ui.capabilityStatus.key === key ? ui.capabilityStatus : { key, loading: !capability, error: '' };
        const states = getImageModelParameterStates(capability?.parameters);
        const readiness = getImageConfigReadiness(config, state.secretState);
        const blockedReason = !readiness.ok
            ? readiness.reason
            : (capability && !capability.supported ? describeImageCapabilityReason(capability.reason) : '');
        const saved = isImageKeySaved(state.secretState);

        return `
        <div class="image-model-settings" data-image-model-form>
            <section class="panel section-panel image-model-panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">图片模型</h2>
                        <p class="panel-subtitle">和文本模型分开保存：非密钥字段写入 settings.json，密钥写入本地密钥库。改动会自动保存。</p>
                    </div>
                    <div class="panel-actions image-model-actions">
                        <span class="badge ${readiness.ok ? 'active' : ''}" data-image-model-readiness title="${escapeHtml(readiness.reason)}">${readiness.ok ? '已配置' : '未配置'}</span>
                        <button class="secondary-button" type="button" data-image-model-check ${ui.check?.running ? 'disabled' : ''}>
                            <i class="fa-solid ${ui.check?.running ? 'fa-circle-notch fa-spin' : 'fa-stethoscope'}" aria-hidden="true"></i>
                            ${ui.check?.running ? '检查中' : '检查配置'}
                        </button>
                        ${renderTestButtons(ui, !blockedReason, blockedReason)}
                    </div>
                </div>
                ${readiness.ok ? '' : `<p class="image-model-readiness-hint" data-image-model-readiness-hint>${escapeHtml(readiness.reason)}</p>`}
                <div class="image-model-summary" data-image-model-summary>
                    <div class="image-model-tile"><span>供应商</span><strong>${escapeHtml(provider.label)}</strong></div>
                    <div class="image-model-tile"><span>模型</span><strong>${escapeHtml(config.model || (provider.id === 'automatic1111' ? 'WebUI 当前模型' : '未填写'))}</strong></div>
                    <div class="image-model-tile"><span>默认参数</span><strong>${escapeHtml(describeDefaults(config, states))}</strong></div>
                    <div class="image-model-tile"><span>密钥</span><strong>${saved ? '已保存' : provider.requiresKey ? '未保存' : '不需要'}</strong></div>
                </div>
                <div class="image-model-form-body">
                    ${renderConnectionSection(config, provider)}
                    ${renderDefaultsSection(config, provider, capability, status)}
                    ${renderSecretSection(provider, ui)}
                </div>
            </section>
            ${renderDiagnostics(config, provider, capability, status, ui)}
            ${renderPromptSettings(config)}
        </div>`;
    }

    return {
        renderImageModelSettings,
    };
}
