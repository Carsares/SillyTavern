import { renderAgentWorkspace } from '../components/agent-workspace.js';

/** Agent lives alongside the existing chat route; its client owns its own API state. */
export function createAgentRoute() {
    return { render: renderAgentWorkspace };
}
