#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createEvaluationAdapter } from './adapter.mjs';
import { createDataset, validateDataset } from './dataset.mjs';
import { evaluationMatrix, validateRunConfig, runEvaluation, EXECUTORS } from './runner.mjs';

const args = process.argv.slice(2);
const configIndex = args.indexOf('--config');
const execute = args.includes('--run');
const dataset = createDataset();
if (!execute) {
    process.stdout.write(JSON.stringify({ status: 'not-run', dataset: validateDataset(dataset), fingerprint: dataset.fingerprint, conditions: evaluationMatrix(),
        reason: 'Planning only. Paid execution requires --run --config FILE with connection environment credentials and explicit caps.' }, null, 2) + '\n');
} else {
    let config, configFile;
    try {
        if (configIndex >= 0 && args[configIndex + 1]) { configFile = resolve(args[configIndex + 1]); config = JSON.parse(await readFile(configFile, 'utf8')); }
        const blocked = validateRunConfig(config);
        if (blocked) {
            process.stdout.write(JSON.stringify({ status: 'blocked', reason: blocked, quality: null }) + '\n'); process.exitCode = 2;
        } else {
            const adapters = Object.fromEntries(EXECUTORS.map(executor => [executor,
                createEvaluationAdapter({ executor, config: config.executors?.[executor] ?? {} })]));
            const result = await runEvaluation({ config, adapters, dataset, onRecord: record => process.stderr.write(JSON.stringify(record) + '\n') });
            process.stdout.write(JSON.stringify(result, null, 2) + '\n');
            process.exitCode = result.status !== 'completed' ? 2 : result.quality === 'passed' ? 0 : 1;
        }
    } catch {
        process.stdout.write(JSON.stringify({ status: 'blocked', reason: 'evaluation-configuration-or-adapter-error', quality: null }) + '\n'); process.exitCode = 2;
    }
}
