const NOVEL_MODELS = [
    ['clio-v1', 'Clio'],
    ['kayra-v1', 'Kayra'],
    ['llama-3-erato-v1', 'Erato'],
];

export function createApiNovelComponents(ctx) {
    const {
        state,
        escapeHtml,
    } = ctx;

    // NovelAI editor: main API select + API key (secret) + static model choice
    function renderNovelEditor(mainApi, renderApiMainSelect) {
        const model = state.settings.model_novel || 'clio-v1';
        const secretState = state.secretState?.api_key_novel;
        const secretSaved = Array.isArray(secretState) && secretState.length > 0;
        const modelOptions = NOVEL_MODELS
            .map(([value, label]) => `<option value="${value}" ${model === value ? 'selected' : ''}>${escapeHtml(label)}</option>`)
            .join('');
        return `
        <form class="settings-form" data-api-connection-form>
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">NovelAI 连接</h3>
                    <p class="panel-subtitle">填写 NovelAI API key 并选择模型；密钥保存后留空即不修改。</p>
                </div>
                <div class="form-grid two-columns">
                    ${renderApiMainSelect(mainApi)}
                    <label class="field-label">
                        <span>模型</span>
                        <select class="select-input" data-novel-model>${modelOptions}</select>
                    </label>
                    <label class="field-label">
                        <span>API key</span>
                        <input class="text-input" type="password" name="novel_api_key" autocomplete="new-password" data-novel-api-key placeholder="${secretSaved ? '密钥已保存；留空不修改' : '输入后保存到 secrets'}">
                        <span class="panel-subtitle" data-novel-secret-status>${secretSaved ? '密钥已保存' : '未保存密钥'}</span>
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
        renderNovelEditor,
    };
}
