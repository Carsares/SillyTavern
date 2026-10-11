// 开场白（角色卡的 first_mes + alternate_greetings）相关的纯函数：不读全局状态，便于单独测试。
// 旧版对照：public/script.js 的 getFirstMessage（候选 = [first_mes, ...备用开场白]）、getOverswipeBehavior（未对话的聊天在开场白上
// 左右切换只循环、不生成）、public/scripts/group-chats.js 的 getFirstCharacterMessage（群聊每个成员随机取一条）。

// Modern 自己写入的消息在 extra.api 里的来源标记（不是 API 名）。
export const MODERN_MESSAGE_SOURCE = 'modern';

/**
 * 解析用户名：与 chat-context-selectors.js 的 getUserName 同一口径。
 * @param {{ settings?: { name1?: string }, me?: { name?: string, handle?: string } }} state 界面状态
 * @returns {string} 用户名
 */
export function resolveUserName(state) {
    return state?.settings?.name1 || state?.me?.name || state?.me?.handle || 'You';
}

/**
 * 角色名：与 getCharacterName 同一口径。
 * @param {object} character 角色卡
 * @returns {string} 角色名
 */
export function resolveCharacterName(character) {
    return character?.name || character?.data?.name || '未命名角色';
}

/**
 * 替换开场白里的 {{user}} / {{char}} 并去掉首尾空白。
 * @param {unknown} value 开场白原文
 * @param {object} character 角色卡
 * @param {string} userName 用户名
 * @returns {string} 替换后的文本，空白内容返回空串
 */
export function formatGreetingText(value, character, userName) {
    return String(value ?? '')
        .replaceAll('{{user}}', userName)
        .replaceAll('{{char}}', resolveCharacterName(character))
        .trim();
}

/**
 * 角色卡上的全部开场白：first_mes 在前，备用开场白在后，空白条目丢弃。
 * first_mes 为空时第一条备用开场白就是开场白（与旧版 getFirstMessage 的 shift 一致）。
 * 旧版不会丢弃空的备用开场白，那样候选里会出现空白项；这里丢弃，是有意的差异。
 * @param {object} character 角色卡（摘要卡没有这些字段，调用前要先取完整卡）
 * @param {string} userName 用户名
 * @returns {string[]} 已替换宏的开场白文本
 */
export function listCharacterGreetings(character, userName) {
    const data = character?.data;
    const alternates = Array.isArray(data?.alternate_greetings) ? data.alternate_greetings : [];
    return [data?.first_mes || character?.first_mes || '', ...alternates]
        .filter(text => typeof text === 'string')
        .map(text => formatGreetingText(text, character, userName))
        .filter(Boolean);
}

/**
 * 卡上备用开场白的数量（只数 alternate_greetings 里的非空文本，不含 first_mes）。
 * @param {object} character 角色卡
 * @returns {number} 备用开场白数量
 */
export function countAlternateGreetings(character) {
    const alternates = character?.data?.alternate_greetings;
    return Array.isArray(alternates) ? alternates.filter(text => typeof text === 'string' && text.trim()).length : 0;
}

function cloneValue(value) {
    return value === undefined ? undefined : structuredClone(value);
}

/**
 * 候选下标限制在 [0, count)，非法值按 0。
 * @param {unknown} swipeId 消息上的 swipe_id
 * @param {number} count 候选数量
 * @returns {number} 合法下标
 */
export function clampSwipeId(swipeId, count) {
    const id = Number(swipeId);
    if (!Number.isInteger(id) || id < 0) {
        return 0;
    }
    return Math.min(id, Math.max(0, count - 1));
}

/**
 * 聊天是否还停在「只有开场白、没有对话过」的状态，且开场白有多个候选：此时左右切换只在候选之间循环，
 * 不需要生成引擎（旧版 getOverswipeBehavior 的 PRISTINE_GREETING）。
 * 必须同时满足：聊天只有一条消息、它不是用户 / 系统消息、候选多于一个且都是文本、聊天头没有 tainted 标记
 * （旧版在发送、生成、删除、编辑消息时都会写入 tainted）。
 * @param {object[]} messages 当前聊天的全部消息
 * @param {object} [metadata] 聊天头 chat_metadata
 * @returns {boolean} 可以本地切换则为 true
 */
export function canSwitchGreetingLocally(messages, metadata) {
    if (!Array.isArray(messages) || messages.length !== 1) {
        return false;
    }
    const message = messages[0];
    if (!message || message.is_user || message.is_system || metadata?.tainted) {
        return false;
    }
    return Array.isArray(message.swipes)
        && message.swipes.length > 1
        && message.swipes.every(text => typeof text === 'string');
}

/**
 * 在开场白候选之间循环切换，返回新消息（不修改传入的对象）。逻辑对照旧版 syncMesToSwipe + syncSwipeToMes：
 * 先把当前显示的消息里被改过的 send_date / extra 记回它自己的 swipe_info，再从目标候选的 swipe_info 载入
 * mes、send_date、extra。左切第一个回到最后一个，右切最后一个回到第一个。
 * @param {object} message 第 0 条消息，已通过 canSwitchGreetingLocally
 * @param {'left' | 'right'} direction 切换方向
 * @returns {{ message: object, swipeId: number, swipeCount: number }} 新消息、新候选下标和候选数量
 */
