/**
 * 聊天输入框的图片模式（WP2）。components/chat-composer.js 通过下面四个函数接入：
 *   isChatImageMode()                    当前聊天是否处于图片模式
 *   renderChatImageModeToggle()          元信息行最前面的「文本 / 图片」切换（插槽 chatImageModeToggle；不适用时返回空串）
 *   renderChatImageModelChip()           图片模式下代替连接标签的图片模型标签
 *   renderChatImageComposerBody(messages) 图片模式下代替文本框和按钮的主体（子模式切换、步骤条、提示词框、参数、按钮）
 *
 * 状态在 core/chat-image-state.js（每个聊天一份 ChatImageView）和 actions/chat-image-generation.js 的
 * getChatImageComposerState（标签弹层、能力读取失败）；事件在 routes/chat-image-events.js。
 * 提示词框和参数包在 data-preserve-inputs 里：未读轮询会整页重绘，不包的话正在输入的提示词会丢焦点（core/preserve-inputs.js）。
 *
 * @param {any} ctx 聊天路由上下文。
 */
import { getChatImageComposerState } from '../actions/chat-image-generation.js';
import { isPromptGenerationSupported } from '../actions/chat-image-prompt.js';
import { getChatAgentSession } from '../core/chat-agent-state.js';
import { peekChatImageView } from '../core/chat-image-state.js';
import { getCachedImageCapabilities, getCapabilityCacheKey } from '../core/image-generation-capabilities.js';
import {
    getImageConfigReadiness,
    getImageGenerationConfig,
    getImageOptionTables,
    getImageProvider,
    IMAGE_PARAMETER_LABELS,
    isImageKeySaved,
} from '../core/image-generation-config.js';
import { escapeHtml } from '../core/utils.js';
import { createChatImageSelectionComponents } from './chat-image-selection.js';

const PROMPT_PLACEHOLDER = '描述想生成的画面，例如：月光下的屋顶，银发少女倚着栏杆，远处城市灯火，动漫插画风格（Ctrl/⌘ + Enter 生成）';

/**
 * @param {string[][]} options [值, 文字] 列表。
 * @param {any} current 当前值。
 * @returns {string} option 标签；当前值不在列表里时补一项（手填过的值）。
 */
