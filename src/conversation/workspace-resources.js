import express from 'express';
import { SCHEMA_VERSION, ProtocolError } from '../../public/shared/conversation/schemas/index.js';
import { compileContext } from '../../public/shared/conversation/assembly/index.js';
import { validateResource } from './resources/index.js';
import { projectWorkspace } from './workspace/projection.js';

/** Mounted by the authenticated original host at /api/conversation/v1/workspace. */
export function createWorkspaceRouter(services) {
    const router = express.Router();
    router.use((req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        if (!req.user?.directories?.root) return res.status(401).json({ error: { code: 'authentication-required', message: 'Sign in before starting an Agent conversation' } });
        next();
    });
    router.use(express.json({ limit: '20mb' }));
    router.post('/start', (req, res, next) => {
        Promise.resolve().then(async () => {
            if (req.body?.schemaVersion !== SCHEMA_VERSION) throw new ProtocolError('schema-version', 'Unsupported protocol version', 409);
            const projection = await projectWorkspace(req.user.directories, req.body);
            const temporary = projection.resources.map((resource, i) => ({ ...resource, id: `workspace-${i}`, revision: 1 }));
            for (const resource of temporary) validateResource(resource);
            const configure = resources => {
                const settings = { worldbookIds: [], tools: [] };
                for (const resource of resources) {
                    if (resource.kind === 'worldbook') settings.worldbookIds.push(resource.id);
                    else settings[`${resource.kind}Id`] = resource.id;
                }
                return settings;
            };
            const capabilities = services.capabilities(temporary[0].data);
            if (capabilities.supported !== true) throw new ProtocolError('workspace-unsupported', 'Current connection is not supported by the Agent provider', 422, { fields: ['connection.capabilities'] });
            // Pure validation only: no runtime start, memory jobs, embeddings or paid calls.
            const settings = configure(temporary);
            compileContext({ conversation: { id: 'workspace-preview', settings }, settings, resources: temporary, messages: [], memories: [], summaries: [], folds: [] }, { capabilities });
            const created = [];
            let conversation;
            try {
                for (const resource of projection.resources) created.push(services.resources.createResource(resource));
                conversation = services.store.createConversation({ title: projection.title, settings: configure(created) });
            } catch (error) {
                // Roll back only resources allocated by this request, never original files.
                for (const resource of created.reverse()) { try { services.store.deleteResource(resource.id, resource.revision); } catch { /* Preserve recoverable new records if cleanup fails. */ } }
                throw error;
            }
            const resourceIds = configure(created);
            // Never return resource bodies: the internal connection contains the active key.
            res.status(201).json({ schemaVersion: SCHEMA_VERSION, conversationId: conversation.id, conversation, resourceIds, notices: projection.notices });
        }).catch(next);
    });
    router.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        const known = error instanceof ProtocolError;
        const status = error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : known ? error.status : 500;
        const safe = known && ['workspace-unsupported', 'workspace-resource-unavailable', 'schema-version'].includes(error.code);
        res.status(status).json({ error: { code: safe ? error.code : status === 413 ? 'request-too-large' : status === 500 ? 'workspace-start-failed' : 'workspace-validation-failed',
            message: safe ? error.message : 'Workspace resources could not be prepared for Agent',
            ...(safe && error.details ? { details: error.details } : {}) } });
    });
    return router;
}
