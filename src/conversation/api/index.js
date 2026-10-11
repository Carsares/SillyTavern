import express from 'express';
import { SCHEMA_VERSION, RESOURCE_KINDS, requireObject, requireString, requireRevision, invariant, serializeError } from '../../../public/shared/conversation/schemas/index.js';
import { summarizeUsage } from '../traces/usage.js';

const wrap = handler => (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next);
const publicTurn = turn => ({ ...turn, payloadHash: undefined, request: turn.request ? { ...turn.request, apiKey: undefined } : undefined });

export function createRouter({ store, runtime, capabilities, maintenance, resources, attachments }) {
    const router = express.Router();
    router.use(express.json({ limit: '20mb' }));
    router.use((req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
            try {
                requireObject(req.body);
                invariant(req.body.schemaVersion === SCHEMA_VERSION, 'schema-version', 'Unsupported protocol version', 409);
            } catch (error) { return next(error); }
        }
        next();
    });
    router.get('/resources', wrap((req, res) => res.json(store.listResources(req.query.kind))));
    router.post('/resources', wrap((req, res) => {
        requireString(req.body.name, 'name', 256);
        invariant(RESOURCE_KINDS.includes(req.body.kind), 'invalid-resource', 'Unknown resource kind');
        requireObject(req.body.data, 'data');
        res.status(201).json((resources ?? store).createResource({ kind: req.body.kind, name: req.body.name, data: req.body.data }));
    }));
    router.get('/resources/:id', wrap((req, res) => res.json(store.getResource(req.params.id))));
    router.patch('/resources/:id', wrap((req, res) => {
        requireRevision(req.body.expectedRevision, 'expectedRevision');
        res.json((resources ?? store).updateResource(req.params.id, req.body));
    }));
    router.delete('/resources/:id', wrap((req, res) => res.json(store.deleteResource(req.params.id, requireRevision(req.body.expectedRevision, 'expectedRevision')))));
    router.get('/conversations', wrap((req, res) => res.json(store.listConversations())));
    router.post('/conversations', wrap((req, res) => res.status(201).json(store.createConversation({ title: req.body.title ?? '新对话', settings: req.body.settings ?? {}, resourceRefs: req.body.resourceRefs ?? [] }))));
    router.get('/conversations/:id', wrap((req, res) => res.json(store.getConversation(req.params.id))));
    router.delete('/conversations/:id', wrap((req, res) => res.json(store.deleteConversation(req.params.id, requireRevision(req.body.expectedContentRevision)))));
    router.post('/conversations/:id/turns', wrap((req, res) => res.status(202).json(runtime.start(req.params.id, req.body))));
    router.get('/turns/:id', wrap((req, res) => res.json(publicTurn(store.getTurn(req.params.id)))));
    router.post('/turns/:id/stop', wrap((req, res) => res.json(publicTurn(runtime.stop(req.params.id)))));
    router.post('/conversations/:id/commands', wrap((req, res) => {
        requireString(req.body.type, 'type', 80);
        if (req.body.type === 'message.edit' || req.body.type === 'memory.edit') invariant(typeof req.body.content === 'string', 'invalid-content', 'Content must be a string');
        res.json(store.command(req.params.id, req.body));
    }));
    router.post('/conversations/:id/estimate', wrap((req, res) => res.json(runtime.estimate(req.params.id, req.body))));
    router.post('/conversations/:id/compact', wrap(async (req, res) => res.json(await runtime.compact(req.params.id, req.body))));
    router.post('/conversations/:id/automatic', wrap((req, res) => res.json(runtime.setAutomatic(req.params.id, req.body))));
    router.get('/conversations/:id/automatic', wrap((req, res) => res.json(runtime.automaticStatus(req.params.id))));
    router.get('/conversations/:id/messages/:messageId/candidates', wrap((req, res) => res.json(store.getCandidates(req.params.id, req.params.messageId))));
    router.get('/conversations/:id/jobs', wrap((req, res) => res.json(store.listJobs(req.params.id))));
    router.get('/conversations/:id/traces', wrap((req, res) => { store.getConversation(req.params.id); res.json(store.listTraces(req.params.id)); }));
    router.get('/conversations/:id/usage', wrap((req, res) => { store.getConversation(req.params.id); res.json(summarizeUsage(store.listTraces(req.params.id))); }));
    router.get('/traces/:id', wrap((req, res) => res.json(store.getTrace(req.params.id))));
    router.get('/capabilities', wrap((req, res) => {
        if (req.query.connectionId) {
            const resource = store.getConnection(String(req.query.connectionId));
            return res.json(capabilities(resource.data));
        }
        res.json({ schemaVersion: SCHEMA_VERSION, connections: store.listResources('connection').map(resource => ({ id: resource.id, name: resource.name, ...capabilities(store.getConnection(resource.id).data) })) });
    }));
    router.get('/conversations/:id/events', wrap((req, res) => {
        const cid = req.params.id;
        let cursor = Number(req.query.after ?? req.get('Last-Event-ID') ?? 0);
        invariant(Number.isSafeInteger(cursor) && cursor >= 0, 'invalid-cursor', 'Event cursor must be nonnegative');
        store.getConversation(cid);
        const initial = store.events(cid, 0);
        invariant(cursor <= (initial.at(-1)?.seq ?? 0), 'cursor-expired', 'Reload the conversation snapshot', 409);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.flushHeaders();
        let ended = false;
        let draining = false;
        const pump = () => {
            if (ended || draining) return;
            try {
                for (const event of store.events(cid, cursor)) {
                    cursor = event.seq;
                    if (!res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`)) {
                        draining = true;
                        res.once('drain', () => { draining = false; pump(); });
                        break;
                    }
                }
            } catch { res.end(); }
        };
        const interval = setInterval(pump, 200);
        const heartbeat = setInterval(() => { if (!ended && !draining) res.write(': heartbeat\n\n'); }, 15000);
        const cleanup = () => { ended = true; clearInterval(interval); clearInterval(heartbeat); };
        res.on('close', cleanup);
        res.on('finish', cleanup);
        pump();
    }));
    if (attachments) {
        router.post('/attachments', wrap(async (req, res) => res.status(201).json(await attachments.save(req.body))));
        router.get('/attachments/:id', wrap((req, res) => {
            const file = attachments.read(req.params.id);
            res.set({ 'Content-Type': file.mime, 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}` });
            res.send(file.bytes);
        }));
    }
    if (maintenance) {
        router.get('/maintenance/status', wrap((req, res) => res.json(maintenance.status())));
        router.get('/maintenance/export', wrap((req, res) => res.json(maintenance.export())));
        router.post('/maintenance/backup', wrap((req, res) => res.json(maintenance.export(req.body))));
        router.post('/maintenance/restore', wrap(async (req, res) => res.json(await maintenance.restore(req.body.backup ?? req.body.data))));
        router.post('/maintenance/reindex', wrap(async (req, res) => res.json(await maintenance.reindex(req.body.conversationId))));
        router.post('/maintenance/cleanup-preview', wrap((req, res) => res.json(maintenance.previewCleanup(req.body))));
        router.post('/maintenance/cleanup', wrap((req, res) => res.json(maintenance.cleanup(req.body))));
    }
    router.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        res.status(error.status && error.status >= 400 && error.status < 600 ? error.status : 500).json({ error: serializeError(error) });
    });
    return router;
}
