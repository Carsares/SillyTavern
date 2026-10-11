import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { macSandboxProfile } from '../../../../src/conversation/executors/sdk-gateway/environment.js';

const mac = process.platform === 'darwin';

test('profile restricts executable and outbound address, without granting user home or credential IPC', () => {
    const profile = macSandboxProfile({ directory: '/private/tmp/owned', executable: '/bin/cat', gatewayPort: 12345 });
    assert.match(profile, /\(deny default\)/);
    assert.match(profile, /\(allow process-exec \(literal "\/bin\/cat"\)\)/);
    assert.match(profile, /localhost:12345/);
    assert.ok(!profile.includes('mach-lookup'));
    assert.ok(!profile.includes('subpath "/Users"'));
    assert.ok(!profile.includes('(allow network*)'));
});

test('macOS policy compiles: generated data readable, outside canary denied', { skip: !mac }, async t => {
    const inside = await realpath(await mkdtemp(join(tmpdir(), 'sdk-policy-inside-')));
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'sdk-policy-outside-')));
    t.after(async () => { await rm(inside, { recursive: true }); await rm(outside, { recursive: true }); });
    const good = join(inside, 'fixture'), bad = join(outside, 'canary');
    await writeFile(good, 'allowed'); await writeFile(bad, 'private-canary');
    const profile = macSandboxProfile({ directory: inside, executable: '/bin/cat', gatewayPort: 12345 });
    const run = path => spawnSync('/usr/bin/sandbox-exec', ['-p', profile, '/bin/cat', path], { env: { PATH: '/usr/bin:/bin', HOME: inside }, encoding: 'utf8', timeout: 3000 });
    const allowed = run(good); assert.equal(allowed.status, 0, allowed.stderr); assert.equal(allowed.stdout, 'allowed');
    const denied = run(bad); assert.notEqual(denied.status, 0); assert.ok(!denied.stdout.includes('private-canary')); assert.match(denied.stderr, /not permitted|denied/i);
});

test('macOS policy denies launching another executable and writing outside task data', { skip: !mac }, async t => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'sdk-policy-shell-')));
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'sdk-policy-write-')));
    t.after(async () => { await rm(directory, { recursive: true }); await rm(outside, { recursive: true }); });
    const profile = macSandboxProfile({ directory, executable: '/bin/bash', gatewayPort: 12345 });
    const run = args => spawnSync('/usr/bin/sandbox-exec', ['-p', profile, '/bin/bash', ...args], { env: { HOME: directory, PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 3000 });
    const allowed = run(['-c', 'printf allowed']); assert.equal(allowed.status, 0, allowed.stderr);
    const forbidden = run(['-c', 'exec /usr/bin/true']); assert.notEqual(forbidden.status, 0); assert.match(forbidden.stderr, /not permitted|denied/i);
    // The output filename is supplied as positional data, never interpolated in shell code.
    const write = run(['-c', 'printf x > "$1"', 'probe', join(outside, 'new-file')]);
    assert.notEqual(write.status, 0); assert.match(write.stderr, /not permitted|denied/i);
});
