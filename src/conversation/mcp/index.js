import { randomBytes, createHash } from 'node:crypto';
import { invariant, TERMINAL_STATES, TOOL_LIMITS } from '../../../public/shared/conversation/schemas/index.js';

const hash = token => createHash('sha256').update(token).digest('hex');
const rpcError = (id, code, message, data) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } });

/** HTTP JSON-RPC adapter only. Composition owns loopback binding and random port selection. */
export function createMcpServer({ registry, store, now = Date.now, ttlMs = 120000 }) {
    invariant(Number.isSafeInteger(ttlMs) && ttlMs > 0 && ttlMs <= TOOL_LIMITS.turnTimeoutMs, 'invalid-token-ttl', 'MCP token TTL must fit the turn deadline');
    const tokens = new Map();
    function prune() { for (const [key, grant] of tokens) if (now() >= grant.expiresAt) tokens.delete(key); }
    function live(turnId, epoch) {
        const turn = store.getTurn(turnId);
        const snapshot = store.getConversation(turn.conversationId);
        invariant(!TERMINAL_STATES.includes(turn.status) && !turn.cancelRequested && snapshot.conversation.activeTurnId === turnId && (epoch === undefined || epoch === turn.attemptEpoch), 'mcp-unauthorized', 'MCP turn is inactive', 401);
        return { turn, snapshot };
    }
    function issueToken(turnId, { tools, memberRunId } = {}) {
        prune();
        const { turn, snapshot } = live(turnId);
        const allowed = registry.definitions({ type: turn.type, enabled: snapshot.settings?.tools }).map(d => d.name);
        invariant(tools === undefined || (Array.isArray(tools) && tools.every(name => allowed.includes(name))), 'mcp-unauthorized', 'Token cannot grant disabled tools', 403);
        const token = randomBytes(32).toString('base64url');
        tokens.set(hash(token), { turnId, conversationId: turn.conversationId, epoch: turn.attemptEpoch,
            allowed: tools ?? allowed, memberRunId, callPrefix: randomBytes(8).toString('hex'), expiresAt: now() + ttlMs });
        return token;
    }
    function revokeToken(token) { return typeof token === 'string' && tokens.delete(hash(token)); }
    function authorize(token) {
        prune();
        invariant(typeof token === 'string' && token.length <= 256, 'mcp-unauthorized', 'Missing or invalid MCP token', 401);
        const grant = tokens.get(hash(token));
        invariant(grant && now() < grant.expiresAt, 'mcp-unauthorized', 'Expired or revoked MCP token', 401);
        const { turn, snapshot } = live(grant.turnId, grant.epoch);
        const allowed = registry.definitions({ type: turn.type, enabled: snapshot.settings?.tools }).filter(d => grant.allowed.includes(d.name));
        return { grant, allowed };
    }
    async function handle({ token, message, signal }) {
        let auth;
        try { auth = authorize(token); }
        catch { return { status: 401, body: rpcError(message?.id, -32001, 'Unauthorized') }; }
        if (!message || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || (message.id !== undefined && typeof message.id !== 'string' && !Number.isSafeInteger(message.id)))
            return { status: 400, body: rpcError(null, -32600, 'Invalid request') };
        const { grant, allowed } = auth;
        const reply = result => ({ status: 200, body: { jsonrpc: '2.0', id: message.id, result } });
        if (message.method === 'notifications/initialized' && message.id === undefined) return { status: 202, body: null };
        if (message.id === undefined) return { status: 400, body: rpcError(null, -32600, 'Request ID required') };
        if (message.method === 'initialize') return reply({ protocolVersion: '2024-11-05', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'conversation-tools', version: '1.0.0' } });
        if (message.method === 'ping') return reply({});
        if (message.method === 'tools/list') return reply({ tools: allowed.map(({ parameters, ...definition }) => ({ ...definition, inputSchema: parameters })) });
        if (message.method !== 'tools/call') return { status: 200, body: rpcError(message.id, -32601, 'Method not found') };
        const params = message.params;
        if (!params || !allowed.some(d => d.name === params.name)) return { status: 403, body: rpcError(message.id, -32602, 'Tool is not authorized') };
        try {
            // RPC IDs are stable for retries, isolated across independently issued sessions.
            const result = await registry.execute({ turnId: grant.turnId, conversationId: grant.conversationId,
                memberRunId: grant.memberRunId, toolCallId: `mcp:${grant.callPrefix}:${typeof message.id}:${message.id}`,
                name: params.name, args: params.arguments ?? {}, signal });
            authorize(token); // Do not release results to a revoked/finished session after an await.
            return reply({ content: [{ type: 'text', text: JSON.stringify(result) }], isError: false });
        } catch (error) {
            return reply({ content: [{ type: 'text', text: JSON.stringify({ error: { code: error.code ?? 'tool-failed', message: 'Tool execution did not complete' } }) }], isError: true });
        }
    }
    async function handler(req, res) {
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'POST') { res.statusCode = 405; res.setHeader('Allow', 'POST'); res.end(); return; }
        // Native SDKs need no browser Origin. Reject cross-origin browser access even with a token.
        if (req.headers.origin) { res.statusCode = 403; res.end(); return; }
        const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.authorization ?? '');
        try { authorize(match?.[1]); } catch { res.statusCode = 401; res.end(); return; }
        if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) { res.statusCode = 415; res.end(); return; }
        const controller = new AbortController();
        const abort = () => controller.abort();
        req.on?.('aborted', abort);
        try {
            let message = req.body;
            if (message === undefined) {
                const chunks = []; let bytes = 0;
                for await (const chunk of req) {
                    const buffer = Buffer.from(chunk); bytes += buffer.length;
                    if (bytes > 65536) { res.statusCode = 413; res.end(); return; }
                    chunks.push(buffer);
                }
                message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } else if (Buffer.byteLength(JSON.stringify(message)) > 65536) { res.statusCode = 413; res.end(); return; }
            const result = await handle({ token: match?.[1], message, signal: controller.signal });
            res.statusCode = result.status;
            if (result.body !== null) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result.body)); }
            else res.end();
        } catch {
            res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(rpcError(null, -32700, 'Parse error')));
        } finally { req.off?.('aborted', abort); }
    }
    return { handler, handle, issueToken, revokeToken, close() { tokens.clear(); } };
}

export const createMcpHandler = createMcpServer;
