import {
    createChatCompletionRequestBody,
    getChatCompletionSettingsForTest,
    readConnectionTestReply,
} from '../core/chat-completion-request.js';

// 聊天补全连接测试，以及按主 API 分派到各连接类型的测试。字段的保存见 actions/api-autosave.js（改动即保存）。
// 请求体的组装和回复的解析在 core/chat-completion-request.js，「从消息生成」提示词（actions/chat-image-prompt.js）也用它们。
// 测试用的是已保存的设置：点「测试连接」前会先等在途的保存结束（见 routes/api-events.js）。

export function createApiChatCompletionConnectionActions({
    state,
    apiFetch,
    render,
    showToast,
    getChatCompletionModel,
    getNumberSetting,
    getOaiSettings,
    getSelectedApiMain,
    recordApiTestResult,
    testTextCompletionConnection,
    testKoboldConnection,
    testNovelConnection,
    testHordeConnection,
}) {
    async function testApiConnection() {
        if (state.apiTest.running) {
            return;
        }
        if (getSelectedApiMain() === 'textgenerationwebui') {
            await testTextCompletionConnection();
            return;
        }
        if (getSelectedApiMain() === 'kobold') {
            await testKoboldConnection();
            return;
        }
        if (getSelectedApiMain() === 'novel') {
            await testNovelConnection();
            return;
        }
        if (getSelectedApiMain() === 'koboldhorde') {
            await testHordeConnection();
            return;
        }
        if (getSelectedApiMain() !== 'openai') {
            throw new Error('现代页当前不支持测试该主 API。');
        }
        const settings = getChatCompletionSettingsForTest({
            oaiSettings: getOaiSettings(),
            settings: state.settings,
            getChatCompletionModel,
            getNumberSetting,
        });
        const body = createChatCompletionRequestBody(settings, [
            { role: 'user', content: '请只回复 OK。' },
        ]);
        body.max_tokens = Math.min(settings.maxTokens, 20);

        state.apiTest = {
            running: true,
            status: '测试中',
            detail: `${settings.source} / ${settings.model}`,
        };
        render();

        try {
            const response = await apiFetch('/api/backends/chat-completions/generate', { body });
            const reply = readConnectionTestReply(response);
            const replyDetail = reply.reasoningOnly
                ? '连接正常：模型只返回了推理内容（测试请求的 token 上限较低）'
                : reply.text.slice(0, 80);
            state.apiTest = {
                running: false,
                status: '可用',
                detail: `${settings.model}: ${replyDetail}`,
            };
            recordApiTestResult('可用', state.apiTest.detail, settings);
            showToast('连接测试成功', state.apiTest.detail);
        } catch (error) {
            state.apiTest = {
                running: false,
                status: '失败',
                detail: error.message,
            };
            recordApiTestResult('失败', error.message, settings);
            throw error;
        } finally {
            render();
        }
    }

    return {
        testApiConnection,
    };
}
