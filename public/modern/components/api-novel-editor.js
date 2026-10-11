import { createApiFieldComponents } from './api-fields.js';

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
    const { renderSecretField, renderTextLengthSection } = createApiFieldComponents(ctx);

    // NovelAI editor: main API select + API key (secret) + static model choice, plus the shared length fields. Fields save on change.
    function renderNovelEditor(mainApi, renderApiMainSelect) {
        // The engine reads the model from nai_settings when that object exists (script.js loadNovelSettings)
        const model = state.settings.nai_settings?.model_novel || state.settings.model_novel || 'clio-v1';
        const secretState = state.secretState?.api_key_novel;
        const secretSaved = Array.isArray(secretState) && secretState.length > 0;
        const modelOptions = NOVEL_MODELS
            .map(([value, label]) => `<option value="${value}" ${model === value ? 'selected' : ''}>${escapeHtml(label)}</option>`)
            .join('');
        return `
        <form class="settings-form" data-api-connection-form autocomplete="off" novalidate>
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">连接</h3>
                    <p class="panel-subtitle">填写 NovelAI API key 并选择模型。密钥只保存在本机，不会显示出来。</p>
                </div>
                <div class="form-grid two-columns">
                    ${renderApiMainSelect(mainApi)}
                    <label class="field-label">
                        <span>模型</span>
                        <select class="select-input" data-novel-model>${modelOptions}</select>
                    </label>
                    ${renderSecretField({ attribute: 'data-novel-api-key', name: 'novel_api_key', saved: secretSaved })}
                </div>
            </section>
            ${renderTextLengthSection(mainApi)}
        </form>
    `;
    }

    return {
        renderNovelEditor,
    };
}
