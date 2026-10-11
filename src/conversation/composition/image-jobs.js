import { invariant } from '../../../public/shared/conversation/schemas/index.js';

/** Explicit recovery queries only an already persisted provider handle. */
export function createImageJobService({ store, connectionFor, createAdapter, registerMedia, accountingFor }) {
    const active = new Map();
    let closed = false;
    function inspect(conversationId, id) {
        const snapshot = store.getConversation(conversationId);
        invariant(!snapshot.conversation.activeTurnId, 'conversation-busy', 'Stop generation before managing an image job', 409);
        const job = store.listJobs(conversationId).find(item => item.id === id);
        invariant(job?.kind === 'provider-request' && job.dependencies.kind === 'image', 'invalid-provider-job', 'An image job in this conversation is required', 404);
        const record = store.getTool(job.dependencies.origin);
        invariant(record.conversationId === conversationId && record.name === 'generate_image', 'invalid-provider-job', 'Image job has no matching tool record', 409);
        invariant(job.payload.jobId, 'provider-job-unknown', 'No provider handle was saved; this operation cannot be resubmitted', 409);
        return { job, record };
    }
    function recover(record, result) {
        if (record.status === 'completed') return;
        store.recoverTool(record.id, { status: 'completed', result, usage: result.usage ?? null });
    }
    async function operate(conversationId, id, cancel) {
        invariant(!closed, 'service-closed', 'Image job service is closed', 503);
        invariant(!active.has(id), 'provider-job-busy', 'This image job is already being queried', 409);
        const { job, record } = inspect(conversationId, id);
        if (job.payload.result) {
            recover(record, job.payload.result);
            return store.listJobs(conversationId).find(item => item.id === id);
        }
        if (cancel && job.payload.state === 'cancel-requested') return job;
        const connection = connectionFor(job.payload.connectionId, job.payload.connectionRevision);
        invariant(connection.provider === job.payload.provider && connection.model === job.payload.model, 'provider-job-conflict', 'Frozen provider connection does not match', 409);
        const controller = new AbortController();
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]);
        let current = job;
        const patch = payload => { current = store.updateJob(id, { payload: { ...current.payload, ...payload } }); };
        const onJob = async value => {
            invariant(value.jobId === job.payload.jobId && value.state !== 'submitting', 'provider-job-conflict', 'Recovery cannot submit a new image job', 409);
            patch({ state: value.state });
        };
        const accounting = accountingFor(connection, { conversationId, turnId: record.turnId }, id, cancel);
        const promise = Promise.resolve().then(async () => {
            try {
                const adapter = createAdapter(connection, accounting.onRequest);
                if (cancel) {
                    await adapter.cancelJob(job.payload.jobId, { signal, onJob });
                    patch({ state: 'cancel-requested' });
                } else {
                    const output = await adapter.generateImage({ prompt: record.args.prompt, jobId: job.payload.jobId, signal, onJob });
                    accounting.finish(output.usage);
                    const media = await registerMedia(output.images ?? [], signal);
                    const result = { images: media, media, usage: output.usage ?? null };
                    current = store.updateJob(id, { status: 'completed', payload: { ...current.payload, state: 'completed', result } });
                    recover(record, result);
                }
                return current;
            } catch (error) {
                if (!current.payload.result) {
                    accounting.fail();
                    patch({ state: 'unknown', lastError: { code: error.code ?? 'provider-job-failed' } });
                }
                throw error;
            } finally { active.delete(id); }
        });
        active.set(id, { controller, promise });
        return promise;
    }
    return {
        busy: () => active.size > 0,
        resume: (cid, id) => operate(cid, id, false),
        cancel: (cid, id) => operate(cid, id, true),
        async close() {
            closed = true;
            const pending = [...active.values()];
            for (const entry of pending) entry.controller.abort();
            await Promise.allSettled(pending.map(entry => entry.promise));
        },
    };
}
