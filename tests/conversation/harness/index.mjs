import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function temporaryDirectory(t) {
    const directory = mkdtempSync(join(tmpdir(), 'conversation-v1-test-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    return directory;
}

export function deterministicClock(start = 1700000000000) {
    let value = start;
    return () => value++;
}

export function deterministicIds(prefix = 'test') {
    let value = 0;
    return () => `${prefix}-${++value}`;
}

export function fakeExecutor({ chunks = ['Hello', ' world'], failure, gate } = {}) {
    const calls = [];
    return {
        calls,
        async runTurn(options) {
            calls.push(options);
            await options.beforeRequest?.(options.requestPlan);
            if (gate) await gate;
            let content = '';
            for (const text of chunks) {
                options.signal?.throwIfAborted();
                content += text;
                await options.onEvent?.({ type: 'text.delta', text });
            }
            if (failure) throw failure;
            return { content, reasoning: '', usage: { inputTokens: 4, outputTokens: 2, complete: true }, finishReason: 'stop' };
        },
    };
}

export function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
