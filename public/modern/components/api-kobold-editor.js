import { createApiFieldComponents } from './api-fields.js';

export function createApiKoboldComponents(ctx) {
    const {
        state,
        escapeHtml,
    } = ctx;
    const { renderTextLengthSection } = createApiFieldComponents(ctx);

    // KoboldAI Classic editor: main API select + a single server URL, plus the shared length fields. Fields save on change.
    function renderKoboldEditor(mainApi, renderApiMainSelect) {
        // The engine reads kai_settings.api_server first (kai-settings.js loadKoboldSettings)
        const apiServer = state.settings.kai_settings?.api_server || state.settings.api_server || '';
        return `
        <form class="settings-form" data-api-connection-form autocomplete="off" novalidate>
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">连接</h3>
                    <p class="panel-subtitle">连接本地或远程 KoboldAI 服务，只需填写服务地址。</p>
                </div>
                <div class="form-grid two-columns">
                    ${renderApiMainSelect(mainApi)}
                    <label class="field-label">
                        <span>服务地址</span>
                        <input class="text-input" type="url" data-kobold-api-url value="${escapeHtml(apiServer)}" placeholder="http://127.0.0.1:5000/api">
                    </label>
                </div>
            </section>
            ${renderTextLengthSection(mainApi)}
        </form>
    `;
    }

    return {
        renderKoboldEditor,
    };
}
