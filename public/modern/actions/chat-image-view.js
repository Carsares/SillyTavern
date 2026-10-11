/**
 * 图片消息的查看动作（WP3）：切换版本（写回 extra.media_index）、打开 / 关闭大图、复制提示词。
 * 方案见 docs/image-generation/FRONTEND-DESIGN.md 第 4.2 节。
 *
 * 切换版本要写聊天文件，走 actionRegistry.chatContextActions.updateModernChatAndSync（排队保存并通知引擎重开聊天）；
 * 生成中不能切换：图片生成期间 state.engine.generating 也为真（见方案 F1），引擎正在用这份聊天文件。
 * 大图只改界面状态 state.chatImageGeneration.lightbox，不写文件。消息按身份（send_date + name + is_user）定位，
 * 下标会随「加载更早消息」变化。
 *
 * @param {import('../shell/feature-slot-actions.js').FeatureSlotDeps} deps 依赖。
 * @returns {Record<string, Function>}
 */
import { describeReloadFailure } from '../core/bridge-reload.js';
import { ensureChatImageState } from '../core/chat-image-state.js';
import { findMessageIndexByIdentity, getImageVersion, isImageMessage, messageIdentity, setImageVersionIndex } from '../core/image-message.js';

export function createChatImageViewActions(deps) {
    const { state, render, showToast, actionRegistry } = deps;
    const chatContext = actionRegistry.chatContextActions;

    /**
     * 当前聊天里的一条图片消息。
     * @param {number | string} messageIndex 消息在整个聊天里的下标。
     * @returns {{ entity: any, groupMode: boolean, chatId: string, cacheKey: string, index: number, message: any }}
     */
    function resolveImageTarget(messageIndex) {
        const entity = actionRegistry.getSelectedChatEntity();
        const groupMode = actionRegistry.isGroupChatMode();
        const chatId = state.selected.chat;
        const contextKey = actionRegistry.getChatContextKey(entity, groupMode);
        if (!entity || !contextKey || !chatId) {
            throw new Error('请先选择一个聊天文件。');
        }
        const index = Number(messageIndex);
        const messages = chatContext.getSelectedChatMessages();
        if (!Number.isInteger(index) || index < 0 || index >= messages.length) {
            throw new Error('消息位置无效，请刷新后重试。');
        }
        const message = messages[index];
        if (!isImageMessage(message)) {
            throw new Error('这条消息不是图片消息。');
        }
        return { entity, groupMode, chatId, cacheKey: chatContext.getCurrentDraftKey(), index, message };
    }

    /**
     * 切换显示的版本并写回聊天文件（extra.media_index）。
     * 按步长在最新的消息上计算，连点两次「下一个」排队执行时会前进两格；已在第一个 / 最后一个版本时不做任何事。
     * @param {number | string} messageIndex 消息下标。
     * @param {number | string} direction -1 上一个，1 下一个。
     * @returns {Promise<number | null>} 切换后的版本下标；没有切换时为 null。
     */
    async function selectChatImageVersion(messageIndex, direction) {
        if (state.engine.generating) {
            throw new Error('生成中不能切换图片版本。');
        }
        const { entity, groupMode, chatId, message } = resolveImageTarget(messageIndex);
        const step = Number(direction) < 0 ? -1 : 1;
        const current = getImageVersion(message);
        const target = current.index + step;
        if (target < 0 || target >= current.count) {
            return null;
        }

        const identity = messageIdentity(message);
        const { result, engineSync } = await chatContext.updateModernChatAndSync(entity, chatId, latest => {
            if (state.engine.generating) {
                throw new Error('生成中不能切换图片版本。');
            }
            const latestIndex = findMessageIndexByIdentity(latest, identity);
            if (latestIndex < 0 || !isImageMessage(latest[latestIndex])) {
                throw new Error('图片消息已变化，请刷新后重试。');
            }
            const next = setImageVersionIndex(latest[latestIndex], getImageVersion(latest[latestIndex]).index + step);
            latest[latestIndex] = next;
            return getImageVersion(next).index;
        }, { groupMode });
        render();

        // 文件已保存、界面已刷新；引擎同步失败只补一条说明
        const sync = await engineSync;
        if (sync && sync.ok === false) {
            showToast('图片版本已切换', `已保存到聊天文件${describeReloadFailure(sync)}`);
        }
        return result;
    }

    /**
     * 打开大图。
     * @param {number | string} messageIndex 消息下标。
     * @param {number | string} [mediaIndex] 要看的版本，缺省时为当前显示的版本；越界时夹到范围内。
     */
    function openChatImageLightbox(messageIndex, mediaIndex) {
        const { cacheKey, message } = resolveImageTarget(messageIndex);
        const version = getImageVersion(message);
        const requested = mediaIndex === undefined || mediaIndex === null || mediaIndex === '' ? NaN : Math.trunc(Number(mediaIndex));
        const index = Number.isFinite(requested) ? Math.min(Math.max(requested, 0), version.count - 1) : version.index;
        ensureChatImageState(state).lightbox = { cacheKey, identity: messageIdentity(message), index };
        render();
    }

    /**
     * 关闭大图。
     * @param {{ silent?: boolean }} [options] silent：只清状态不重渲染（调用方马上会自己渲染时用）。
     */
    function closeChatImageLightbox({ silent = false } = {}) {
        const slot = ensureChatImageState(state);
        if (!slot.lightbox) {
            return;
        }
        slot.lightbox = null;
        if (!silent) {
            render();
        }
    }

    async function writeClipboard(text) {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.append(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
    }

    /**
     * 复制提示词。
     * @param {number | string} messageIndex 消息下标。
     * @param {number | string} [mediaIndex] 哪个版本的提示词，缺省时为当前显示的版本（大图里看的可能是别的版本）。
     */
    async function copyChatImagePrompt(messageIndex, mediaIndex) {
        const { message } = resolveImageTarget(messageIndex);
        const media = message.extra.media;
        const requested = mediaIndex === undefined || mediaIndex === null || mediaIndex === '' ? NaN : Math.trunc(Number(mediaIndex));
        const item = Number.isFinite(requested) && requested >= 0 && requested < media.length ? media[requested] : getImageVersion(message).item;
        const text = String(item?.title || '');
        if (!text.trim()) {
            throw new Error('这张图片没有记录提示词。');
        }
        await writeClipboard(text);
        showToast('提示词已复制', message.name || '当前聊天');
    }

    return {
        selectChatImageVersion,
        openChatImageLightbox,
        closeChatImageLightbox,
        copyChatImagePrompt,
    };
}
