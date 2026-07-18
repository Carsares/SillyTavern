import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// The config lives under tests/, but server.js and the app it serves are
// anchored at the repository root.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// Escape hatch: when PLAYWRIGHT_BASE_URL points at an already-running server the
// default project targets it directly and the managed webServer is skipped.
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL || '';

// The managed mock server runs on a dedicated port against a gitignored data
// root so it never touches ./data/default-user.
const mockServerPort = 8100;
const mockServerBaseURL = `http://127.0.0.1:${mockServerPort}`;
const defaultBaseURL = externalBaseURL || mockServerBaseURL;

// Playwright runs every configured project by default, which would pull the
// real-backend and external-dependency suites into the default gate. Both carry
// live external dependencies, so they are only materialised when named through
// `--project`.
const requestedProjects = collectRequestedProjects();
const runDefault = requestedProjects.size === 0 || requestedProjects.has('default');
const runRealBackend = requestedProjects.has('real-backend');
const runExternal = requestedProjects.has('external');

/**
 * Collect the project names passed via `--project`/`-p` on the CLI.
 * @returns {Set<string>} Explicitly requested project names.
 */
function collectRequestedProjects() {
    const names = new Set();
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--project' || arg === '-p') {
            if (argv[i + 1]) {
                names.add(argv[i + 1]);
            }
        } else if (arg.startsWith('--project=')) {
            names.add(arg.slice('--project='.length));
        }
    }
    return names;
}

const projects = [];

if (runDefault) {
    // Mock route-level suites (page.route intercepts /api) plus the headless
    // bridge, all served by the managed mock server.
    projects.push({
        name: 'default',
        testMatch: /modern-.*\.e2e\.js$/,
        testIgnore: [
            /modern-real-backend-integration\.e2e\.js$/,
            /modern-external-dependencies\.e2e\.js$/,
            /[\\/]frontend[\\/]/,
            /[\\/]tests[\\/]tests[\\/]/,
        ],
        use: { baseURL: defaultBaseURL },
    });
}

if (runRealBackend) {
    // Self-hosts its own throwaway server in beforeAll; no managed webServer.
    projects.push({
        name: 'real-backend',
        testMatch: /modern-real-backend-integration\.e2e\.js$/,
    });
}

if (runExternal) {
    // Gated internally by MODERN_EXTERNAL_E2E; reuses the managed default server.
    projects.push({
        name: 'external',
        testMatch: /modern-external-dependencies\.e2e\.js$/,
        use: { baseURL: defaultBaseURL },
    });
}

// The default and external projects rely on the managed server; the real-backend
// project self-hosts and PLAYWRIGHT_BASE_URL bypasses self-hosting entirely.
const needWebServer = (runDefault || runExternal) && !externalBaseURL;

export default defineConfig({
    use: {
        video: 'only-on-failure',
        screenshot: 'only-on-failure',
    },
    workers: 4,
    fullyParallel: true,
    webServer: needWebServer ? {
        command: `node server.js --dataRoot=./tests/.e2e-data --port=${mockServerPort} --listen=false --browserLaunchEnabled=false`,
        cwd: repoRoot,
        url: mockServerBaseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
    } : undefined,
    projects,
});
