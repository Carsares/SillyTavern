import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from '@jest/globals';

import {
    DEFAULT_SUMMARY_PROMPT,
    DEFAULT_SUMMARY_TEMPLATE,
    SUMMARY_NUMBER_FIELDS,
    SUMMARY_SETTING_DEFAULTS,
    buildSummarySettingsPatch,
    clearSummaryOnMessage,
    countSinceLastSummary,
    countSummaryWords,
    describeSummaryOutcome,
    describeSummaryProgress,
    describeSummarySource,
    getAutoSummaryGate,
    getLatestChatSummary,
    getManualSummaryGate,
    getSummaryProgress,
    isSummaryDraftDirty,
    isSummaryExtensionDisabled,
    parseSummarySettingsDraft,
    previewSummaryHolder,
    readSummarySettings,
    resolveSummaryWriteIndex,
    setSummaryOnMessage,
    toSummarySettingsDraft,
} from '../public/modern/core/chat-summary.js';

// 对照 public/scripts/extensions/memory/index.js（旧版摘要扩展）：读取、触发判断、设置范围。旧版改动时需要同步更新这里的期望。
const legacySource = fs.readFileSync(fileURLToPath(new URL('../public/scripts/extensions/memory/index.js', import.meta.url)), 'utf8');

const msg = (mes, memory) => ({ name: 'N', mes, ...(memory ? { extra: { memory } } : {}) });
const chatOf = (count, memories = {}) => Array.from({ length: count }, (_, index) => msg(`message ${index}`, memories[index]));

describe('getLatestChatSummary mirrors getLatestMemoryFromChat', () => {
    test('skips the last message and returns the latest summary with its index', () => {
        const messages = chatOf(6, { 1: 'old', 3: 'newer', 5: 'on the last message' });
        expect(getLatestChatSummary(messages)).toEqual({ text: 'newer', index: 3 });
    });

    test('a summary that sits only on the last message does not count', () => {
        expect(getLatestChatSummary(chatOf(3, { 2: 'last only' }))).toEqual({ text: '', index: -1 });
    });

    test('returns an empty result for no summary, an empty chat and a non-array', () => {
        expect(getLatestChatSummary(chatOf(4))).toEqual({ text: '', index: -1 });
        expect(getLatestChatSummary([])).toEqual({ text: '', index: -1 });
        expect(getLatestChatSummary(undefined)).toEqual({ text: '', index: -1 });
        expect(getLatestChatSummary([msg('only one', 'x')])).toEqual({ text: '', index: -1 });
    });

    test('an empty memory string is treated as no summary, like the legacy truthiness check', () => {
        const messages = chatOf(4, { 1: 'real' });
        messages[2].extra = { memory: '' };
        expect(getLatestChatSummary(messages)).toEqual({ text: 'real', index: 1 });
    });
});

describe('counting since the latest summary mirrors getSummaryPromptForNow', () => {
    test('counts only ASCII words, so Chinese text counts as zero words', () => {
        expect(countSummaryWords('Hello, world! It_s 42.')).toBe(4);
        expect(countSummaryWords('你好，世界')).toBe(0);
        expect(countSummaryWords('你好abc世界')).toBe(1);
        expect(countSummaryWords(undefined)).toBe(0);
        expect(countSummaryWords(12)).toBe(0);
    });

    test('counts back from the last message to the first message that holds a summary, without counting that message', () => {
        const messages = [msg('a b'), msg('c', 'summary'), msg('d e f'), msg('g')];
        expect(countSinceLastSummary(messages)).toEqual({ messagesSince: 2, wordsSince: 4 });
        expect(countSinceLastSummary([msg('a'), msg('b')])).toEqual({ messagesSince: 2, wordsSince: 2 });
        expect(countSinceLastSummary([])).toEqual({ messagesSince: 0, wordsSince: 0 });
    });

    test('a summary on the last message resets the counter to zero (the legacy loop checks the last message too)', () => {
        expect(countSinceLastSummary([msg('a'), msg('b', 'summary')])).toEqual({ messagesSince: 0, wordsSince: 0 });
    });
});

