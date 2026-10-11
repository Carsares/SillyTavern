import test from 'node:test';
import assert from 'node:assert/strict';
import { resourceDefaults, newWorldEntry, newPromptBlock, historyModeDescription, EXECUTORS } from '../../../../public/modern/conversation/resources/model.js';
import { PRESET_DEFAULTS } from '../../../../public/shared/conversation/assembly/defaults.js';
import { WORLD_INFO_DEFAULTS } from '../../../../public/shared/conversation/world-info/index.js';
import { attachmentPart, assertMediaCapability, encodeBase64 } from '../../../../public/modern/conversation/media/model.js';
import { turnRequest } from '../../../../public/modern/conversation/core/state.js';

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
