import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store/index.js';
import { parseArguments } from './server.js';

const options = parseArguments(process.argv.slice(2));
const directory = options.directory ?? fileURLToPath(new URL('../../data/default-user/conversation-v1/', import.meta.url));
const store = createStore({ directory: path.resolve(directory) });
store.close();
console.log('Conversation v1 workspace initialized');
