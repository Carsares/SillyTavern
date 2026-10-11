import { createHash } from 'node:crypto';
import { canonicalJson, invariant } from '../../../public/shared/conversation/schemas/index.js';

export const supportsAsyncJobs = capability => capability?.asyncJobs === true || ['horde-text', 'horde-image', 'comfy-image', 'bfl-image', 'fal-image'].includes(capability?.imageApi ?? capability?.api);
const validJobId = value => typeof value === 'string' && value.length <= 16384 && /^(?:[\w-]+|aux1\.[A-Za-z0-9_-]+)$/.test(value);

/** A durable intent exists before submission; an unknown submission is never retried. */
export function prepareProviderJob({ store, conversationId, turnId, memberRunId, recordId, connection, request, kind, jobId, onJob, traceId }) {
    invariant(jobId === undefined || validJobId(jobId), 'invalid-provider-job', 'Invalid provider job handle');
    let origin = turnId;
    const visited = new Set();
    while (origin) {
        invariant(!visited.has(origin), 'invalid-retry', 'Cyclic provider retry chain', 409);
        visited.add(origin);
        const turn = store.getTurn(origin);
        invariant(turn.conversationId === conversationId, 'invalid-retry', 'Provider turn belongs to another conversation', 409);
        if (!turn.request?.retryTurnId) break;
        origin = turn.request.retryTurnId;
    }
    const requestHash = createHash('sha256').update(canonicalJson(request)).digest('hex');
    const identity = { sourceRefs: [], origin: recordId ?? (kind === 'memory' ? `${origin ?? 'manual'}:${requestHash}` : origin ?? requestHash), memberRunId: memberRunId ?? null, kind };
    const candidates = store.listJobs(conversationId).filter(item => item.kind === 'provider-request' && canonicalJson(item.dependencies) === canonicalJson(identity));
    invariant(candidates.length <= 1, 'provider-job-conflict', 'Multiple provider jobs match this operation', 409);
    let job = candidates[0];
    if (job) {
        invariant(job.payload.connectionId === connection.id && job.payload.connectionRevision === connection.revision
            && job.payload.provider === connection.provider && job.payload.model === connection.model,
        'provider-job-conflict', 'Provider connection changed; cannot resubmit an existing operation', 409);
        invariant(job.payload.jobId, 'provider-job-unknown', 'Previous submission has no persisted job ID; do not resubmit', 409);
        invariant(!jobId || jobId === job.payload.jobId, 'provider-job-conflict', 'Provider job ID does not match the persisted operation', 409);
    } else {
        job = store.createJob({ conversationId, kind: 'provider-request', dependencies: identity,
            payload: { connectionId: connection.id, connectionRevision: connection.revision, provider: connection.provider,
                model: connection.model, requestHash, ...(traceId ? { traceId } : {}), ...(jobId ? { jobId } : {}), state: jobId ? 'resumed' : 'intent' } });
    }
    const patch = async (payload, status = 'running') => {
        job = await store.updateJob(job.id, { status, payload: { ...job.payload, ...payload } });
    };
    return {
        id: job.id,
        traceId: job.payload.traceId,
        jobId: job.payload.jobId,
        async onJob(value) {
            invariant(value.state !== 'submitting' || !job.payload.jobId, 'provider-job-conflict', 'An existing provider job cannot be submitted again', 409);
            if (value.jobId === null && ['submitting', 'unknown', 'failed'].includes(value.state)) {
                invariant(!job.payload.jobId, 'provider-job-conflict', 'An existing provider job cannot be submitted again', 409);
                await patch({ state: value.state, kind: value.kind }, value.state === 'submitting' ? 'running' : 'failed');
                await onJob?.({ ...value, provider: connection.provider, providerJobRecordId: job.id });
                return;
            }
            invariant(validJobId(value.jobId), 'invalid-provider-job', 'Invalid provider job handle');
            invariant(!job.payload.jobId || job.payload.jobId === value.jobId, 'provider-job-conflict', 'Provider job identity changed', 409);
            await patch({ jobId: value.jobId, state: value.state, kind: value.kind });
            await onJob?.({ ...value, provider: connection.provider, providerJobRecordId: job.id });
        },
        finish: result => patch({ state: 'completed', ...(result ? { result } : {}) }, 'completed'),
        fail: () => patch({ state: 'unknown' }, 'failed'),
    };
}
