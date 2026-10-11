export function createApiCurrentComponents(ctx) {
    const {
        escapeHtml,
    } = ctx;

    function renderUnsupportedApiEditor(mainApi, renderApiMainSelect) {
        return `
        <form class="settings-form" data-api-connection-form autocomplete="off" novalidate>
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">连接</h3>
                    <p class="panel-subtitle">当前主 API 暂不支持在这里编辑，换成下面任一主 API 后即可配置。</p>
                </div>
                <div class="form-grid two-columns">
                    ${renderApiMainSelect(mainApi)}
                </div>
            </section>
        </form>
    `;
    }

    function renderApiMainSelect(mainApi) {
        const modernMainApis = ['openai', 'textgenerationwebui', 'kobold', 'novel', 'koboldhorde'];
        const isModernMainApi = modernMainApis.includes(mainApi);
        return `
        <label class="field-label">
            <span>主 API</span>
            <select class="select-input" data-api-main>
                ${isModernMainApi ? '' : `<option value="${escapeHtml(mainApi)}" selected disabled>当前：${escapeHtml(mainApi || '未选择')}（暂不支持编辑）</option>`}
                <option value="openai" ${mainApi === 'openai' ? 'selected' : ''}>聊天补全</option>
                <option value="textgenerationwebui" ${mainApi === 'textgenerationwebui' ? 'selected' : ''}>文本补全</option>
                <option value="kobold" ${mainApi === 'kobold' ? 'selected' : ''}>KoboldAI Classic</option>
                <option value="novel" ${mainApi === 'novel' ? 'selected' : ''}>NovelAI</option>
                <option value="koboldhorde" ${mainApi === 'koboldhorde' ? 'selected' : ''}>AI Horde</option>
            </select>
        </label>
    `;
    }

    return {
        renderUnsupportedApiEditor,
        renderApiMainSelect,
    };
}
