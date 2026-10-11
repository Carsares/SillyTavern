import { CHAT_COMPLETION_RESPONSE_DEFAULT } from './chat-completion-limits.js';

// 聊天补全连接测试，以及按主 API 分派到各连接类型的测试。字段的保存见 actions/api-autosave.js（改动即保存）。
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
    function getChatCompletionSettingsForTest() {
        const savedSettings = getOaiSettings();
        const source = savedSettings.chat_completion_source || state.settings.chat_completion_source || 'openai';
        const model = getChatCompletionModel(savedSettings, source);

        if (!model) {
            throw new Error('还没有填写模型，填好后再测试。');
        }

        return {
            source,
            model,
            temperature: getNumberSetting(savedSettings, 'temp_openai', 1),
            maxTokens: getNumberSetting(savedSettings, 'openai_max_tokens', CHAT_COMPLETION_RESPONSE_DEFAULT),
            topP: getNumberSetting(savedSettings, 'top_p_openai', 1),
            frequencyPenalty: getNumberSetting(savedSettings, 'freq_pen_openai', 0),
            presencePenalty: getNumberSetting(savedSettings, 'pres_pen_openai', 0),
            siliconflowEndpoint: savedSettings.siliconflow_endpoint || 'global',
            minimaxEndpoint: savedSettings.minimax_endpoint || 'global',
            customUrl: savedSettings.custom_url || '',
            reverseProxy: savedSettings.reverse_proxy || '',
            proxyPassword: savedSettings.proxy_password || '',
        };
    }

    function responseContentToText(content) {
        if (typeof content === 'string') {
            return content;
        }
        if (Array.isArray(content)) {
            return content.map(item => item?.text || item?.content || '').filter(Boolean).join('\n');
        }
        return '';
    }

    // Mirrors the chat-completion shapes read by extractReasoningFromData in public/scripts/reasoning.js:
    // OpenAI-compatible reasoning_content / reasoning fields, plus Claude and Mistral "thinking" parts.
    function extractReasoningText(response) {
        const choice = response?.choices?.[0];
        const message = choice?.message;
        const thinkingText = [message?.content, response?.content]
            .filter(Array.isArray)
            .flat()
            .filter(part => part?.type === 'thinking')
            .map(part => responseContentToText(part.thinking))
            .join('\n');

        return [
            message?.reasoning_content,
            message?.reasoning,
            choice?.reasoning,
            thinkingText,
        ].map(responseContentToText).find(text => text.trim()) || '';
    }

    function readConnectionTestReply(response) {
        if (response?.error) {
            throw new Error(response.error.message || String(response.error));
        }

        const choice = response?.choices?.[0];
        const text = responseContentToText(choice?.message?.content)
            || responseContentToText(choice?.delta?.content)
            || responseContentToText(choice?.text)
            || responseContentToText(response?.message?.content)
            || responseContentToText(response?.content);

        if (text.trim()) {
            return { text: text.trim(), reasoningOnly: false };
        }

        // Reasoning models can spend the whole (deliberately small) test token budget on reasoning.
        // The request still reached the model and got a valid reply, so the connection itself works.
        if (extractReasoningText(response).trim()) {
            return { text: '', reasoningOnly: true };
        }

        throw new Error('模型没有返回可显示内容。');
    }

    function createChatCompletionRequestBody(settings, messages) {
        return {
            chat_completion_source: settings.source,
            messages,
            model: settings.model,
            temperature: settings.temperature,
            max_tokens: settings.maxTokens,
            stream: false,
            top_p: settings.topP,
            frequency_penalty: settings.frequencyPenalty,
            presence_penalty: settings.presencePenalty,
            siliconflow_endpoint: settings.siliconflowEndpoint,
            minimax_endpoint: settings.minimaxEndpoint,
            custom_url: settings.customUrl,
            reverse_proxy: settings.reverseProxy,
            proxy_password: settings.proxyPassword,
            n: 1,
        };
    }

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
        const settings = getChatCompletionSettingsForTest();
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
