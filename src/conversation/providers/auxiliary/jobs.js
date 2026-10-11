import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fail } from '../core/index.js';
import { integer } from './common.js';

const stable = v => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const hash = body => createHash('sha256').update(JSON.stringify(stable(body))).digest('hex');
// A string handle contains only routing IDs, never credentials, prompts or workflows.
export function encodeJob(job) { return `aux1.${Buffer.from(JSON.stringify(job)).toString('base64url')}`; }
export function decodeJob(jobId, c, api, baseUrl) {
    let job;
    try { if (typeof jobId !== 'string' || jobId.length > 16384 || !jobId.startsWith('aux1.')) throw 0; job = JSON.parse(Buffer.from(jobId.slice(5), 'base64url').toString()); } catch { throw fail('invalid-job', 'Invalid auxiliary job handle'); }
    if (job.api !== api || job.model !== c.model || job.baseUrl !== baseUrl || typeof job.remoteId !== 'string' || !/^[\w-]+$/.test(job.remoteId)) throw fail('invalid-job', 'Job belongs to a different connection/model');
    for (const value of Object.values(job.paths ?? {})) relativeJobUrl(value, baseUrl, api === 'bfl-image');
    return job;
}
export function relativeJobUrl(value, baseUrl, bfl = false) {
    const base = new URL(`${baseUrl.replace(/\/$/, '')}/`);
    const url = new URL(value, base);
    for (const key of url.searchParams.keys()) if (!['id', 'logs'].includes(key)) throw fail('invalid-job-url', 'Unsupported queue URL query; do not persist bearer credentials in job IDs');
    const bflHost = host => /^api(?:\.[a-z0-9-]+)?\.bfl\.ai$/.test(host);
    if (bfl && base.protocol === 'https:' && bflHost(base.hostname) && url.protocol === 'https:' && bflHost(url.hostname) && !url.port && !url.username && !url.password && !url.hash && url.pathname === '/v1/get_result') return url.href;
    if (url.origin !== base.origin || url.username || url.password || url.hash || !url.pathname.startsWith(base.pathname)) throw fail('invalid-job-url', 'Queue URL must stay under the configured provider endpoint');
    return url.pathname.slice(base.pathname.length) + url.search;
}
export async function runJob({ c, api, baseUrl, body, input, submit, poll, onJob: defaultOnJob }) {
    const { signal } = input;
    const onJob = input.onJob ?? defaultOnJob;
    if (onJob !== undefined && typeof onJob !== 'function') throw fail('invalid-input', 'onJob must be a persistence callback');
    const maxPolls = integer(c.maxPolls ?? 60, 'maxPolls', 1, 600);
    const interval = integer(c.pollIntervalMs ?? 1000, 'pollIntervalMs', 0, 10000);
    let job, jobId = input.jobId;
    let attempted = false;
    const notify = state => onJob?.({ jobId: jobId ?? null, remoteId: job?.remoteId ?? null, state, kind: 'image', provider: c.provider, model: c.model, resubmit: false });
    try {
        signal?.throwIfAborted();
        if (jobId !== undefined) {
            job = decodeJob(jobId, c, api, baseUrl);
            if (job.requestHash !== hash(body)) throw fail('invalid-job', 'Resume input differs from the frozen submission');
            await notify('resumed');
        } else {
            await notify('submitting');
            signal?.throwIfAborted(); attempted = true;
            const submitted = await submit();
            job = { api, model: c.model, baseUrl, requestHash: hash(body), ...submitted };
            if (typeof job.remoteId !== 'string' || !/^[\w-]+$/.test(job.remoteId)) throw fail('provider-response-invalid', 'Missing or invalid queue ID');
            jobId = encodeJob(job);
            await notify('submitted'); // Must persist before the first poll.
        }
        for (let attempt = 0; attempt < maxPolls; attempt++) {
            signal?.throwIfAborted();
            if (interval) await delay(interval, undefined, { signal });
            const result = await poll(job);
            if (result !== null) { await notify('completed'); signal?.throwIfAborted(); return { ...result, jobId }; }
        }
        const error = fail('provider-poll-limit', 'Remote job remains pending; resume instead of submitting again'); error.details = { outcome: 'pending' }; throw error;
    } catch (error) {
        const failure = error instanceof Error ? error : fail('provider-job-interrupted', 'Job interrupted');
        const outcome = failure.details?.outcome ?? (failure.code === 'provider-job-failed' ? 'failed' : 'unknown');
        failure.details = { ...failure.details, jobId: jobId ?? null, remoteId: job?.remoteId ?? null, outcome, resubmit: false, submissionAttempted: attempted };
        try { await notify(outcome); } catch { /* Original error and handle remain available to caller. */ }
        throw failure;
    }
}
