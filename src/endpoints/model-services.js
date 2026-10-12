import fs from 'node:fs';
import path from 'node:path';

import express from 'express';

import { SETTINGS_FILE } from '../constants.js';
import { readSecret } from './secrets.js';
import { createChatAdapter } from '../conversation/providers/chat/index.js';
import { createConnectionFetch } from '../conversation/providers/core/proxy.js';
import {
    DEFAULT_SCENE_CONTEXT_WINDOW,
    getServiceProblem,
    readModelServices,
    resolveSceneTarget,
} from '../../public/shared/model-services.js';

// 模型服务（public/shared/model-services.js）的服务端调用：按场景或服务 id 解析出服务和模型，按 id 读取密钥，
// 用对话模块的适配器发一次非流式请求。照搬 src/endpoints/image-generation.js 的做法：设置从 settings.json 读，
// 密钥只在服务端读取，请求走主进程的 HTTP agent（用户的请求代理和私网白名单仍然生效）。
// 失败返回 { error, message, detail? }；提示词、密钥和地址不进错误体和日志。

const LOG_PREFIX = '[model-services]';
const MAX_MESSAGES = 32;
const MAX_MESSAGE_LENGTH = 100000;
const TEST_MAX_OUTPUT_TOKENS = 256;
const TIMEOUT_MS = 120000;
const MESSAGE_ROLES = new Set(['system', 'user', 'assistant']);
/** 适配器在发出请求前就会报的错误码：说明是配置或请求有问题，不是上游的问题。 */
const UNSENT_ERROR_CODES = new Set(['invalid-connection', 'invalid-request', 'invalid-transport', 'invalid-proxy', 'unsupported-provider', 'unsupported-parameters', 'invalid-parameters', 'invalid-budget', 'invalid-content']);

class ModelServiceError extends Error {
    /**
     * @param {number} status HTTP 状态
     * @param {string} code 错误码
     * @param {string} message 英文说明，不含提示词、密钥或地址
     * @param {{ detail?: string, reason?: string }} [options] 上游给出的（已脱敏）原因、写日志用的内部代码
     */
    constructor(status, code, message, { detail = '', reason = '' } = {}) {
        super(message);
        this.name = 'ModelServiceError';
        this.status = status;
        this.code = code;
        this.detail = detail;
        this.reason = reason;
    }

    /** @returns {{ error: string, message: string, detail?: string }} 公开的错误体 */
    toBody() {
        return { error: this.code, message: this.message, ...(this.detail ? { detail: this.detail } : {}) };
    }
}

/**
 * @param {any} error 异常
 * @returns {string} 错误码或名称，不取 message（可能含地址或上游文本）
 */
function describeCode(error) {
    const code = error?.code ?? error?.cause?.code;
    if (typeof code === 'string' && /^[\w.-]{1,64}$/.test(code)) {
        return code;
    }
    return typeof error?.name === 'string' && /^\w{1,64}$/.test(error.name) ? error.name : 'unknown';
}

/**
 * @param {import('express').Request} request 请求
 * @returns {Record<string, any>} settings.json 内容
 */
function readUserSettings(request) {
    try {
        const raw = fs.readFileSync(path.join(request.user.directories.root, SETTINGS_FILE), 'utf8');
        const settings = JSON.parse(raw);
        if (!settings || typeof settings !== 'object') {
            throw new Error('not an object');
        }
        return settings;
    } catch (error) {
        throw new ModelServiceError(500, 'settings-unavailable', 'The settings file could not be read.', { reason: describeCode(error) });
    }
}

/**
 * @param {unknown} body 请求体
 * @returns {Record<string, any>} 请求体对象
 */
function requireBody(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ModelServiceError(400, 'invalid-request', 'Request body must be a JSON object.');
    }
    return /** @type {Record<string, any>} */ (body);
}

/**
 * @param {unknown} value 消息列表
 * @returns {{ role: string, content: string }[]} 校验过的消息
 */
function readMessages(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > MAX_MESSAGES) {
        throw new ModelServiceError(400, 'invalid-request', `messages must contain 1 to ${MAX_MESSAGES} items.`);
    }
    return value.map(item => {
        if (!item || !MESSAGE_ROLES.has(item.role) || typeof item.content !== 'string' || !item.content || item.content.length > MAX_MESSAGE_LENGTH) {
            throw new ModelServiceError(400, 'invalid-request', `Each message needs a role (system, user or assistant) and 1 to ${MAX_MESSAGE_LENGTH} characters of text.`);
        }
        return { role: item.role, content: item.content };
    });
}

/**
 * @param {unknown} value 请求里的回复上限
 * @param {number} fallback 场景的回复上限
 * @returns {number} 不超过场景上限的值
 */
