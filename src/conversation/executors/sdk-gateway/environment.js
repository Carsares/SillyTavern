import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, realpath, access, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir, release } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { fail, SDK_VERSIONS } from './contracts.js';
import { assertUnmanagedCodex } from './managed-policy.js';

const require = createRequire(import.meta.url);

export async function loadSdk(executor) {
    const name = executor === 'claude' ? '@anthropic-ai/claude-agent-sdk' : '@openai/codex-sdk';
    let entry;
    try { entry = fileURLToPath(import.meta.resolve(name)); } catch { throw fail('sdk-not-installed', `Install ${name}@${SDK_VERSIONS[executor]}`, 503); }
    const manifest = join(dirname(entry), executor === 'codex' ? '../package.json' : 'package.json');
    const pkg = JSON.parse(await readFile(manifest, 'utf8'));
    if (pkg.version !== SDK_VERSIONS[executor]) throw fail('sdk-version-mismatch', `Expected ${name}@${SDK_VERSIONS[executor]}`, 503);
    return import(name);
}

async function nativeExecutable(executor) {
    const arch = process.arch;
    if (!['arm64', 'x64'].includes(arch)) throw fail('unsupported-platform', 'Unsupported native SDK architecture', 503);
    const packageName = executor === 'claude' ? `@anthropic-ai/claude-agent-sdk-darwin-${arch}` : `@openai/codex-darwin-${arch}`;
    let root;
    try { root = dirname(require.resolve(`${packageName}/package.json`)); } catch { throw fail('sdk-native-not-installed', 'SDK platform binary is not installed', 503); }
    const path = executor === 'claude' ? join(root, 'claude') : join(root, 'vendor', `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`, 'bin', 'codex');
    await access(path);
    return realpath(path);
}

/** No home/repository reads, general network, shell executables or credential IPC. */
export function macSandboxProfile({ directory, executable, gatewayPort }) {
    if (!Number.isSafeInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535) throw fail('invalid-gateway-port', 'Invalid gateway port');
    const literal = p => JSON.stringify(p);
    const ancestors = new Set(['/etc', '/private', '/private/etc']);
    for (const path of [directory, executable]) {
        for (let parent = dirname(path); parent !== '/'; parent = dirname(parent)) ancestors.add(parent);
    }
    return `(version 1)
(deny default)
(allow process-fork)
(allow process-exec (literal ${literal(executable)}))
(allow signal (target self))
(allow sysctl-read)
(allow file-read-metadata ${[...ancestors].map(path => `(literal ${literal(path)})`).join(' ')})
(allow file-read* (literal "/") (subpath "/System/Library") (subpath "/usr/lib")
  (subpath "/usr/share/icu") (subpath "/usr/share/locale")
  (subpath "/private/var/db/dyld") (literal "/dev/null") (literal "/dev/urandom")
  (literal "/dev/random") (literal ${literal(executable)}) (subpath ${literal(directory)}))
(allow file-write* (subpath ${literal(directory)}) (literal "/dev/null"))
(deny file-read* (with errno ENOENT) (subpath "/private/etc/codex") (subpath "/etc/codex"))
(allow network-outbound (remote tcp "localhost:${gatewayPort}"))
`;
}

