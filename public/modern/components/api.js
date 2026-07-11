import { createApiChatCompletionComponents } from './api-chat-completion.js';
import { createApiCurrentComponents } from './api-current.js';
import { createApiDiagnosticComponents } from './api-diagnostics.js';
import { createApiProfileComponents } from './api-profiles.js';
import { createApiStateComponents } from './api-state.js';
import { createApiTextCompletionComponents } from './api-text-completion.js';
import { createApiKoboldComponents } from './api-kobold-editor.js';
import { createApiNovelComponents } from './api-novel-editor.js';

export function createApiComponents(ctx) {
    const {
        state,
        pageHead,
        getSelectedApiMain,
    } = ctx;
    const {
        renderChatCompletionEditor,
        getChatCompletionEndpoint,
    } = createApiChatCompletionComponents(ctx);
    const {
        renderTextCompletionEditor,
        getTextCompletionProfile,
        getTextCompletionSecretKey,
    } = createApiTextCompletionComponents(ctx);
    const {
        renderApiDiagnostics,
        renderApiTestHistory,
    } = createApiDiagnosticComponents(ctx);
    const {
        renderApiProfilesSection,
        renderApiRawDataPanel,
    } = createApiProfileComponents(ctx);
    const {
        renderApiCurrentPanel,
        renderUnsupportedApiEditor,
        renderApiMainSelect,
    } = createApiCurrentComponents(ctx);
    const {
        renderKoboldEditor,
    } = createApiKoboldComponents(ctx);
    const {
        renderNovelEditor,
    } = createApiNovelComponents(ctx);
    const {
        getApiProfiles,
        getCurrentProviderInfo,
        getApiChecks,
    } = createApiStateComponents({
        ...ctx,
        getChatCompletionEndpoint,
        getTextCompletionProfile,
        getTextCompletionSecretKey,
    });

    function renderApi() {
        const provider = getCurrentProviderInfo();
        const profiles = getApiProfiles();
        const checks = getApiChecks(provider, profiles);
        const canTestConnection = ['openai', 'textgenerationwebui', 'kobold', 'novel'].includes(getSelectedApiMain());

        return `
        ${pageHead('API 连接管理', '连接、模型、预设和请求状态。', `
            <button class="primary-button" type="button" data-test-api ${state.apiTest.running || !canTestConnection ? 'disabled' : ''}>
                <i class="fa-solid ${state.apiTest.running ? 'fa-circle-notch fa-spin' : 'fa-plug-circle-check'}"></i>
                ${state.apiTest.running ? '测试中' : '测试连接'}
            </button>
            <button class="secondary-button" type="button" data-refresh>
                <i class="fa-solid fa-rotate"></i>
                刷新
            </button>
        `)}
        <div class="dashboard-grid">
            ${renderApiCurrentPanel(provider, () => renderApiConnectionEditor(provider))}
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">连接诊断</h2>
                        <p class="panel-subtitle">集中显示模型、密钥、CSRF 和测试结果。</p>
                    </div>
                </div>
                ${renderApiDiagnostics(checks)}
                ${renderApiTestHistory()}
            </section>
        </div>
        ${renderApiProfilesSection(profiles)}
        ${renderApiRawDataPanel(provider)}
    `;
    }

    function renderApiConnectionEditor(provider) {
        const mainApi = getSelectedApiMain();

        if (mainApi === 'textgenerationwebui') {
            return renderTextCompletionEditor(mainApi, renderApiMainSelect);
        }

        if (mainApi === 'kobold') {
            return renderKoboldEditor(mainApi, renderApiMainSelect);
        }

        if (mainApi === 'novel') {
            return renderNovelEditor(mainApi, renderApiMainSelect);
        }

        if (mainApi !== 'openai') {
            return renderUnsupportedApiEditor(mainApi, renderApiMainSelect);
        }

        return renderChatCompletionEditor(provider, mainApi, renderApiMainSelect);
    }

    return {
        renderApi,
    };
}