function readMaxOutputTokens(value, fallback) {
    if (value === undefined || value === null) {
        return fallback;
    }
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1) {
        throw new ModelServiceError(400, 'invalid-request', 'maxOutputTokens must be a positive integer.');
    }
    return Math.min(number, fallback);
}

/**
 * 把场景解析的错误转成公开错误。
 * @param {any} error resolveSceneTarget 抛出的错误
 * @returns {ModelServiceError} 公开错误
 */
function toSceneFailure(error) {
    if (error instanceof ModelServiceError) {
        return error;
    }
    switch (error?.code) {
        case 'scene-not-configured':
            return new ModelServiceError(400, 'scene-not-configured', 'This scene has no model service. Choose one in the settings center.');
        case 'service-not-found':
            return new ModelServiceError(400, 'service-not-found', 'The model service of this scene no longer exists.');
        case 'model-missing':
            return new ModelServiceError(400, 'model-missing', 'No model is selected for this scene.');
        default:
            return new ModelServiceError(500, 'internal-error', 'The scene could not be resolved.', { reason: describeCode(error) });
    }
}

/**
 * 适配器错误 → 公开错误。
 * @param {any} error 适配器抛出的错误
 * @param {boolean} clientGone 客户端已经断开
 * @returns {ModelServiceError} 公开错误
 */
function toProviderFailure(error, clientGone) {
    const code = describeCode(error);
    if (clientGone) {
        return new ModelServiceError(499, 'cancelled', 'The request was cancelled.', { reason: code });
    }
    if (error?.name === 'TimeoutError') {
        return new ModelServiceError(504, 'provider-timeout', `The model service did not answer within ${TIMEOUT_MS / 1000} seconds.`, { reason: code });
    }
    if (UNSENT_ERROR_CODES.has(code)) {
        return new ModelServiceError(400, 'invalid-service', 'The model service configuration is invalid.', { reason: code });
    }
    switch (code) {
        case 'provider-http-error': {
            const status = Number.isSafeInteger(error.details?.status) ? error.details.status : null;
            const providerMessage = typeof error.details?.providerMessage === 'string' ? error.details.providerMessage : '';
            return new ModelServiceError(502, 'provider-http-error', status ? `The model service returned HTTP ${status}.` : 'The model service returned an error.', { detail: providerMessage, reason: status ? `HTTP ${status}` : '' });
        }
        case 'provider-content-blocked':
            return new ModelServiceError(502, 'provider-content-blocked', 'The model service refused to answer this request.', { reason: code });
        case 'provider-network-error':
        case 'transport-closed':
            return new ModelServiceError(502, 'provider-network-error', 'The model service could not be reached.', { reason: code });
        default:
            return new ModelServiceError(502, 'provider-response-invalid', 'The model service returned an invalid response.', { reason: code });
    }
}

/**
 * @param {import('express').Response} response 响应
 * @param {any} error 异常
 */
function sendFailure(response, error) {
    const failure = error instanceof ModelServiceError
        ? error
        : new ModelServiceError(500, 'internal-error', 'The request failed.', { reason: describeCode(error) });
    if (failure.status >= 500 || failure.code === 'invalid-service') {
        console.warn(`${LOG_PREFIX} ${failure.code}${failure.reason ? ` (${failure.reason})` : ''}`);
    }
    if (!response.headersSent && !response.writableEnded) {
        response.status(failure.status).json(failure.toBody());
    }
}

/**
 * 读服务的密钥。登记过的服务按 id 读，从不回退到当前启用的那条；当前对话连接（未登记）用该来源当前启用的密钥。
 * @param {import('../users.js').UserDirectoryList} directories 用户目录
 * @param {import('../../public/shared/model-services.js').ModelService} service 服务
 * @param {boolean} implicit 是否为未登记的当前对话连接
 * @returns {string} 密钥
 */
function readServiceKey(directories, service, implicit) {
    const apiKey = readSecret(directories, service.secretKey, implicit ? null : service.secretId || null);
    if (!apiKey || (!implicit && !service.secretId)) {
        throw new ModelServiceError(400, 'secret-missing', 'No API key is saved for this model service.');
    }
    return apiKey;
}

/**
 * 调一次模型。
 * @param {import('express').Request} request 请求（用于读密钥）
 * @param {import('express').Response} response 回复（用于发现调用方断开）
 * @param {{ service: import('../../public/shared/model-services.js').ModelService, model: string, implicit: boolean }} target 服务和模型
 * @param {{ role: string, content: string }[]} messages 消息
 * @param {number} maxOutputTokens 回复上限
 * @param {{ fetch?: Function }} options 测试可注入的 fetch
 * @returns {Promise<{ content: string, reasoning: string, finishReason: string, usage: any }>} 结果
 */
