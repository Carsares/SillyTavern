import { createApiFieldComponents } from './api-fields.js';

export function createApiHordeComponents(ctx) {
    const {
        state,
        escapeHtml,
        showToast,
        render,
        loadHordeModels,
    } = ctx;
    const { renderSecretField, renderTextLengthSection } = createApiFieldComponents(ctx);
    let autoLoadPending = false;
    let autoLoadFailed = false;

    // Auto-load the live model list on first render; failure surfaces once and stops re-firing (manual refresh still retries)
    function ensureHordeModelsLoaded() {
        if (state.hordeModels.loaded || state.hordeModels.loading || autoLoadPending || autoLoadFailed) {
            return;
        }
        autoLoadPending = true;
        window.setTimeout(async () => {
            try {
                await loadHordeModels();
            } catch (error) {
                autoLoadFailed = true;
                state.errors.push({ key: 'horde-models', message: error.message });
                showToast('AI Horde 模型读取失败', error.message);
                render();
            } finally {
                autoLoadPending = false;
            }
        }, 0);
    }

    function hordeModelLabel(model) {
        const parts = [model.display_name || model.name];
        if (model.count != null) {
            parts.push(`${model.count} workers`);
        }
        if (model.performance != null) {
            parts.push(`${Math.round(model.performance)} t/s`);
        }
        return parts.join(' · ');
    }

    // AI Horde editor: main API select + key + a multi-select of live models + refresh, plus the shared length fields.
    // Fields save on change; the model list saves whenever the selection changes.
    function renderHordeEditor(mainApi, renderApiMainSelect) {
        ensureHordeModelsLoaded();
        const hordeSettings = state.settings.horde_settings || {};
        const selected = new Set(Array.isArray(hordeSettings.models) ? hordeSettings.models : []);
        const secretState = state.secretState?.api_key_horde;
        const secretSaved = Array.isArray(secretState) && secretState.length > 0;
        const modelOptions = state.hordeModels.items
            .map(model => `<option value="${escapeHtml(model.name)}" ${selected.has(model.name) ? 'selected' : ''}>${escapeHtml(hordeModelLabel(model))}</option>`)
            .join('') || `<option disabled>${state.hordeModels.loading ? '正在加载模型…' : '暂无模型，点击刷新模型'}</option>`;
        return `
        <form class="settings-form" data-api-connection-form autocomplete="off" novalidate>
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">连接</h3>
                    <p class="panel-subtitle">API key 留空即为匿名；从下方选择一个或多个模型。</p>
                </div>
                <div class="form-grid two-columns">
                    ${renderApiMainSelect(mainApi)}
                    ${renderSecretField({ attribute: 'data-horde-api-key', name: 'horde_api_key', saved: secretSaved, emptyPlaceholder: '留空为匿名；粘贴后离开输入框即保存' })}
                </div>
                <div class="form-section-header">
                    <span class="form-subsection-title">模型（可多选，按住 Ctrl / ⌘ 多选）</span>
                    <button class="secondary-button compact-button" type="button" data-horde-refresh ${state.hordeModels.loading ? 'disabled' : ''}>
                        <i class="fa-solid ${state.hordeModels.loading ? 'fa-circle-notch fa-spin' : 'fa-rotate'}"></i>
                        刷新模型
                    </button>
                </div>
                <select class="select-input" data-horde-model multiple size="8">${modelOptions}</select>
                ${selected.size ? '' : '<p class="api-context-hint is-warning">还没有选择模型，选择至少一个才能生成。</p>'}
            </section>
            ${renderTextLengthSection(mainApi)}
        </form>
    `;
    }

    return {
        renderHordeEditor,
    };
}