function renderOptions(options, current) {
    const value = current === null || current === undefined ? '' : String(current);
    const list = options.some(([optionValue]) => optionValue === value) ? options : [...options, [value, value || '默认']];
    return list.map(([optionValue, label]) => `<option value="${escapeHtml(optionValue)}" ${optionValue === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

export function createChatImageComposerComponents(ctx) {
    const { state } = ctx;
    const { renderPromptSourceSteps } = createChatImageSelectionComponents(ctx);

    /** @returns {string} 当前聊天的 cacheKey；没有选中聊天或处于 Agent 模式时为空串。 */
    function getTargetKey() {
        const entity = ctx.getSelectedChatEntity?.();
        if (!entity || !state.selected?.chat) {
            return '';
        }
        const contextKey = ctx.getChatContextKey?.(entity) || '';
        if (!contextKey || contextKey === 'group:' || getChatAgentSession(state, contextKey)?.enabled) {
            return '';
        }
        return ctx.getCurrentDraftKey?.() || '';
    }

    function getView() {
        const key = getTargetKey();
        return key ? peekChatImageView(state, key) : null;
    }

    function isChatImageMode() {
        return getView()?.mode === 'image';
    }

    function getBusyText() {
        if (!state.engine.generating) {
            return '';
        }
        return state.engine.activity === 'image'
            ? (state.engine.detail || '图片生成中…')
            : '文本回复生成中，结束后才能生成图片。';
    }

    function renderChatImageModeToggle() {
        if (!getTargetKey()) {
            return '';
        }
        const mode = getView()?.mode === 'image' ? 'image' : 'text';
        const disabled = Boolean(state.engine.generating);
        const title = disabled ? (state.engine.activity === 'image' ? '图片生成中，完成或停止等待后才能切换' : '回复生成中，结束后才能切换') : '';
        const button = (value, icon, label) => `
            <button class="${mode === value ? 'active' : ''}" type="button" data-chat-image-mode="${value}" aria-pressed="${mode === value}" ${disabled ? 'disabled' : ''}>
                <i class="fa-solid ${icon}" aria-hidden="true"></i>${label}
            </button>`;
        return `
        <div class="segmented-control chat-image-mode-toggle" role="group" aria-label="输入模式" data-chat-image-mode-toggle ${title ? `title="${escapeHtml(title)}"` : ''}>
            ${button('text', 'fa-message', '文本')}${button('image', 'fa-image', '图片')}
        </div>`;
    }

    function describeDefaults(config) {
        const defaults = config.defaults;
        const tables = getImageOptionTables(config.provider, config.model);
        const size = tables.sizes.find(([value]) => value === defaults.size)?.[1] || defaults.size || '';
        const quality = defaults.quality ? (tables.qualities.find(([value]) => value === defaults.quality)?.[1] || defaults.quality) : '';
        return [size, quality ? `${quality}质量` : '', `${defaults.count || 1} 张`].filter(Boolean).join(' · ');
    }

    function renderModelPopover(config, provider) {
        const keySaved = isImageKeySaved(state.secretState);
        const rows = [
            ['供应商', provider?.label || config.provider],
            ['模型', config.model || '使用 WebUI 当前加载的模型'],
            ...(config.baseUrl ? [['地址', config.baseUrl]] : []),
            ['默认参数', describeDefaults(config)],
            ['密钥', provider?.requiresKey === false ? '不需要' : (keySaved ? '已保存' : '未保存')],
        ];
        return `
            <div class="chat-image-model-popover" role="dialog" aria-label="图片模型" data-chat-image-model-popover>
                <div class="chat-image-model-popover-head">
                    <strong>图片模型</strong>
                    <button class="icon-button compact-icon" type="button" data-chat-image-model-close aria-label="关闭" title="关闭（Esc）">
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                </div>
                <dl class="chat-image-model-summary">
                    ${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}
                </dl>
                <p class="chat-image-model-note">图片按次计费，生成前不预估费用。图片模型和文本模型分开配置。</p>
                <div class="chat-image-model-popover-foot">
                    <button class="secondary-button compact-button" type="button" data-route="api" data-chat-image-open-settings>
                        <i class="fa-solid fa-plug" aria-hidden="true"></i>
                        去设置中心修改
                    </button>
                </div>
            </div>`;
    }

    function renderChatImageModelChip() {
        if (!getTargetKey()) {
            return '';
        }
        const config = getImageGenerationConfig(state.settings);
        const provider = getImageProvider(config.provider);
        const readiness = getImageConfigReadiness(config, state.secretState);
        if (!readiness.ok) {
            return `
            <span class="connection-chip chat-image-model-chip is-unconfigured" data-chat-image-model-chip-empty title="${escapeHtml(readiness.reason)}">
                <i class="fa-solid fa-paintbrush" aria-hidden="true"></i>
                <span class="connection-chip-label">未配置图片模型</span>
            </span>`;
        }
        const open = Boolean(getChatImageComposerState(state).modelChipOpen);
        const label = `${provider?.label || config.provider} · ${config.model || 'WebUI 当前模型'}`;
        return `
        <div class="chat-image-model${open ? ' is-open' : ''}" data-chat-image-model>
            <button class="connection-chip chat-image-model-chip" type="button" data-chat-image-model-chip aria-haspopup="dialog" aria-expanded="${open}" title="${escapeHtml(`图片模型：${label}`)}">
                <i class="fa-solid fa-paintbrush" aria-hidden="true"></i>
                <span class="connection-chip-label">${escapeHtml(label)}</span>
                <i class="fa-solid fa-chevron-up connection-chip-caret" aria-hidden="true"></i>
            </button>
            ${open ? renderModelPopover(config, provider) : ''}
        </div>`;
    }

    function renderEmptyState(reason) {
        return `
        <div class="chat-image-empty" data-chat-image-empty>
            <span class="chat-image-empty-icon"><i class="fa-solid fa-paintbrush" aria-hidden="true"></i></span>
            <div class="chat-image-empty-text">
                <strong>还没有配置图片模型</strong>
                <p>${escapeHtml(reason)}图片模型和文本模型分开配置，先到设置中心「模型连接」→「图片模型」填写供应商、模型和密钥。</p>
            </div>
            <button class="primary-button" type="button" data-route="api" data-chat-image-open-settings>
                <i class="fa-solid fa-plug" aria-hidden="true"></i>
                去设置中心配置
            </button>
        </div>`;
    }

    function renderSubModeSwitch(view) {
        const autoSupported = isPromptGenerationSupported(state.settings);
        const disabled = Boolean(state.engine.generating);
        const autoTitle = autoSupported ? '' : '当前主连接是文本补全，第一期只支持聊天补全连接从消息生成提示词';
        const hint = view.sub === 'auto'
            ? '勾选消息 → 用文本模型生成提示词 → 自动填入提示词框后再生成图片。'
            : '自己写提示词，生成后作为一条「仅展示」消息插入当前会话，不进入后续文本上下文。';
        return `
        <div class="chat-image-top">
            <div class="segmented-control chat-image-sub-switch" role="group" aria-label="提示词来源">
                <button class="${view.sub === 'manual' ? 'active' : ''}" type="button" data-chat-image-sub="manual" aria-pressed="${view.sub === 'manual'}" ${disabled ? 'disabled' : ''}>
                    <i class="fa-solid fa-pen" aria-hidden="true"></i>手动输入
                </button>
                <button class="${view.sub === 'auto' ? 'active' : ''}" type="button" data-chat-image-sub="auto" aria-pressed="${view.sub === 'auto'}" ${disabled || !autoSupported ? 'disabled' : ''} ${autoTitle ? `title="${escapeHtml(autoTitle)}"` : ''}>
                    <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>从消息生成
                </button>
            </div>
            <span class="chat-image-hint">${escapeHtml(autoSupported ? hint : `${hint} ${autoTitle}。`)}</span>
        </div>`;
    }

    /**
     * 参数标签：只列出当前供应商 / 模型支持的参数（/capabilities 的 parameters）。
     * @param {any} view 当前聊天的图片界面状态。
     * @param {ReturnType<typeof getImageGenerationConfig>} config 图片配置。
     * @param {any} capabilities 能力结果；还没读到时为 null。
     * @param {boolean} disabled 是否禁用。
     */
    function renderParams(view, config, capabilities, disabled) {
        const composer = getChatImageComposerState(state);
        const key = getCapabilityCacheKey(config);
        if (!capabilities) {
            const error = composer.capabilityError?.key === key ? composer.capabilityError.message : '';
            return error
                ? `<div class="chat-image-param-row"><span class="chat-image-param-note is-warning" role="alert">读取可用参数失败：${escapeHtml(error)}</span>
                    <button class="secondary-button compact-button" type="button" data-chat-image-capabilities-retry>重试</button></div>`
                : '<div class="chat-image-param-row"><span class="chat-image-param-note"><i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> 正在读取可用参数…</span></div>';
        }
        if (!capabilities.supported) {
            return `<div class="chat-image-param-row"><span class="chat-image-param-note is-warning" role="alert">${escapeHtml(capabilities.reason || '当前供应商不支持这个模型。')}</span></div>`;
        }
        const allowed = new Set(Array.isArray(capabilities.parameters) ? capabilities.parameters : []);
        const values = { ...config.defaults, ...view.params };
        const tables = getImageOptionTables(config.provider, config.model);
        const select = (param, label, options, current = values[param]) => `
            <label class="chat-image-param">${label}
                <select data-chat-image-param="${param}" ${disabled ? 'disabled' : ''}>${renderOptions(options, current)}</select>
            </label>`;
        const chips = [];
        const hasSize = allowed.has('width') && allowed.has('height');
        if (hasSize) {
            chips.push(select('size', IMAGE_PARAMETER_LABELS.size, tables.sizes));
        }
        if (allowed.has('aspectRatio')) {
            chips.push(select('aspectRatio', IMAGE_PARAMETER_LABELS.aspectRatio, tables.aspects));
        }
        if (allowed.has('quality')) {
            chips.push(select('quality', IMAGE_PARAMETER_LABELS.quality, tables.qualities));
        }
        if (allowed.has('count')) {
            const countMax = Math.min(4, Number.isSafeInteger(capabilities.limits?.countMax) && capabilities.limits.countMax >= 1 ? capabilities.limits.countMax : 1);
            const count = Math.min(Math.max(Number(values.count) || 1, 1), countMax);
            chips.push(select('count', IMAGE_PARAMETER_LABELS.count, Array.from({ length: countMax }, (_, index) => [String(index + 1), `${index + 1} 张`]), count));
        }
        if (allowed.has('style')) {
            chips.push(select('style', IMAGE_PARAMETER_LABELS.style, tables.styles));
        }
        const advanced = ['negativePrompt', 'seed', 'steps'].filter(param => allowed.has(param));
        const unsupported = [
            ...(!hasSize && !allowed.has('aspectRatio') ? ['size'] : []),
            ...['quality', 'count', 'style', 'negativePrompt', 'seed', 'steps'].filter(param => !allowed.has(param)),
        ].map(param => IMAGE_PARAMETER_LABELS[param]);
        const providerLabel = getImageProvider(config.provider)?.label || config.provider;
        return `
            <div class="chat-image-param-row">
                ${chips.join('')}
                ${advanced.length ? `
                    <button class="secondary-button compact-button chat-image-advanced-toggle" type="button" data-chat-image-advanced-toggle aria-expanded="${view.showAdvanced}" ${disabled ? 'disabled' : ''}>
                        <i class="fa-solid ${view.showAdvanced ? 'fa-chevron-up' : 'fa-chevron-down'}" aria-hidden="true"></i>高级
                    </button>` : ''}
                ${unsupported.length ? `<span class="chat-image-param-note">${escapeHtml(`${providerLabel} 不支持：${unsupported.join('、')}`)}</span>` : ''}
            </div>
            ${advanced.length && view.showAdvanced ? renderAdvanced(advanced, values, disabled) : ''}`;
    }

    function renderAdvanced(advanced, values, disabled) {
        const text = value => (value === null || value === undefined ? '' : String(value));
        return `
            <div class="chat-image-advanced" data-chat-image-advanced>
                ${advanced.includes('negativePrompt') ? `
                    <label class="field-label chat-image-advanced-negative">反向提示词
                        <textarea class="text-input" rows="2" data-chat-image-param="negativePrompt" ${disabled ? 'disabled' : ''}>${escapeHtml(text(values.negativePrompt))}</textarea>
                    </label>` : ''}
                ${advanced.includes('seed') ? `
                    <label class="field-label">种子（留空随机）
                        <input class="text-input" type="text" inputmode="numeric" autocomplete="off" placeholder="随机" data-chat-image-param="seed" value="${escapeHtml(text(values.seed))}" ${disabled ? 'disabled' : ''}>
                    </label>` : ''}
                ${advanced.includes('steps') ? `
                    <label class="field-label">步数
                        <input class="text-input" type="text" inputmode="numeric" autocomplete="off" data-chat-image-param="steps" value="${escapeHtml(text(values.steps))}" ${disabled ? 'disabled' : ''}>
                    </label>` : ''}
            </div>`;
    }

    function renderPromptArea(view, config) {
        const generating = Boolean(state.engine.generating);
        const imageBusy = generating && state.engine.activity === 'image';
        const capabilities = getCachedImageCapabilities(state, config);
        const canGenerate = !generating && view.prompt.trim().length > 0 && capabilities?.supported !== false;
        const busyText = getBusyText();
        return `
        <div class="chat-image-prompt-row">
            <textarea data-chat-image-prompt rows="2" placeholder="${escapeHtml(PROMPT_PLACEHOLDER)}" aria-label="图片提示词" ${generating ? 'disabled' : ''}>${escapeHtml(view.prompt)}</textarea>
            <div class="chat-image-buttons">
                <button class="primary-button" type="button" data-chat-image-generate ${canGenerate ? '' : 'disabled'}>
                    <i class="fa-solid ${imageBusy ? 'fa-circle-notch fa-spin' : 'fa-paintbrush'}" aria-hidden="true"></i>
                    ${imageBusy ? '生成中' : '生成图片'}
                </button>
                ${imageBusy ? `
                    <button class="secondary-button" type="button" data-chat-image-cancel>
                        <i class="fa-solid fa-stop" aria-hidden="true"></i>
                        停止等待
                    </button>` : `
                    <button class="secondary-button" type="button" data-chat-image-clear ${generating || !view.prompt ? 'disabled' : ''}>清空</button>`}
            </div>
        </div>
        ${renderParams(view, config, capabilities, generating)}
        ${busyText ? `<div class="chat-image-status" role="status" data-chat-image-status>${escapeHtml(busyText)}</div>` : ''}`;
    }

    /**
     * @param {any[]} messages 当前聊天的全部消息。
     * @returns {string}
     */
    function renderChatImageComposerBody(messages) {
        const key = getTargetKey();
        const view = key ? peekChatImageView(state, key) : null;
        if (!view) {
            return '';
        }
        const config = getImageGenerationConfig(state.settings);
        const readiness = getImageConfigReadiness(config, state.secretState);
        if (!readiness.ok) {
            return `<div class="chat-image-composer" data-chat-image-composer>${renderEmptyState(readiness.reason)}</div>`;
        }
        const auto = view.sub === 'auto';
        const steps = auto ? renderPromptSourceSteps(view, messages) : '';
        const showPrompt = !auto || (view.autoStep === 3 && isPromptGenerationSupported(state.settings));
        return `
        <div class="chat-image-composer" data-chat-image-composer data-chat-image-sub-mode="${auto ? 'auto' : 'manual'}" data-preserve-inputs>
            ${renderSubModeSwitch(view)}
            ${steps}
            ${showPrompt ? renderPromptArea(view, config) : ''}
        </div>`;
    }

    return {
        isChatImageMode,
        renderChatImageModeToggle,
        renderChatImageModelChip,
        renderChatImageComposerBody,
    };
}
