// 设置中心「模型连接」标签：当前连接和测试、连接编辑器（改动即保存）、连接档案。
import { getEffectiveConnection } from '../core/connection-labels.js';
import { createApiChatCompletionComponents } from './api-chat-completion.js';
import { createApiCurrentComponents } from './api-current.js';
import { createApiProfileComponents } from './api-profiles.js';
import { createApiTextCompletionComponents } from './api-text-completion.js';
import { createApiKoboldComponents } from './api-kobold-editor.js';
import { createApiNovelComponents } from './api-novel-editor.js';
import { createApiHordeComponents } from './api-horde-editor.js';
import { createSettingsImageModelComponents, renderSettingsConnectionViewSwitch } from './settings-image-model.js';

const TESTABLE_MAIN_APIS = ['openai', 'textgenerationwebui', 'kobold', 'novel', 'koboldhorde'];

export function createApiComponents(ctx) {
    const {
        state,
        escapeHtml,
        getProviderInfo,
        getSelectedApiMain,
    } = ctx;
    const { renderChatCompletionEditor } = createApiChatCompletionComponents(ctx);
    const { renderTextCompletionEditor } = createApiTextCompletionComponents(ctx);
    const { renderConnectionProfilesSection } = createApiProfileComponents(ctx);
    const { renderUnsupportedApiEditor, renderApiMainSelect } = createApiCurrentComponents(ctx);
    const { renderKoboldEditor } = createApiKoboldComponents(ctx);
    const { renderNovelEditor } = createApiNovelComponents(ctx);
    const { renderHordeEditor } = createApiHordeComponents(ctx);
    // 顶部「文本模型 / 图片模型」切换的图片一侧（components/settings-image-model.js，状态 state.settingsConnectionView）
    const { renderImageModelSettings } = createSettingsImageModelComponents(ctx);

    function getTestBadgeClass(status) {
        if (status === '失败') {
            return 'danger';
        }
        return status === '可用' ? 'active' : '';
    }

    // 一行说明当前在用的连接：来源 · 模型（与顶栏、聊天输入框旁的连接标签同一口径）
    function describeCurrentConnection() {
        const connection = getEffectiveConnection(state.settings || {}, getProviderInfo());
        return connection.model ? connection.label : `${connection.label} · 未选择模型`;
    }

    function renderConnectionTab() {
        if (state.settingsConnectionView === 'image') {
            return `
        <div class="settings-connection" data-preserve-inputs>
            ${renderSettingsConnectionViewSwitch('image', escapeHtml)}
            ${renderImageModelSettings()}
        </div>
    `;
        }
        const canTest = TESTABLE_MAIN_APIS.includes(getSelectedApiMain());
        const test = state.apiTest;
        const tested = test.status && test.status !== '未测试';

        return `
        <div class="settings-connection" data-preserve-inputs>
            ${renderSettingsConnectionViewSwitch('text', escapeHtml)}
            <section class="panel section-panel connection-editor">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">当前连接</h2>
                        <p class="panel-subtitle" data-api-current-connection>${escapeHtml(describeCurrentConnection())}</p>
                    </div>
                    <div class="panel-actions">
                        <span class="badge ${getTestBadgeClass(test.status)}" data-api-test-status title="${escapeHtml(test.detail)}">${escapeHtml(test.status || '未测试')}</span>
                        <button class="primary-button" type="button" data-test-api ${test.running || !canTest ? 'disabled' : ''}>
                            <i class="fa-solid ${test.running ? 'fa-circle-notch fa-spin' : 'fa-plug-circle-check'}"></i>
                            ${test.running ? '测试中' : '测试连接'}
                        </button>
                    </div>
                </div>
                ${tested ? `<p class="connection-test-detail ${test.status === '失败' ? 'danger' : ''}" data-api-test-detail>${escapeHtml(test.detail)}</p>` : ''}
                ${renderApiConnectionEditor()}
            </section>
            ${renderConnectionProfilesSection()}
        </div>
    `;
    }

    function renderApiConnectionEditor() {
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
        if (mainApi === 'koboldhorde') {
            return renderHordeEditor(mainApi, renderApiMainSelect);
        }
        if (mainApi !== 'openai') {
            return renderUnsupportedApiEditor(mainApi, renderApiMainSelect);
        }
        return renderChatCompletionEditor(mainApi, renderApiMainSelect);
    }

    return {
        renderConnectionTab,
    };
}
