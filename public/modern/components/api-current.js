import { describeConnection, withRawValue } from '../core/connection-labels.js';

export function createApiCurrentComponents(ctx) {
    const {
        state,
        escapeHtml,
    } = ctx;

    function renderCurrentValue(label, value) {
        return `
                <div>
                    <span class="metric-label">${escapeHtml(label)}</span>
                    <strong title="${escapeHtml(value)}">${escapeHtml(value)}</strong>
                </div>`;
    }

    function getApiTestBadgeClass(status) {
        if (status === '失败') {
            return 'danger';
        }
        return status === '可用' ? 'active' : '';
    }

    function renderApiCurrentPanel(provider, renderConnectionEditor) {
        // provider follows the 主 API select (including an unsaved text completion switch), so describe it
        // directly instead of re-reading the saved settings
        const connection = describeConnection({ api: provider.api, source: provider.chatSource, model: provider.model });
        // KoboldAI Classic is identified by its server URL; NovelAI / AI Horde by the main API itself
        const sourceText = connection.source
            ? withRawValue(connection.sourceLabel, connection.source)
            : (connection.endpoint || connection.sourceLabel || '未配置');
        return `
        <section class="panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">当前连接</h2>
                    <p class="panel-subtitle">从 SillyTavern settings.json 读取非密钥字段。</p>
                </div>
                <span class="badge" title="${escapeHtml(connection.title)}">${escapeHtml(connection.sourceLabel || connection.label)}</span>
            </div>
            <div class="api-current">
                ${renderCurrentValue('主 API', withRawValue(connection.mainApiLabel, connection.mainApi) || '未选择')}
                ${renderCurrentValue('来源', sourceText)}
                ${renderCurrentValue('模型', provider.model || '未配置')}
                ${renderCurrentValue('预设', provider.preset || '未配置')}
            </div>
            <div class="connection-test">
                <span class="badge ${getApiTestBadgeClass(state.apiTest.status)}">${escapeHtml(state.apiTest.status)}</span>
                <span>${escapeHtml(state.apiTest.detail)}</span>
            </div>
            ${renderConnectionEditor()}
        </section>
    `;
    }

    function renderUnsupportedApiEditor(mainApi, renderApiMainSelect) {
        return `
        <div class="settings-form">
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">连接</h3>
                    <p class="panel-subtitle">当前主 API 暂不支持在现代页编辑。</p>
                </div>
                <div class="form-grid two-columns">
                    ${renderApiMainSelect(mainApi)}
                </div>
            </section>
        </div>
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
        renderApiCurrentPanel,
        renderUnsupportedApiEditor,
        renderApiMainSelect,
    };
}