async function callModel(request, response, target, messages, maxOutputTokens, { fetch } = {}) {
    if (!target.implicit) {
        // 缺密钥由 readServiceKey 报 secret-missing；其余问题说明记录本身不完整
        const problem = getServiceProblem(target.service);
        if (problem && problem !== 'secret-missing') {
            throw new ModelServiceError(400, 'invalid-service', 'The model service configuration is incomplete.', { reason: problem });
        }
    }
    const apiKey = readServiceKey(request.user.directories, target.service, target.implicit);
    const connection = {
        provider: target.service.provider,
        type: 'chat',
        model: target.model,
        ...(target.service.baseUrl ? { baseUrl: target.service.baseUrl } : {}),
        apiKey,
        contextWindow: Math.max(DEFAULT_SCENE_CONTEXT_WINDOW, maxOutputTokens + 1),
        maxOutputTokens,
        // 翻译这类辅助任务不需要推理；不支持关闭推理的接口会忽略
        reasoning: 'off',
        timeoutMs: TIMEOUT_MS,
    };

    let transport;
    let adapter;
    try {
        // 'global' 走主进程的 HTTP agent，用户的请求代理和私网白名单仍然生效
        transport = createConnectionFetch(connection, { ...(fetch ? { fetch } : {}), agent: 'global' });
        adapter = createChatAdapter(connection, { fetch: transport.fetch, errorDetail: true });
    } catch (error) {
        transport?.close();
        throw new ModelServiceError(400, 'invalid-service', 'The model service configuration is invalid.', { reason: describeCode(error) });
    }

    // 请求体读完后 request 的 close 也会触发，用 response 判断：还没写完回复就关闭，说明调用方断开了
    const controller = new AbortController();
    let clientGone = false;
    const onClose = () => {
        if (!response.writableEnded) {
            clientGone = true;
            controller.abort();
        }
    };
    response.on('close', onClose);
    try {
        const result = await adapter.generate({ messages, maxOutputTokens, stream: false, signal: controller.signal });
        return { content: result.content ?? '', reasoning: result.reasoning ?? '', finishReason: result.finishReason, usage: result.usage ?? null };
    } catch (error) {
        throw toProviderFailure(error, clientGone);
    } finally {
        response.off('close', onClose);
        transport.close();
    }
}

/**
 * @param {{ fetch?: Function }} [options] 测试可注入的 fetch
 * @returns {import('express').Router} 路由
 */
export function createModelServicesRouter({ fetch } = {}) {
    const router = express.Router();

    // 按场景调用：{ scene, messages, maxOutputTokens? } → { content, finishReason, usage, provider, model, service }
    router.post('/complete', async (request, response) => {
        try {
            const body = requireBody(request.body);
            const scene = typeof body.scene === 'string' ? body.scene : '';
            const messages = readMessages(body.messages);
            const settings = readUserSettings(request);
            let target;
            try {
                target = resolveSceneTarget(settings, scene);
            } catch (error) {
                throw toSceneFailure(error);
            }
            const maxOutputTokens = readMaxOutputTokens(body.maxOutputTokens, target.maxOutputTokens);
            const result = await callModel(request, response, target, messages, maxOutputTokens, { fetch });
            return response.json({
                content: result.content,
                hasReasoning: Boolean(result.reasoning),
                finishReason: result.finishReason,
                usage: result.usage,
                provider: target.service.provider,
                model: target.model,
                service: { id: target.service.id, name: target.service.name, implicit: target.implicit, followsChat: target.followsChat },
            });
        } catch (error) {
            return sendFailure(response, error);
        }
    });

    // 测试一个已登记的服务：{ serviceId, model? } → { content, finishReason }
    router.post('/test', async (request, response) => {
        try {
            const body = requireBody(request.body);
            const serviceId = typeof body.serviceId === 'string' ? body.serviceId : '';
            const settings = readUserSettings(request);
            const service = readModelServices(settings).services.find(item => item.id === serviceId);
            if (!service) {
                throw new ModelServiceError(404, 'service-not-found', 'No model service with this id is saved.');
            }
            const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : service.defaultModel;
            if (!model) {
                throw new ModelServiceError(400, 'model-missing', 'Choose a model to test this service.');
            }
            const result = await callModel(request, response, { service, model, implicit: false }, [{ role: 'user', content: 'Reply with OK only.' }], TEST_MAX_OUTPUT_TOKENS, { fetch });
            return response.json({ content: result.content.slice(0, 200), hasReasoning: Boolean(result.reasoning), finishReason: result.finishReason, model });
        } catch (error) {
            return sendFailure(response, error);
        }
    });

    return router;
}

export const router = createModelServicesRouter();
