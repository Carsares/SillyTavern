import { createHash } from 'node:crypto';

export const CATEGORIES = ['early-event', 'relationship', 'correction', 'item-location', 'timeline', 'user-preference', 'locked-memory', 'deletion', 'candidate-switch', 'unsupported'];
export const refOf = message => ({ messageId: message.id, revision: message.revision, candidateId: message.candidateId ?? null, candidateRevision: message.candidateRevision ?? null });
export const refKey = ref => JSON.stringify([ref.messageId, ref.revision, ref.candidateId ?? null, ref.candidateRevision ?? null]);

/** Reproducible synthetic corpus, not user data and not measured model output. */
export function createDataset({ size = 1600 } = {}) {
    if (!Number.isSafeInteger(size) || size < 1500 || size > 10000) throw new Error('Dataset size must be 1500..10000');
    const messages = [], archivedMessages = [], memories = [], questions = [], mutations = [];
    const locations = ['琥珀港', '银杉谷', '青石塔', '暮雪城', '白鹿原', '晴川驿', '星沙岛'];
    for (let i = 0; i < size; i++) {
        const key = String(i + 1).padStart(4, '0'), category = CATEGORIES[i % CATEGORIES.length];
        const entity = `旅人${key}`, value = `${locations[(i * 13 + 5) % locations.length]}-${key}`, obsolete = `旧地-${key}`;
        const prompts = {
            'early-event': `${entity}最初到达的地点是哪一个？`, relationship: `${entity}与同伴缔结盟约的地点是哪一个？`,
            correction: `${entity}纠正后确认的出生地是哪一个？`, 'item-location': `${entity}的信物目前存放在哪里？`,
            timeline: `${entity}完成第${i + 1}次任务后到达哪里？`, 'user-preference': `${entity}明确表示最喜欢哪里？`,
            'locked-memory': `${entity}人工锁定的故乡设定是什么？`, deletion: `${entity}已删除的行踪目前能确认吗？`,
            'candidate-switch': `${entity}当前选中剧情中的目的地是什么？`, unsupported: `${entity}未记载的避难所是什么？`,
        };
        const facts = {
            'early-event': `${entity}最初到达的地点是${value}。`, relationship: `${entity}与同伴在${value}缔结盟约。`,
            correction: `${entity}纠正记录：出生地确定为${value}。`, 'item-location': `${entity}的信物目前存放在${value}。`,
            timeline: `${entity}完成第${i + 1}次任务后到达${value}。`, 'user-preference': `${entity}明确表示最喜欢${value}。`,
            'locked-memory': `${entity}的人工锁定故乡设定是${value}。`, deletion: `${entity}的行踪是${obsolete}。`,
            'candidate-switch': `${entity}当前选中剧情的目的地是${value}。`, unsupported: `${entity}的避难所尚未记载。`,
        };
        const fact = { id: `fact-${key}`, conversationId: 'evaluation', turnId: `turn-${key}`, role: 'user', content: facts[category],
            revision: category === 'correction' ? 2 : 1, candidateId: category === 'candidate-switch' ? `selected-${key}` : null,
            candidateRevision: category === 'candidate-switch' ? 1 : null, status: 'completed', media: [] };
        if (category === 'candidate-switch') fact.role = 'assistant';
        const forbiddenAnswers = [], forbiddenSourceRefs = [];
        if (['correction', 'deletion', 'candidate-switch'].includes(category)) {
            const old = { ...fact, content: `${entity}的旧记录：${obsolete}。`, revision: 1,
                candidateId: category === 'candidate-switch' ? `unselected-${key}` : null,
                candidateRevision: category === 'candidate-switch' ? 1 : null };
            if (category === 'deletion') old.deletedAt = '2026-01-01T00:00:00.000Z';
            archivedMessages.push(old); forbiddenAnswers.push(obsolete); forbiddenSourceRefs.push(refOf(old));
            mutations.push({ type: category === 'deletion' ? 'message.delete' : category === 'correction' ? 'message.edit' : 'candidate.select', messageId: fact.id, before: refOf(old), after: category === 'deletion' ? null : refOf(fact) });
        }
        if (category !== 'deletion') messages.push(fact);
        // Distractors are independent of answers and provide a complete selected assistant reply.
        messages.push({ id: `reply-${key}`, conversationId: 'evaluation', turnId: fact.turnId, role: 'assistant',
            content: `${entity}所在的故事继续。当天的天气平静，路人没有提供其他可确认的新事实。`, revision: 1,
            candidateId: `reply-candidate-${key}`, candidateRevision: 1, status: 'completed', media: [] });
        if (category === 'locked-memory') memories.push({ id: `locked-${key}`, revision: 1, kind: 'character', content: fact.content,
            origin: 'manual', locked: true, status: 'valid', sourceRefs: [refOf(fact)] });
        const unanswerable = ['deletion', 'unsupported'].includes(category);
        questions.push({ id: `q-${key}`, category, prompt: prompts[category], expected: unanswerable ? null : value,
            aliases: [], sourceRefs: unanswerable ? [] : [refOf(fact)], forbiddenAnswers, forbiddenSourceRefs,
            position: i < size / 3 ? 'early' : i < 2 * size / 3 ? 'middle' : 'late' });
    }
    const dataset = { schemaVersion: 1, id: `synthetic-memory-v1-${size}`, synthetic: true,
        snapshot: { id: 'evaluation-snapshot', conversationId: 'evaluation', conversation: { id: 'evaluation', contentRevision: mutations.length + 1, memoryRevision: memories.length, activeTurnId: null },
            messages, memories, summaries: [], folds: [], resources: [], settings: {} },
        archivedMessages, mutations, questions };
    dataset.fingerprint = createHash('sha256').update(JSON.stringify(dataset)).digest('hex');
    return dataset;
}

