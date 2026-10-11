import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fail } from './contracts.js';

const executeFile = promisify(execFile);
// Parent-only fixed program. No preference values are copied, read or printed;
// no Set/SetMultiple/AddSuite/RemoveSuite call and no shell interpolation.
const presenceScript = `ObjC.import('CoreFoundation');
const domain = $('com.openai.codex');
const refreshed = Boolean($.CFPreferencesAppSynchronize(domain));
if (!refreshed) throw new Error('managed-policy-refresh-failed');
JSON.stringify([refreshed,
    Boolean($.CFPreferencesAppValueIsForced($('config_toml_base64'), domain)),
    Boolean($.CFPreferencesAppValueIsForced($('requirements_toml_base64'), domain))]);`;

/** Query as the real parent user before creating the restricted SDK child. */
export async function assertUnmanagedCodex({ signal, execute = executeFile } = {}) {
    let flags;
    try {
        signal?.throwIfAborted();
        const { stdout } = await execute('/usr/bin/osascript', ['-l', 'JavaScript', '-e', presenceScript], {
            env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' },
            encoding: 'utf8', timeout: 5000, maxBuffer: 1024, signal,
        });
        flags = JSON.parse(stdout);
        if (!Array.isArray(flags) || flags.length !== 3 || flags.some(value => typeof value !== 'boolean') || flags[0] !== true) throw new Error('invalid-presence-result');
    } catch {
        throw fail('managed-policy-check-failed', 'Could not establish administrator policy absence; SDK process was not started', 503);
    }
    if (flags[1] || flags[2]) throw fail('managed-policy-present', 'Administrator-managed Codex requires a policy-preserving isolated runtime', 503);
}
