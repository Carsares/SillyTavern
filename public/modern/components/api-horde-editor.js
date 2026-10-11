export function createApiHordeComponents(ctx) {
    const {
        state,
        escapeHtml,
        showToast,
        render,
        loadHordeModels,
    } = ctx;
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

    // AI Horde editor: main API select + key + a multi-select of live models + refresh
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
        <form class="settings-form" data-api-connection-form>
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">AI Horde 连接</h3>
                    <p class="panel-subtitle">API key 留空即为匿名；从下方选择一个或多个模型。</p>
                </div>
                <div class="form-grid two-columns">
                    ${renderApiMainSelect(mainApi)}
                    <label class="field-label">
                        <span>API key</span>
                        <input class="text-input" type="password" name="horde_api_key" autocomplete="new-password" data-horde-api-key placeholder="${secretSaved ? '密钥已保存；留空不修改' : '0000000000（匿名）或输入 key'}">
                        <span class="panel-subtitle" data-horde-secret-status>${secretSaved ? '密钥已保存' : '匿名或未保存密钥'}</span>
                    </label>
                </div>
                <div class="form-section-header">
                    <span class="form-subsection-title">模型（可多选）</span>
                    <button class="secondary-button compact-button" type="button" data-horde-refresh ${state.hordeModels.loading ? 'disabled' : ''}>
                        <i class="fa-solid ${state.hordeModels.loading ? 'fa-circle-notch fa-spin' : 'fa-rotate'}"></i>
                        刷新模型
                    </button>
                </div>
                <select class="select-input" data-horde-model multiple size="8">${modelOptions}</select>
                <div class="message-edit-actions">
                    <button class="primary-button" type="submit" data-save-api-connection>
                        <i class="fa-solid fa-check"></i>
                        保存连接
                    </button>
                </div>
            </section>
        </form>
    `;
    }

    return {
        renderHordeEditor,
    };
}