describe('getSummaryProgress follows the legacy update conditions', () => {
    const memory = { promptInterval: 10, promptForceWords: 0 };

    test('interval 0 switches everything off, including the word trigger', () => {
        const progress = getSummaryProgress(chatOf(30), { promptInterval: 0, promptForceWords: 5 });
        expect(progress).toMatchObject({ due: false, reason: 'off', remainingMessages: 0 });
    });

    test('an empty chat and a chat shorter than the interval are not due', () => {
        expect(getSummaryProgress([], memory)).toMatchObject({ due: false, reason: 'empty' });
        expect(getSummaryProgress(chatOf(6), memory)).toMatchObject({ due: false, reason: 'too-short', remainingMessages: 4 });
    });

    test('is due once the messages since the latest summary reach the interval', () => {
        expect(getSummaryProgress(chatOf(10), memory)).toMatchObject({ due: true, reason: 'interval', messagesSince: 10 });
        // summary at index 1: 12 messages, 10 after it
        expect(getSummaryProgress(chatOf(12, { 1: 's' }), memory)).toMatchObject({ due: true, reason: 'interval', messagesSince: 10 });
        // summary at index 3: 8 after it
        expect(getSummaryProgress(chatOf(12, { 3: 's' }), memory)).toMatchObject({ due: false, reason: 'waiting', messagesSince: 8, remainingMessages: 2 });
    });

    test('the word threshold triggers on its own when it is not zero', () => {
        const messages = chatOf(12, { 3: 's' }).map((message, index) => (index > 3 ? { ...message, mes: 'one two three four five six' } : message));
        expect(getSummaryProgress(messages, { promptInterval: 10, promptForceWords: 40 })).toMatchObject({ due: true, reason: 'words' });
        expect(getSummaryProgress(messages, { promptInterval: 10, promptForceWords: 0 })).toMatchObject({ due: false, reason: 'waiting' });
        expect(getSummaryProgress(messages, { promptInterval: 10, promptForceWords: 100 })).toMatchObject({ due: false, reason: 'waiting' });
    });

    test('describes each state in words', () => {
        expect(describeSummaryProgress(getSummaryProgress(chatOf(30), { promptInterval: 0, promptForceWords: 0 }))).toContain('已关闭');
        expect(describeSummaryProgress(getSummaryProgress(chatOf(6), memory))).toContain('还差 4 条');
        expect(describeSummaryProgress(getSummaryProgress(chatOf(10), memory))).toContain('下一条回复结束后会自动摘要');
        expect(describeSummaryProgress(getSummaryProgress(chatOf(12, { 3: 's' }), memory))).toContain('还差 2 条');
    });
});

describe('summary settings', () => {
    test('a missing memory object reads as the extension defaults, which means the Extras source', () => {
        const memory = readSummarySettings({});
        expect(memory).toEqual(SUMMARY_SETTING_DEFAULTS);
        expect(memory.source).toBe('extras');
        expect(memory.promptInterval).toBe(10);
    });

    test('numbers stored as strings (the legacy panel stores the injection position that way) are read as numbers', () => {
        const memory = readSummarySettings({ extension_settings: { memory: { source: 'main', position: '1', depth: '3', role: '2', promptInterval: '0' } } });
        expect(memory).toMatchObject({ source: 'main', position: 1, depth: 3, role: 2, promptInterval: 0 });
        expect(typeof memory.position).toBe('number');
    });

    test('the default prompt and template equal the legacy extension constants', () => {
        expect(legacySource).toContain(`const defaultPrompt = '${DEFAULT_SUMMARY_PROMPT}';`);
        expect(legacySource).toContain(`const defaultTemplate = '${DEFAULT_SUMMARY_TEMPLATE}';`);
    });

    test('the number ranges equal the legacy slider ranges, not the stale *Min / *Max values saved in old settings files', () => {
        const legacy = key => Number(new RegExp(`${key}: (\\d+),`).exec(legacySource)?.[1]);
        expect(SUMMARY_NUMBER_FIELDS.promptInterval).toMatchObject({ min: legacy('promptMinInterval'), max: legacy('promptMaxInterval') });
        expect(SUMMARY_NUMBER_FIELDS.promptWords).toMatchObject({ min: legacy('promptMinWords'), max: legacy('promptMaxWords') });
        expect(SUMMARY_NUMBER_FIELDS.promptForceWords).toMatchObject({ min: legacy('promptMinForceWords'), max: legacy('promptMaxForceWords') });
        expect(SUMMARY_NUMBER_FIELDS.overrideResponseLength).toMatchObject({ min: legacy('overrideResponseLengthMin'), max: legacy('overrideResponseLengthMax') });
        expect(SUMMARY_NUMBER_FIELDS.maxMessagesPerRequest).toMatchObject({ min: legacy('maxMessagesPerRequestMin'), max: legacy('maxMessagesPerRequestMax') });
        expect(SUMMARY_NUMBER_FIELDS.depth).toMatchObject({ min: 0, max: 9999 });
        expect(SUMMARY_SETTING_DEFAULTS.promptInterval).toBe(legacy('promptInterval'));
        expect(SUMMARY_SETTING_DEFAULTS.promptWords).toBe(legacy('promptWords'));
        expect(SUMMARY_SETTING_DEFAULTS.depth).toBe(legacy('depth'));
    });

    test('names the sources and spots a disabled extension', () => {
        expect(describeSummarySource('main')).toBe('主模型');
        expect(describeSummarySource('extras')).toContain('Extras');
        expect(describeSummarySource('mystery')).toContain('mystery');
        expect(isSummaryExtensionDisabled({ extension_settings: { disabledExtensions: ['memory'] } })).toBe(true);
        expect(isSummaryExtensionDisabled({ extension_settings: { disabledExtensions: ['translate'] } })).toBe(false);
        expect(isSummaryExtensionDisabled({})).toBe(false);
    });
});