export function validateDataset(dataset) {
    const errors = [];
    const { fingerprint, ...body } = dataset;
    if (createHash('sha256').update(JSON.stringify(body)).digest('hex') !== fingerprint) errors.push('fingerprint-mismatch');
    if (dataset.synthetic !== true || dataset.questions.length < 1500 || dataset.snapshot.messages.length < 1500) errors.push('minimum-size-or-origin');
    const messages = dataset.snapshot.messages, refs = new Map(messages.map(m => [refKey(refOf(m)), m]));
    if (new Set(messages.map(m => m.id)).size !== messages.length) errors.push('duplicate-message-id');
    if (new Set(dataset.questions.map(q => q.id)).size !== dataset.questions.length) errors.push('duplicate-question-id');
    for (const q of dataset.questions) {
        if (!CATEGORIES.includes(q.category) || !q.prompt || !['early', 'middle', 'late'].includes(q.position)) errors.push(`invalid-question:${q.id}`);
        if (q.expected !== null && (!q.sourceRefs.length || !q.sourceRefs.every(ref => refs.get(refKey(ref))?.content.includes(q.expected)))) errors.push(`unsupported-answer:${q.id}`);
        if (q.expected === null && q.sourceRefs.length) errors.push(`null-has-evidence:${q.id}`);
        if (q.forbiddenSourceRefs.some(ref => refs.has(refKey(ref)))) errors.push(`stale-source-visible:${q.id}`);
        if (q.forbiddenAnswers.some(value => messages.some(m => m.content.includes(value)))) errors.push(`stale-answer-visible:${q.id}`);
    }
    for (const category of CATEGORIES) if (!dataset.questions.some(q => q.category === category)) errors.push(`missing-category:${category}`);
    return { status: errors.length ? 'failed' : 'passed', questions: dataset.questions.length, messages: messages.length, errors };
}

/** Only this projection is passed to providers; answer keys and archived content stay local. */
export function publicInput(dataset, questions = dataset.questions) {
    return { snapshot: structuredClone(dataset.snapshot), questions: questions.map(({ id, prompt }) => ({ id, prompt })),
        responseFormat: 'Return only JSON: {"answers":[{"id":"question id","answer":"exact fact value or null if unknown","sourceRefs":[{"messageId":"...","revision":1,"candidateId":null,"candidateRevision":null}]}]}. Use JSON null, not the string "null". Never cite deleted or unselected revisions.' };
}
