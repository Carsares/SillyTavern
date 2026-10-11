import path from 'node:path';
import express from 'express';
import { createConversationServices } from './composition/index.js';
import { createRouter } from './api/index.js';
import { createWorkspaceRouter } from './workspace-resources.js';

function createHostedRouter(services) {
    const router = express.Router();
    router.use('/workspace', createWorkspaceRouter(services));
    router.use(createRouter(services));
    return router;
}

/** Mount after the workspace's authentication/CSRF middleware and before its body parsers. */
export function createConversationHost({ createServices = createConversationServices, routerFor = createHostedRouter } = {}) {
    const users = new Map();
    const changing = new Set();
    const changes = new Set();
    let closing;
    const middleware = (req, res, next) => {
        if (closing) return res.status(503).json({ error: { code: 'shutting-down', message: 'Server is stopping' } });
        const root = req.user?.directories?.root;
        if (typeof root !== 'string' || !path.isAbsolute(root)) return res.status(401).json({ error: { code: 'unauthorized', message: 'Sign in to use Agent conversations' } });
        // Do not trust a body/query user ID: the application has already resolved the signed-in user.
        const directory = path.join(root, 'conversation-v1');
        if (changing.has(directory)) return res.status(503).json({ error: { code: 'workspace-changing', message: 'Account data is being changed; reload after it finishes' } });
        try {
            if (!users.has(directory)) {
                const services = createServices({ directory });
                users.set(directory, { services, router: routerFor(services) });
            }
            return users.get(directory).router(req, res, next);
        } catch {
            // Startup failures can contain local paths or connection configuration.
            return res.status(503).json({ error: { code: 'agent-unavailable', message: 'Agent workspace could not be opened; check its storage version and running processes' } });
        }
    };
    return {
        middleware,
        async withUserDataChange(root, change) {
            const directory = path.join(path.resolve(root), 'conversation-v1');
            if (closing || changing.has(directory)) throw new Error('Agent workspace is already closing or changing');
            changing.add(directory);
            const operation = (async () => {
                // If close fails, keep the gate closed and do not delete any user data.
                await users.get(directory)?.services.close();
                users.delete(directory);
                try { return await change(); } finally { changing.delete(directory); }
            })();
            changes.add(operation);
            try { return await operation; } finally { changes.delete(operation); }
        },
        close() {
            closing ??= (async () => {
                const results = await Promise.allSettled([...changes, ...[...users.values()].map(({ services }) => services.close())]);
                users.clear();
                if (results.some(result => result.status === 'rejected')) throw new Error('Failed to close Agent workspaces');
            })();
            return closing;
        },
    };
}
