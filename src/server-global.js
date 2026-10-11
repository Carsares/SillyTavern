#!/usr/bin/env node
globalThis.FORCE_GLOBAL_MODE = true;
// server.js only self-starts as the entry script; this wrapper (npm bin, Electron) starts it explicitly.
const { main } = await import('../server.js');
try {
    await main();
} catch (error) {
    console.error('A critical error has occurred while starting the server:', error);
    process.exit(1);
}

export {};