/** Built-in macOS backend. Other platforms must supply an isolated environment. */
export async function createRestrictedEnvironment({ executor, gateway, executable: explicitExecutable, signal }) {
    if (process.platform !== 'darwin') throw fail('unsupported-isolation-platform', 'An OS-restricted environmentFactory is required on this platform', 503);
    await access('/usr/bin/sandbox-exec');
    // Never hide an installed administrator policy or read host configuration.
    if (executor === 'codex') {
        await assertUnmanagedCodex({ signal });
        try { await access('/etc/codex'); throw fail('managed-config-requires-isolation', 'Host managed Codex configuration requires a separate isolated runtime', 503); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const executable = await realpath(explicitExecutable ?? await nativeExecutable(executor));
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'conversation-sdk-')));
    const children = new Set();
    const port = Number(new URL(gateway.baseUrl).port);
    const env = {
        HOME: directory, CODEX_HOME: join(directory, 'codex'), CLAUDE_CONFIG_DIR: join(directory, 'claude'),
        TMPDIR: directory, CLAUDE_CODE_TMPDIR: directory, CLAUDE_TMPDIR: directory, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8',
        ANTHROPIC_API_KEY: gateway.token, ANTHROPIC_BASE_URL: gateway.baseUrl,
        OPENAI_API_KEY: gateway.token, CODEX_API_KEY: gateway.token, CONVERSATION_MCP_TOKEN: gateway.token,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
    };
    const profilePath = join(directory, 'sandbox.sb');
    const launcher = join(directory, 'sdk-launcher.mjs');
    const started = join(directory, 'launcher.started');
    const finished = join(directory, 'launcher.finished');
    try {
        await mkdir(env.CODEX_HOME); await mkdir(env.CLAUDE_CONFIG_DIR);
        await writeFile(profilePath, macSandboxProfile({ directory, executable, gatewayPort: port }), { mode: 0o600 });
        // This trusted launcher runs outside the sandbox; all SDK CLI code runs
        // inside. It forwards only arguments, never evaluates them, and joins its
        // child on SIGTERM. No user-provided script is executed in the launcher.
        await writeFile(launcher, `#!${process.execPath}
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(started)}, String(process.pid), {mode: 0o600});
const child = spawn('/usr/bin/sandbox-exec', ['-f', ${JSON.stringify(profilePath)}, ${JSON.stringify(executable)}, ...process.argv.slice(2)], {stdio:'inherit', env:process.env, cwd:${JSON.stringify(directory)}});
let timer;
for (const sig of ['SIGTERM','SIGINT']) process.on(sig, () => { child.kill('SIGTERM'); timer ??= setTimeout(() => child.kill('SIGKILL'), 1500); });
child.on('error', () => { writeFileSync(${JSON.stringify(finished)}, 'error'); process.exitCode=1; });
child.on('close', code => { clearTimeout(timer); writeFileSync(${JSON.stringify(finished)}, String(code)); process.exitCode=code ?? 1; });
`, { mode: 0o700 });
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
    let closed = false;
    return {
        directory, env, codexPathOverride: launcher, claudeExecutable: executable,
        claudeEnvironmentText(model) {
            const now = new Date();
            const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
            return `# Environment\nYou have been invoked in the following environment: \n - Primary working directory: ${directory}\n - Is a git repository: false\n - Platform: darwin\n - Shell: unknown\n - OS Version: Darwin ${release()}\n\nYou are powered by the model ${model}.\n\nToday's date is ${date}.`;
        },
        security: { mode: 'macos-sandbox-exec', enforced: true, sdkRuntimeVerified: false },
        spawnClaudeCodeProcess(options) {
            if (closed) throw fail('environment-closed', 'SDK environment closed');
            const child = spawn('/usr/bin/sandbox-exec', ['-f', profilePath, executable, ...options.args], {
                cwd: directory, env: options.env, stdio: ['pipe', 'pipe', 'pipe'], signal: options.signal,
            });
            children.add(child);
            child.once('close', () => children.delete(child));
            return child;
        },
        async close() {
            if (closed) return;
            closed = true;
            await Promise.all([...children].map(child => new Promise(resolve => {
                child.once('close', resolve); child.kill('SIGTERM');
                const timer = setTimeout(() => child.kill('SIGKILL'), 1500);
                timer.unref(); child.once('close', () => clearTimeout(timer));
            })));
            // Codex SDK owns the launcher handle. runTurn aborts it first; wait
            // for the launcher's child-close receipt before deleting its files.
            let launched = false;
            try { await access(started); launched = true; } catch { /* no child */ }
            if (launched) {
                let joined = false;
                for (let i = 0; i < 100; i++) {
                    try { await access(finished); joined = true; break; } catch { await delay(25); }
                }
                if (!joined) throw fail('sdk-shutdown-incomplete', 'SDK child exit was not confirmed; isolated directory retained', 503);
            }
            await rm(directory, { recursive: true, force: true });
        },
    };
}
