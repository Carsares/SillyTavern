try {
    const headers = process.env.CONVERSATION_PASSWORD ? { Authorization: `Basic ${Buffer.from(`health:${process.env.CONVERSATION_PASSWORD}`).toString('base64')}` } : {};
    const response = await fetch('http://127.0.0.1:8000/health', { headers, signal: AbortSignal.timeout(5000), redirect: 'error' });
    const result = response.ok ? await response.json() : null;
    if (result?.status !== 'ok' || result.schemaVersion !== 1) process.exitCode = 1;
} catch { process.exitCode = 1; }
