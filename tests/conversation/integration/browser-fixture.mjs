import { startFixture } from './fixture.mjs';

// Explicit developer-only local peer; no credential discovery or upstream calls.
const fixture = await startFixture();
console.log(JSON.stringify({ url: fixture.url, dataDirectory: fixture.root }));
let closing = false;
async function close() {
    if (closing) return;
    closing = true;
    await fixture.close();
}
process.once('SIGTERM', close);
process.once('SIGINT', close);
