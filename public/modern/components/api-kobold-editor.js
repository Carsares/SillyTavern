export function createApiKoboldComponents(ctx) {
    const {
        state,
        escapeHtml,
    } = ctx;

    // KoboldAI Classic editor: main API select + a single server URL, reusing the shared save/test controls
    function renderKoboldEditor(mainApi, renderApiMainSelect) {
        const apiServer = state.settings.api_server || '';
        return `
        <form class="settings-form" data-api-connection-form>
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">KoboldAI Classic 连接</h3>
                    <p class="panel-subtitle">连接本地或远程 KoboldAI 服务，只需填写服务地址。</p>
                </div>
                <div class="form-grid two-columns">
                    ${renderApiMainSelect(mainApi)}
                    <label class="field-label">
                        <span>服务地址</span>
                        <input class="text-input" type="url" data-kobold-api-url value="${escapeHtml(apiServer)}" placeholder="http://127.0.0.1:5000/api">
                    </label>
                </div>
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
        renderKoboldEditor,
    };
}
