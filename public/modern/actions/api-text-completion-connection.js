// 文本补全连接测试。字段的保存见 actions/api-autosave.js（改动即保存）；测试用的是已保存的设置。
import { textCompletionModelFields } from '../core/connection-labels.js';

export function createApiTextCompletionConnectionActions({
    state,
    apiFetch,
    render,
    showToast,
    recordApiTestResult,
}) {
    function getTextCompletionSettingsForTest() {
        const settings = state.settings.textgenerationwebui_settings || {};
        const source = settings.type || state.settings.textgen_type || 'ooba';
        const modelField = textCompletionModelFields[source];
        const endpoint = settings.server_urls?.[source] || settings.api_server || state.settings.api_server_textgenerationwebui || '';
        if (!endpoint) {
            throw new Error('还没有填写端点，填好后再测试。');
        }
        return {
            source,
            endpoint,
            model: (modelField ? settings[modelField] : '') || settings.model || '',
        };
    }

    async function testTextCompletionConnection() {
        const settings = getTextCompletionSettingsForTest();

        state.apiTest = {
            running: true,
            status: '测试中',
            detail: `${settings.source} / ${settings.model || settings.endpoint}`,
        };
        render();

        try {
            const response = await apiFetch('/api/backends/text-completions/status', {
                body: {
                    api_server: settings.endpoint,
                    api_type: settings.source,
                },
            });
            const result = response?.result || settings.model || '已连接';
            state.apiTest = {
                running: false,
                status: '可用',
                detail: `${settings.source}: ${result}`,
            };
            recordApiTestResult('可用', state.apiTest.detail, {
                source: settings.source,
                model: settings.model || result,
            });
            showToast('文本补全连接测试成功', state.apiTest.detail);
        } catch (error) {
            state.apiTest = {
                running: false,
                status: '失败',
                detail: error.message,
            };
            recordApiTestResult('失败', error.message, {
                source: settings.source,
                model: settings.model || settings.endpoint,
            });
            throw error;
        } finally {
            render();
        }
    }

    return {
        testTextCompletionConnection,
    };
}