export function switchGreetingMessage(message, direction) {
    const count = message.swipes.length;
    const current = clampSwipeId(message.swipe_id, count);
    const target = direction === 'left' ? (current - 1 + count) % count : (current + 1) % count;

    const swipeInfo = Array.from({ length: count }, (_, index) => {
        const info = message.swipe_info?.[index];
        return info && typeof info === 'object'
            ? { ...info }
            : { send_date: message.send_date, extra: {} };
    });
    swipeInfo[current] = {
        ...swipeInfo[current],
        send_date: message.send_date,
        extra: cloneValue(message.extra) ?? {},
    };

    const next = { ...message };
    delete next.gen_started;
    delete next.gen_finished;
    const targetInfo = swipeInfo[target];
    next.swipe_id = target;
    next.swipe_info = swipeInfo;
    next.mes = message.swipes[target];
    next.send_date = targetInfo.send_date ?? message.send_date;
    next.extra = cloneValue(targetInfo.extra) ?? {};
    if (targetInfo.gen_started !== undefined) {
        next.gen_started = targetInfo.gen_started;
    }
    if (targetInfo.gen_finished !== undefined) {
        next.gen_finished = targetInfo.gen_finished;
    }

    return { message: next, swipeId: target, swipeCount: count };
}

/**
 * 「载入备用开场白」按钮是否值得出现：角色聊天、聊天头没有 tainted、只有一条非用户 / 非系统消息且还没有候选、
 * 角色卡带备用开场白。是否真的能载入（消息要和卡上某条开场白一致）在点击时由 planAlternateGreetingLoad 判断。
 * @param {object} options 参数
 * @param {object | null} options.entity 当前角色（群聊为群对象）
 * @param {boolean} options.groupMode 是否群聊
 * @param {object[]} options.messages 当前聊天的全部消息
 * @param {object} [options.metadata] 聊天头 chat_metadata
 * @returns {boolean} 应该显示按钮则为 true
 */
export function canOfferAlternateGreetings({ entity, groupMode, messages, metadata }) {
    if (groupMode || !entity || !Array.isArray(messages) || messages.length !== 1 || metadata?.tainted) {
        return false;
    }
    const message = messages[0];
    if (!message || message.is_user || message.is_system) {
        return false;
    }
    const hasCandidates = Array.isArray(message.swipes) && message.swipes.length > 1;
    return !hasCandidates && countAlternateGreetings(entity) > 0;
}

/**
 * 给只有开场白的旧聊天补上备用开场白候选：消息要和卡上的某条开场白（替换宏前后均可）完全一致才处理，
 * 其余情况不动聊天，避免把用户自己写的第一条消息当成开场白。当前显示的文本保持不变，下标记为它对应的候选。
 * @param {object} options 参数
 * @param {object[]} options.messages 当前聊天的全部消息
 * @param {object} [options.metadata] 聊天头 chat_metadata
 * @param {object} options.character 完整角色卡
 * @param {string} options.userName 用户名
 * @returns {{ message: object, swipeId: number, swipeCount: number } | { error: string }} 新的第 0 条消息，或不能载入的原因
 */
export function planAlternateGreetingLoad({ messages, metadata, character, userName }) {
    if (!Array.isArray(messages) || messages.length !== 1 || messages[0]?.is_user || messages[0]?.is_system) {
        return { error: '只有开场白的聊天才能载入备用开场白。' };
    }
    if (metadata?.tainted) {
        return { error: '这个聊天已经有过对话，不能再换开场白。' };
    }
    const message = messages[0];
    if (Array.isArray(message.swipes) && message.swipes.length > 1) {
        return { error: '这条开场白已经有候选了。' };
    }

    const greetings = listCharacterGreetings(character, userName);
    if (greetings.length < 2) {
        return { error: '角色卡没有备用开场白。' };
    }
    const data = character?.data;
    const rawGreetings = [data?.first_mes || character?.first_mes || '', ...(Array.isArray(data?.alternate_greetings) ? data.alternate_greetings : [])]
        .filter(text => typeof text === 'string' && text.trim())
        .map(text => text.trim());
    const shown = String(message.mes ?? '').trim();
    const index = greetings.findIndex((text, position) => text === shown || rawGreetings[position] === shown);
    if (index < 0) {
        return { error: '当前开场白和角色卡上的开场白不一致，没有载入备用开场白。' };
    }

    const swipes = greetings.map((text, position) => (position === index ? String(message.mes) : text));
    // 其它候选只继承来源标记（api / model），不带当前消息上的翻译、摘要等附加内容
    const marker = {};
    for (const key of ['api', 'model']) {
        if (message.extra?.[key] !== undefined) {
            marker[key] = message.extra[key];
        }
    }
    const next = {
        ...message,
        swipe_id: index,
        swipes,
        swipe_info: swipes.map((_, position) => ({
            send_date: message.send_date,
            extra: position === index ? cloneValue(message.extra) ?? {} : { ...marker },
        })),
    };
    return { message: next, swipeId: index, swipeCount: swipes.length };
}
