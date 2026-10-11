import { canonicalJson, sourceRef, ProtocolError } from '../../../../public/shared/conversation/schemas/index.js';
const clone = structuredClone;
export function fakeStore({ completed = 5, active = false, settings = {} } = {}) {
    const turns = new Map();
    const snapshot = { id: 'snapshot', conversationId: 'c', conversation: { id: 'c', contentRevision: 1, memoryRevision: 0, activeTurnId: active ? 'active' : null }, messages: [], resources: [{ id: 'connection', kind: 'connection', revision: 1, data: { contextWindow: 65536, inputLimit: 65536, maxOutputTokens: 4096, workingBudget: 32768 } }], summaries: [], memories: [], folds: [], settings: { connectionId: 'connection', ...settings } };
    for (let i = 1; i <= completed; i++) {
        turns.set(`t${i}`, { id: `t${i}`, conversationId: 'c', type: 'send', status: 'completed', attemptEpoch: 1 });
        snapshot.messages.push({ id: `m${i}`, turnId: `t${i}`, role: 'assistant', content: `dragon event ${i}`, status: 'completed', revision: 1, candidateId: `a${i}`, candidateRevision: 1 });
    }
    if (active) turns.set('active', { id: 'active', conversationId: 'c', type: 'send', status: 'generating', attemptEpoch: 1 });
    const jobs = new Map(), tools = new Map(), commits = [];
    let next = 0;
    return { snapshot, turns, jobs, tools, commits,
        getConversation: () => clone(snapshot), getTurn: id => clone(turns.get(id)),
        commitDerived(cid, proposal) {
            if (snapshot.conversation.activeTurnId && proposal.turnId !== snapshot.conversation.activeTurnId) throw new ProtocolError('conversation-busy', 'busy');
            if (proposal.turnId && (turns.get(proposal.turnId)?.cancelRequested || turns.get(proposal.turnId)?.attemptEpoch !== proposal.attemptEpoch)) throw new ProtocolError('late-callback', 'late');
            if (proposal.expectedMemoryRevision !== snapshot.conversation.memoryRevision) throw new ProtocolError('revision-conflict', 'changed');
            if (!proposal.sourceRefs.every(ref => snapshot.messages.some(m => !m.deletedAt && canonicalJson(sourceRef(m)) === canonicalJson(ref)))) throw new ProtocolError('dependency-conflict', 'changed');
            for (const block of [...(proposal.summaries ?? []), ...(proposal.memories ?? []), ...(proposal.folds ?? [])]) {
                if (!(block.resourceRefs ?? []).every(ref => snapshot.resources.some(r => r.id === ref.id && r.revision === ref.revision))) throw new ProtocolError('source-conflict', 'resource changed');
            }
            for (const memory of proposal.memories ?? []) {
                const old = snapshot.memories.find(m => m.id === memory.id);
                if (old?.locked || old?.origin === 'manual') throw new ProtocolError('memory-locked', 'locked');
            }
            commits.push(clone(proposal));
            for (const kind of ['summaries', 'memories', 'folds']) snapshot[kind].push(...clone(proposal[kind] ?? []));
            snapshot.conversation.memoryRevision++;
            return { accepted: true, memoryRevision: snapshot.conversation.memoryRevision };
        },
        createJob(input) {
            const fingerprint = canonicalJson(input.dependencies);
            const old = [...jobs.values()].find(j => j.fingerprint === fingerprint);
            if (old) return clone(old);
            const job = { ...clone(input), id: `job${++next}`, status: 'pending', attempts: 0, fingerprint }; jobs.set(job.id, job); return clone(job);
        },
        commitDerivedJob(jobId) {
            const job = jobs.get(jobId);
            if (job.status === 'completed') return { accepted: true, replayed: true };
            if (job.status !== 'ready') throw new ProtocolError('invalid-job-state', 'not ready');
            if (snapshot.conversation.activeTurnId) throw new ProtocolError('conversation-busy', 'busy');
            const proposal = job.result.proposal;
            if (!job.dependencies.sourceRefs.every(ref => snapshot.messages.some(m => canonicalJson(sourceRef(m)) === canonicalJson(ref)))
                || !job.dependencies.resourceRefs.every(ref => snapshot.resources.some(r => r.id === ref.id && r.revision === ref.revision))) throw new ProtocolError('source-conflict', 'job dependencies changed');
            if (['summaries', 'memories', 'folds'].some(k => proposal[k]?.length)) this.commitDerived(job.conversationId, proposal);
            job.status = 'completed';
            return { accepted: true };
        },
        listJobs: () => clone([...jobs.values()]),
        updateJob(id, patch) { for (const k of ['status', 'attempts', 'result', 'error', 'dependencies']) if (patch[k] !== undefined) jobs.get(id)[k] = clone(patch[k]); if (patch.dependencies) jobs.get(id).fingerprint = canonicalJson(patch.dependencies); return clone(jobs.get(id)); },
        recordTool(input) {
            const old = [...tools.values()].find(r => r.turnId === input.turnId && r.memberRunId === input.memberRunId && r.toolCallId === input.toolCallId);
            if (old) { if (old.requestHash !== input.requestHash) throw new ProtocolError('idempotency-conflict', 'changed'); return { record: clone(old), replayed: true }; }
            const record = { ...clone(input), id: `tool${++next}`, status: 'intent' }; tools.set(record.id, record); return { record: clone(record), replayed: false };
        },
        finishTool(id, result) { Object.assign(tools.get(id), clone(result)); return clone(tools.get(id)); },
        getTool: id => clone(tools.get(id)),
    };
}