describe('who may summarize', () => {
    const withMemory = (memory, extra = {}) => ({ extension_settings: { memory, ...extra } });

    test('the Extras source never summarizes automatically or manually, and both explain why', () => {
        const settings = withMemory({ source: 'extras', promptInterval: 10 });
        expect(getAutoSummaryGate(settings)).toMatchObject({ eligible: false, reason: 'source' });
        expect(getAutoSummaryGate(settings).message).toContain('Extras');
        expect(getManualSummaryGate(settings, 5)).toMatchObject({ ok: false, reason: 'source' });
        expect(getManualSummaryGate(settings, 5).message).toContain('切换为主模型');
    });

    test('a missing memory entry behaves like the Extras default', () => {
        expect(getAutoSummaryGate({}).eligible).toBe(false);
        expect(getManualSummaryGate({}, 5).ok).toBe(false);
    });

    test('the main and WebLLM sources run automatically unless paused or switched off', () => {
        expect(getAutoSummaryGate(withMemory({ source: 'main', promptInterval: 10 }))).toEqual({ eligible: true, reason: '', message: '' });
        expect(getAutoSummaryGate(withMemory({ source: 'webllm', promptInterval: 10 })).eligible).toBe(true);
        expect(getAutoSummaryGate(withMemory({ source: 'main', promptInterval: 10, memoryFrozen: true }))).toMatchObject({ eligible: false, reason: 'frozen' });
        expect(getAutoSummaryGate(withMemory({ source: 'main', promptInterval: 0 }))).toMatchObject({ eligible: false, reason: 'off' });
        expect(getAutoSummaryGate(withMemory({ source: 'mystery', promptInterval: 10 }))).toMatchObject({ eligible: false, reason: 'source' });
    });

    test('a disabled extension blocks both', () => {
        const settings = withMemory({ source: 'main', promptInterval: 10 }, { disabledExtensions: ['memory'] });
        expect(getAutoSummaryGate(settings)).toMatchObject({ eligible: false, reason: 'extension-disabled' });
        expect(getManualSummaryGate(settings, 5)).toMatchObject({ ok: false, reason: 'extension-disabled' });
    });

    test('manual summary ignores the pause and the interval, but needs messages', () => {
        const settings = withMemory({ source: 'main', promptInterval: 0, memoryFrozen: true });
        expect(getManualSummaryGate(settings, 3)).toEqual({ ok: true, reason: '', message: '' });
        expect(getManualSummaryGate(settings, 0)).toMatchObject({ ok: false, reason: 'empty' });
    });
});

