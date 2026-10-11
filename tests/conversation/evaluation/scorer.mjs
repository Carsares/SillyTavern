import { refKey } from './dataset.mjs';
const normalize = value => typeof value === 'string' ? value.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/gu, ' ') : value;
const ratio = (n, d) => d ? n / d : null;

/** Exact fact/evidence scorer. No model-as-judge, paid call, or substring credit. */
export function scoreAnswers(questions, output) {
    let parsed = output;
    try { if (typeof parsed === 'string') parsed = JSON.parse(parsed); } catch { parsed = null; }
    const validEnvelope = parsed && Array.isArray(parsed.answers);
    const answers = validEnvelope ? parsed.answers : [];
    const ids = new Set(questions.map(q => q.id));
    const byId = new Map(), duplicates = new Set();
    let invalidAnswers = 0;
    for (const answer of answers) {
        if (!answer || typeof answer.id !== 'string' || !ids.has(answer.id)) { invalidAnswers++; continue; }
        if (byId.has(answer.id)) duplicates.add(answer.id);
        byId.set(answer.id, answer);
    }
    const forbidden = new Set(questions.flatMap(q => q.forbiddenAnswers).map(normalize));
    const forbiddenRefs = new Set(questions.flatMap(q => q.forbiddenSourceRefs).map(refKey));
    const known = new Set(questions.flatMap(q => [q.expected, ...q.aliases, ...q.forbiddenAnswers]).filter(v => v !== null).map(normalize));
    const details = questions.map(q => {
        const answer = byId.get(q.id);
        const present = Boolean(answer);
        const wellFormed = present && !duplicates.has(q.id) && (answer.answer === null || typeof answer.answer === 'string') && Array.isArray(answer.sourceRefs)
            && answer.sourceRefs.every(ref => ref && typeof ref.messageId === 'string' && Number.isSafeInteger(ref.revision));
        const value = wellFormed ? normalize(answer.answer) : undefined;
        const valueCorrect = wellFormed && [q.expected, ...q.aliases].map(normalize).includes(value);
        const actualRefs = new Set(wellFormed ? answer.sourceRefs.map(refKey) : []);
        const expectedRefs = new Set(q.sourceRefs.map(refKey));
        const sourcesCorrect = wellFormed && actualRefs.size === expectedRefs.size && [...expectedRefs].every(ref => actualRefs.has(ref));
        const staleLeak = Boolean(wellFormed && (forbidden.has(value) || [...actualRefs].some(ref => forbiddenRefs.has(ref)) || (q.category === 'deletion' && value !== null)));
        const invented = Boolean(wellFormed && value !== null && !known.has(value));
        return { id: q.id, category: q.category, present, wellFormed: Boolean(wellFormed), correct: Boolean(valueCorrect && sourcesCorrect),
            valueCorrect: Boolean(valueCorrect), sourcesCorrect: Boolean(sourcesCorrect), staleLeak, invented };
    });
    const correct = details.filter(d => d.correct).length, present = details.filter(d => d.present).length;
    const staleLeaks = details.filter(d => d.staleLeak).length, invented = details.filter(d => d.invented).length;
    const answerable = questions.filter(q => q.expected !== null).length;
    const guardCases = details.filter(d => ['deletion', 'candidate-switch'].includes(d.category));
    const complete = Boolean(validEnvelope && present === questions.length && !duplicates.size && invalidAnswers === 0 && details.every(d => d.wellFormed));
    return { complete, total: questions.length, present, correct, invalidAnswers, duplicateIds: [...duplicates],
        accuracy: ratio(correct, questions.length), coverage: ratio(present, questions.length), staleLeaks,
        staleLeakRate: ratio(staleLeaks, questions.length), inventedAnswers: invented, inventedRate: ratio(invented, questions.length), answerable,
        gate: complete && correct / questions.length >= 0.9 && invented / questions.length <= 0.02 && staleLeaks === 0 && guardCases.every(d => d.correct) ? 'passed' : 'failed',
        byCategory: Object.fromEntries([...new Set(details.map(d => d.category))].map(category => {
            const rows = details.filter(d => d.category === category);
            return [category, { total: rows.length, correct: rows.filter(d => d.correct).length, staleLeaks: rows.filter(d => d.staleLeak).length }];
        })), details };
}

export function summarizeMeasurements(rows) {
    const completed = rows.filter(r => r.status === 'completed');
    const percentile = (values, p) => values.length ? values.sort((a, b) => a - b)[Math.ceil(p * values.length) - 1] : null;
    const times = completed.map(r => r.elapsedMs).filter(Number.isFinite);
    const first = completed.map(r => r.firstTokenMs).filter(Number.isFinite);
    const costs = completed.map(r => r.usage?.costUsd);
    const uppers = completed.map(r => r.usage?.costUpperBoundUsd);
    return { completed: completed.length, total: rows.length, medianMs: percentile([...times], 0.5), p95Ms: percentile([...times], 0.95),
        firstTokenMedianMs: percentile([...first], 0.5), firstTokenP95Ms: percentile([...first], 0.95),
        costUsd: completed.length && costs.every(c => Number.isFinite(c) && c >= 0) ? costs.reduce((a, b) => a + b, 0) : null,
        costUpperBoundUsd: completed.length && uppers.every(c => Number.isFinite(c) && c >= 0) ? uppers.reduce((a, b) => a + b, 0) : null,
        costComplete: completed.length > 0 && costs.every(c => Number.isFinite(c) && c >= 0) };
}
