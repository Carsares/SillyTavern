import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, validateTurnRequest, validateSourceRef, serializeError, ProtocolError } from '../../../../public/shared/conversation/schemas/index.js';

test('request canonicalization ignores object insertion order but preserves array order', () => {
    assert.equal(canonicalJson({ z: [1, 2], a: { x: 1, b: 2 } }), canonicalJson({ a: { b: 2, x: 1 }, z: [1, 2] }));
    assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

test('new protocol rejects legacy/versionless and malformed generation requests', () => {
    const request = { schemaVersion: 1, clientRequestId: 'one', expectedContentRevision: 0, type: 'send', content: 'hello' };
    assert.equal(validateTurnRequest(request), request);
    assert.throws(() => validateTurnRequest({ ...request, schemaVersion: 0 }), /Unsupported/);
    assert.throws(() => validateTurnRequest({ ...request, type: 'regenerate' }), /targetMessageId/);
    assert.throws(() => validateTurnRequest({ ...request, expectedContentRevision: -1 }), /nonnegative/);
});

test('source references include candidate version and public errors hide internals', () => {
    assert.throws(() => validateSourceRef({ messageId: 'm', revision: 1, candidateId: 'c' }), /candidateRevision/);
    assert.equal(serializeError(new Error('secret connection')).message.includes('secret'), false);
    assert.equal(serializeError(new ProtocolError('conflict', 'Stale revision', 409)).code, 'conflict');
});