describe('writing and clearing the summary on a message', () => {
    test('writes on the pre-last message when there is no summary yet, and on the only message of a one-message chat', () => {
        expect(resolveSummaryWriteIndex(chatOf(5))).toBe(3);
        expect(resolveSummaryWriteIndex(chatOf(2))).toBe(0);
        expect(resolveSummaryWriteIndex(chatOf(1))).toBe(0);
        expect(resolveSummaryWriteIndex([])).toBe(-1);
        expect(resolveSummaryWriteIndex(undefined)).toBe(-1);
    });

    test('overwrites the message that holds the latest summary instead of creating a second one', () => {
        const messages = chatOf(8, { 2: 'first', 5: 'second' });
        const index = resolveSummaryWriteIndex(messages);
        expect(index).toBe(5);
        setSummaryOnMessage(messages, index, 'edited');
        expect(messages.filter(message => message.extra?.memory)).toHaveLength(2);
        expect(messages[5].extra.memory).toBe('edited');
        expect(messages[2].extra.memory).toBe('first');
        expect(getLatestChatSummary(messages)).toEqual({ text: 'edited', index: 5 });
    });

    test('keeps the other extra fields when writing and clearing', () => {
        const messages = [msg('a'), { ...msg('b'), extra: { api: 'openai', memory: 'x' } }, msg('c')];
        setSummaryOnMessage(messages, 1, 'y');
        expect(messages[1].extra).toEqual({ api: 'openai', memory: 'y' });
        expect(clearSummaryOnMessage(messages, 1)).toBe(true);
        expect(messages[1].extra).toEqual({ api: 'openai' });
        expect(clearSummaryOnMessage(messages, 1)).toBe(false);
        expect(clearSummaryOnMessage(messages, 9)).toBe(false);
    });

    test('creates extra when the message has none, and refuses a message that no longer exists', () => {
        const messages = [{ name: 'N', mes: 'bare' }, msg('last')];
        setSummaryOnMessage(messages, 0, 'new');
        expect(messages[0].extra).toEqual({ memory: 'new' });
        expect(() => setSummaryOnMessage(messages, 7, 'x')).toThrow('已不存在');
    });

    test('clearing the latest summary lets an older one become the current summary again', () => {
        const messages = chatOf(8, { 2: 'older', 5: 'latest' });
        clearSummaryOnMessage(messages, getLatestChatSummary(messages).index);
        expect(getLatestChatSummary(messages)).toEqual({ text: 'older', index: 2 });
    });

    test('previews the holder so the user can find it', () => {
        expect(previewSummaryHolder({ name: 'Alice', mes: 'a   long\nmessage '.repeat(10) }, 20)).toBe('Alice：a long message a lon…');
        expect(previewSummaryHolder({ is_user: true, mes: 'hi' })).toBe('用户：hi');
        expect(previewSummaryHolder({ name: 'Bob', mes: '' })).toBe('Bob');
        expect(previewSummaryHolder(undefined)).toBe('');
    });
});

