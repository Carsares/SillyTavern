import path from 'node:path';
import { createConversationServices } from './composition/index.js';
import { createRouter } from './api/index.js';

/** Mount after the workspace's authentication/CSRF middleware and before its body parsers. */
export function createConversationHost({ createServices = createConversationServices, routerFor = createRouter } = {}) {
    const users = new Map();
    let closing;
    const middleware = (req, res, next) => {
        if (closing) return res.status(503).json({ error: { code: 'shutting-down', message: 'Server is stopping' } });
        const root = req.user?.directories?.root;
        if (typeof root !== 'string' || !path.isAbsolute(root)) return res.status(401).json({ error: { code: 'unauthorized', message: 'Sign in to use Agent conversations' } });
        // Do not trust a body/query user ID: the application has already resolved the signed-in user.
        const directory = path.join(root, 'conversation-v1');
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
        close() {
            closing ??= (async () => {
                const results = await Promise.allSettled([...users.values()].map(({ services }) => services.close()));
                users.clear();
                if (results.some(result => result.status === 'rejected')) throw new Error('Failed to close Agent workspaces');
            })();
            return closing;
        },
    };
}
