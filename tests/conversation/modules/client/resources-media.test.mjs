import test from 'node:test';
import assert from 'node:assert/strict';
import { resourceDefaults, newWorldEntry, newPromptBlock, historyModeDescription, EXECUTORS } from '../../../../public/modern/conversation/resources/model.js';
import { PRESET_DEFAULTS } from '../../../../public/shared/conversation/assembly/defaults.js';
import { WORLD_INFO_DEFAULTS } from '../../../../public/shared/conversation/world-info/index.js';
import { attachmentPart, assertMediaCapability, encodeBase64 } from '../../../../public/modern/conversation/media/model.js';
import { turnRequest, estimateRequest } from '../../../../public/modern/conversation/core/state.js';

test('editable defaults clone the compiler schema; no unused legacy prompt fields', () => {
    const preset = resourceDefaults('preset');
    assert.deepEqual(preset, PRESET_DEFAULTS);
    preset.blocks.push(newPromptBlock('note'));
    assert.equal(resourceDefaults('preset').blocks.length, 0);
    assert.equal(preset.systemPrompt, undefined);
    assert.deepEqual(resourceDefaults('worldbook'), WORLD_INFO_DEFAULTS);
    assert.deepEqual(resourceDefaults('character'), { description: '', personality: '', scenario: '' });
    assert.equal(newWorldEntry('lore').placement.type, 'prefix');
});
test('SDK choices default to native mode and describe the server-reported input mode', () => {
    assert.deepEqual(EXECUTORS.map(([id]) => id), ['pi', 'claude', 'codex']);
    assert.equal(resourceDefaults('connection').historyMode, 'native-transcript');
    assert.match(historyModeDescription({ historyMode: 'native-transcript' }), /原生角色消息/);
    assert.doesNotMatch(historyModeDescription({ historyMode: 'native-transcript' }), /结构化转录|JSON/);
    assert.equal(historyModeDescription({ historyMode: 'future-mode' }), '输入模式：future-mode');
    assert.match(historyModeDescription({ historyMode: 'structured-transcript' }), /不是无损原生 roles/);
    assert.match(historyModeDescription({}), /尚未/);
});
test('uploaded media stays an opaque attachment reference and is capability gated', () => {
    const part = attachmentPart({ id: 'a', name: 'pic', mime: 'image/png', size: 8 });
    assert.deepEqual(part, { type: 'image', attachmentId: 'a', mimeType: 'image/png', name: 'pic', size: 8 });
    assert.throws(() => assertMediaCapability({ supported: true, media: ['text'] }, [part]), /不支持/);
    assert.throws(() => assertMediaCapability({ supported: false, media: ['image'] }, [part]));
    assert.doesNotThrow(() => assertMediaCapability({ supported: true, media: ['text', 'image'] }, [part]));
    const request = turnRequest({ conversation: { contentRevision: 1 } }, 'group', 'look', undefined, 'r', { media: [part], members: ['character'] });
    part.name = 'changed';
    assert.equal(request.media[0].name, 'pic');
    assert.deepEqual(request.members, ['character']);
});
test('base64 encoding roundtrips binary attachments across chunk boundary', () => {
    const bytes = Uint8Array.from({ length: 40000 }, (_, i) => i % 256);
    assert.deepEqual(new Uint8Array(Buffer.from(encodeBase64(bytes), 'base64')), bytes);
});

test('PDF and plain text use document references for send and estimate with capability checks', () => {
    for (const mime of ['application/pdf', 'text/plain']) {
        const part = attachmentPart({ id: 'doc', name: 'document', mime, size: 8 });
        assert.equal(part.type, 'document');
        assert.equal(part.mimeType, mime);
        assert.doesNotThrow(() => assertMediaCapability({ supported: true, media: ['document'] }, [part]));
        assert.throws(() => assertMediaCapability({ supported: true, media: ['image'] }, [part]), /不支持 document/);
        const request = turnRequest({ conversation: { contentRevision: 1 } }, 'send', 'read', undefined, 'r', { media: [part] });
        assert.deepEqual(request.media, [part]);
        assert.deepEqual(estimateRequest('read', [part]).media, request.media);
        assert.equal(part.data, undefined);
    }
});

test('other attachments stay files regardless of document-like names or MIME families', () => {
    for (const mime of ['text/html', 'text/markdown', 'application/json', 'application/octet-stream', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain; charset=utf-8', 'application/pdf-malformed']) {
        const part = attachmentPart({ id: 'file', name: 'pretend.pdf', mime, size: 8 });
        assert.equal(part.type, 'file');
        assert.equal(part.mimeType, mime);
        assert.throws(() => assertMediaCapability({ supported: true, media: ['document'] }, [part]), /不支持 file/);
    }
});

test('input-mode labels respect supported native default chat and explicit capability modes', () => {
    for (const executor of ['pi', 'native']) {
        assert.equal(historyModeDescription({ supported: true, executor, provider: 'openai' }), '输入模式：原生聊天消息。');
    }
    assert.equal(historyModeDescription({ supported: true, type: 'chat' }), '输入模式：原生聊天消息。');
    assert.match(historyModeDescription({ supported: true, type: 'text' }), /文本补全/);
    assert.match(historyModeDescription({ supported: false, executor: 'pi' }), /尚未/);
    assert.match(historyModeDescription({ supported: true, executor: 'codex' }), /尚未/);
    assert.match(historyModeDescription({ supported: true, executor: 'pi', historyMode: 'structured-transcript' }), /结构化转录/);
    assert.match(historyModeDescription({ supported: true, executor: 'pi', type: 'image' }), /尚未/);
});

test('connection examples match flat reasoning and nested media budget contracts', async () => {
    const { CONNECTION_GUIDANCE } = await import('../../../../public/modern/conversation/resources/guidance.js');
    const { validateConnectionFields } = await import('../../../../public/modern/conversation/resources/model.js');
    const { connectionShapeError } = await import('../../../../src/conversation/capabilities/core/index.js');
    for (const value of [resourceDefaults('connection'), CONNECTION_GUIDANCE, { provider: 'google', reasoning: 'budget', reasoningBudget: 1024, capabilities: { mediaTokenCost: { video: 4096 } } }]) {
        assert.equal(validateConnectionFields(value), value);
        assert.equal(connectionShapeError(value), undefined);
    }
    assert.equal(CONNECTION_GUIDANCE.reasoning, 'high');
    assert.deepEqual(CONNECTION_GUIDANCE.capabilities.mediaTokenCost, { image: 1024 });
    for (const value of [{ data: { provider: 'openai' } }, { effort: 'high' }, { reasoning: { effort: 'high' } }, { mediaTokenCost: { image: 1024 } }]) {
        assert.throws(() => validateConnectionFields(value));
        assert.equal(typeof connectionShapeError(value), 'string');
    }
});
