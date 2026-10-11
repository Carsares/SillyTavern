// OpenRouter PKCE OAuth handled entirely inside the modern UI, so the flow no longer lands on the legacy page.
const OPENROUTER_VERIFIER_KEY = 'st-modern-openrouter-code-verifier';

export function createApiOAuthActions({
    state,
    apiFetch,
    loadData,
    render,
    showToast,
}) {
    async function generateChallenge(verifier) {
        const data = new TextEncoder().encode(verifier);
        const hash = await crypto.subtle.digest('SHA-256', data);
        return btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    // Start the OpenRouter authorization: store a PKCE verifier and redirect to OpenRouter
    async function startOpenRouterAuth() {
        const verifier = `${crypto.randomUUID()}${crypto.randomUUID()}`;
        const challenge = await generateChallenge(verifier);
        window.localStorage.setItem(OPENROUTER_VERIFIER_KEY, verifier);
        const callbackUrl = new URL('/callback/openrouter', window.location.origin);
        window.location.href = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(callbackUrl.toString())}&code_challenge=${challenge}&code_challenge_method=S256`;
    }

    // Complete the OpenRouter authorization from the callback params the server forwarded to /modern
    async function completeOpenRouterAuthFromUrl() {
        const params = new URLSearchParams(window.location.search);
        if (params.get('oauthSource') !== 'openrouter') {
            return;
        }

        try {
            const code = new URLSearchParams(params.get('oauthQuery') || '').get('code');
            if (!code) {
                throw new Error('OpenRouter 授权码缺失。');
            }
            const verifier = window.localStorage.getItem(OPENROUTER_VERIFIER_KEY);
            if (!verifier) {
                throw new Error('未找到 OpenRouter code verifier，请重新发起授权。');
            }

            const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
            });
            if (!response.ok) {
                throw new Error('OpenRouter 交换失败。');
            }
            const data = await response.json();
            if (!data || !data.key) {
                throw new Error('OpenRouter 返回无效。');
            }

            await apiFetch('/api/secrets/write', { body: { key: 'api_key_openrouter', value: data.key, label: 'openrouter modern oauth' } });
            showToast('OpenRouter 授权成功', '密钥已保存到 secrets');
            await loadData({ silent: true });
        } catch (error) {
            state.errors.push({ key: 'openrouter-oauth', message: error.message });
            showToast('OpenRouter 授权失败', error.message);
        } finally {
            window.localStorage.removeItem(OPENROUTER_VERIFIER_KEY);
            // Strip the one-shot oauth params from the URL so a refresh doesn't retry
            const url = new URL(window.location.href);
            url.searchParams.delete('oauthSource');
            url.searchParams.delete('oauthQuery');
            window.history.replaceState({}, '', url.toString());
            render();
        }
    }

    return {
        startOpenRouterAuth,
        completeOpenRouterAuthFromUrl,
    };
}
