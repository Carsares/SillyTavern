import { CommandLineParser } from './command-line.js';
import { serverDirectory } from './server-directory.js';
import path from 'node:path';

export async function startWorkspace(hostProcess = process) {
    const cliArgs = new CommandLineParser().parse(hostProcess.argv);
    cliArgs.dataRoot = path.resolve(cliArgs.dataRoot);
    globalThis.DATA_ROOT = cliArgs.dataRoot;
    globalThis.COMMAND_LINE_ARGS = cliArgs;
    hostProcess.chdir(serverDirectory);
    return import('./server-main.js');
}
