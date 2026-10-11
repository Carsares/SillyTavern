export function createApiClient({ onTokenChange = /** @type {(token: string) => void} */ (() => {}) } = {}) {
    let csrfToken = '';
    let csrfTokenRequest = null;

    function setCsrfToken(value) {
        csrfToken = value || '';
        onTokenChange(csrfToken);
    }

    async function ensureCsrfToken() {
        if (csrfToken) {
            return csrfToken;
        }

        if (csrfTokenRequest) {
            return csrfTokenRequest;
        }

        csrfTokenRequest = (async () => {
            try {
                const response = await fetch('/csrf-token', { credentials: 'same-origin' });
                if (!response.ok) {
                    throw new Error(`CSRF token request failed: ${response.status}`);
                }

                const data = await response.json();
                setCsrfToken(data.token);
                return csrfToken;
            } finally {
                csrfTokenRequest = null;
            }
        })();

        return csrfTokenRequest;
    }

    function createRequest(method, token, options) {
        const headers = {
            'X-CSRF-Token': token,
        };

        if (options.body !== undefined && !options.omitContentType) {
            headers['Content-Type'] = 'application/json';
        }

        const request = {
            method,
            headers,
            credentials: 'same-origin',
            signal: options.signal,
        };

        if (options.body !== undefined) {
            request.body = options.omitContentType ? options.body : JSON.stringify(options.body);
        }

        return request;
    }

    async function fetchWithCsrf(path, options = {}, retry = true) {
        const method = options.method || 'POST';
        const token = await ensureCsrfToken();
        const response = await fetch(path, /** @type {RequestInit} */ (createRequest(method, token, options)));
        if (response.status === 403 && retry) {
            setCsrfToken('');
            return fetchWithCsrf(path, options, false);
        }
        if (response.status === 403) {
            throw new Error('当前会话没有访问权限，请先登录。');
        }
        if (!response.ok) {
            const error = /** @type {Error & { status?: number, body?: string }} */ (new Error(`${path} failed: ${response.status}`));
            error.status = response.status;
            // The short body of a failed response (for example the JSON of /api/translate/*) lets callers say why it failed.
            try {
                error.body = (await response.text()).slice(0, 2000);
            } catch {
                error.body = '';
            }
            throw error;
        }
        return response;
    }

    async function apiFetch(path, options = {}, retry = true) {
        const response = await fetchWithCsrf(path, options, retry);
        // Read the body even for 204 (it resolves to ''): Chromium reports a fetch whose empty body is never read
        // as net::ERR_ABORTED although the server handled it, so successful writes such as make-snapshot,
        // restore-snapshot and record deletes looked aborted in the network log
        const text = await response.text();
        if (!text) {
            return null;
        }

        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }

    async function apiFetchResponse(path, options = {}, retry = true) {
        return fetchWithCsrf(path, options, retry);
    }

    return {
        apiFetch,
        apiFetchResponse,
        getCsrfToken: () => csrfToken,
        clearCsrfToken: () => setCsrfToken(''),
    };
}