describe('summary settings draft', () => {
    const base = readSummarySettings({ extension_settings: { memory: { source: 'main', promptInterval: 10, depth: 2, role: 0, position: 0 } } });
    const draftOf = (changes = {}) => ({ ...toSummarySettingsDraft(base), ...changes });

    test('round-trips the settings through the draft', () => {
        const parsed = parseSummarySettingsDraft(draftOf(), base);
        expect(parsed).toMatchObject({ ok: true, errors: {} });
        expect(parsed.values).toEqual(base);
        expect(isSummaryDraftDirty(draftOf(), toSummarySettingsDraft(base))).toBe(false);
        expect(isSummaryDraftDirty(draftOf({ promptInterval: '11' }), toSummarySettingsDraft(base))).toBe(true);
    });

    test('rejects values outside the slider ranges and non-integers', () => {
        const parsed = parseSummarySettingsDraft(draftOf({
            promptInterval: '251',
            promptForceWords: '-1',
            promptWords: '24',
            overrideResponseLength: '4097',
            maxMessagesPerRequest: '1.5',
        }), base);
        expect(parsed.ok).toBe(false);
        expect(Object.keys(parsed.errors).sort()).toEqual(['maxMessagesPerRequest', 'overrideResponseLength', 'promptForceWords', 'promptInterval', 'promptWords']);
        expect(parsed.errors.promptInterval).toContain('0 到 250');
        expect(parsed.errors.promptWords).toContain('25 到 1000');
    });

    test('accepts the range limits', () => {
        const parsed = parseSummarySettingsDraft(draftOf({ promptInterval: '0', promptWords: '1000', promptForceWords: '10000', overrideResponseLength: '4096', maxMessagesPerRequest: '250' }), base);
        expect(parsed.ok).toBe(true);
        expect(parsed.values).toMatchObject({ promptInterval: 0, promptWords: 1000, promptForceWords: 10000, overrideResponseLength: 4096, maxMessagesPerRequest: 250 });
    });

    test('depth and role only matter for the in-chat position', () => {
        const outsideChat = parseSummarySettingsDraft(draftOf({ position: '2', depth: 'abc', role: 'x' }), base);
        expect(outsideChat.ok).toBe(true);
        expect(outsideChat.values).toMatchObject({ position: 2, depth: 2, role: 0 });

        const inChat = parseSummarySettingsDraft(draftOf({ position: '1', depth: '10000', role: '9' }), base);
        expect(Object.keys(inChat.errors).sort()).toEqual(['depth', 'role']);

        const valid = parseSummarySettingsDraft(draftOf({ position: '1', depth: '6', role: '2' }), base);
        expect(valid.values).toMatchObject({ position: 1, depth: 6, role: 2 });
        expect(parseSummarySettingsDraft(draftOf({ position: '-1' }), base).values.position).toBe(-1);
        expect(parseSummarySettingsDraft(draftOf({ position: '7' }), base).errors).toHaveProperty('position');
    });

    test('needs a prompt unless the source is Extras, and a template that carries {{summary}}', () => {
        expect(parseSummarySettingsDraft(draftOf({ prompt: '   ' }), base).errors).toHaveProperty('prompt');
        expect(parseSummarySettingsDraft(draftOf({ prompt: '', source: 'extras' }), base).errors).not.toHaveProperty('prompt');
        expect(parseSummarySettingsDraft(draftOf({ template: 'no macro here' }), base).errors).toHaveProperty('template');
        expect(parseSummarySettingsDraft(draftOf({ template: '' }), base).errors).not.toHaveProperty('template');
        expect(parseSummarySettingsDraft(draftOf({ template: '<s>{{ summary }}</s>' }), base).errors).not.toHaveProperty('template');
    });

    test('rejects an unknown source or prompt builder', () => {
        const parsed = parseSummarySettingsDraft(draftOf({ source: 'mystery', prompt_builder: '9' }), base);
        expect(Object.keys(parsed.errors).sort()).toEqual(['prompt_builder', 'source']);
    });

    test('the patch holds only the editable fields, with numbers and booleans typed', () => {
        const parsed = parseSummarySettingsDraft(draftOf({ memoryFrozen: '1', SkipWIAN: '1', scan: '1', prompt_builder: '2', promptInterval: '5' }), base);
        expect(buildSummarySettingsPatch(parsed.values)).toEqual({
            source: 'main',
            memoryFrozen: true,
            SkipWIAN: true,
            scan: true,
            prompt_builder: 2,
            prompt: base.prompt,
            template: base.template,
            promptWords: 200,
            overrideResponseLength: 0,
            maxMessagesPerRequest: 0,
            promptInterval: 5,
            promptForceWords: 0,
            position: 0,
            depth: 2,
            role: 0,
        });
    });
});

describe('describeSummaryOutcome', () => {
    test('reports a written summary with its message number', () => {
        expect(describeSummaryOutcome({ summary: 'text', index: 4, saved: true, reason: '' })).toEqual({ kind: 'success', text: '摘要已更新，写在第 5 条消息上。' });
    });

    test('reports a stop and the failure reasons', () => {
        expect(describeSummaryOutcome({ stopped: true })).toMatchObject({ kind: 'info' });
        expect(describeSummaryOutcome({ reason: 'stopped' })).toMatchObject({ kind: 'info' });
        expect(describeSummaryOutcome({ reason: 'save-failed', summary: 'x', index: 1 }).kind).toBe('warning');
        expect(describeSummaryOutcome({ reason: 'empty-summary' }).text).toContain('没有返回摘要内容');
        expect(describeSummaryOutcome({ reason: 'nothing' }).text).toContain('先清除当前摘要');
        expect(describeSummaryOutcome({ reason: 'no-prompt' }).kind).toBe('warning');
    });

    test('stays quiet for an automatic summary that was simply not due, but tells a manual one', () => {
        for (const reason of ['frozen', 'off', 'too-short', 'waiting', 'empty']) {
            expect(describeSummaryOutcome({ due: false, reason }, { mode: 'auto' })).toBeNull();
        }
        expect(describeSummaryOutcome({ due: false, reason: 'waiting' }, { mode: 'force' })).not.toBeNull();
        expect(describeSummaryOutcome({ reason: 'empty' }, { mode: 'force' }).text).toContain('还没有消息');
    });
});
