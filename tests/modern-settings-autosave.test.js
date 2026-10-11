import { describe, expect, jest, test } from '@jest/globals';
import { createCoalescedRunner, createSettingsAutosave } from '../public/modern/actions/settings-autosave.js';

function createFixture({ failSave = false, reloadResult = { ok: true } } = {}) {
    const state = { settings: { oai_settings: { temp_openai: 1, openai_max_context: 4095 } } };
    const saved = [];
    const toasts = [];
    const apiFetch = jest.fn(async (path, options = {}) => {
        if (path === '/api/settings/save') {
            if (failSave) {
                throw new Error('disk full');
            }
            saved.push(structuredClone(options.body));
            return {};
        }
        if (path === '/api/secrets/write') {
            return {};
        }
        if (path === '/api/secrets/read') {
            return { api_key_custom: [{ id: '1', active: true }] };
        }
        throw new Error(`unexpected ${path}`);
    });
    const reloadSettings = jest.fn(async () => reloadResult);
    const autosave = createSettingsAutosave({
        state,
        apiFetch,
        showToast: (title, message) => toasts.push({ title, message }),
        reloadSettings,
    });
    return { state, saved, toasts, apiFetch, reloadSettings, autosave };
}

describe('settings autosave', () => {
    test('a change is written, saved as a whole and followed by one engine reload', async () => {
        const fixture = createFixture();
        const result = await fixture.autosave.commit({
            changes: [[['oai_settings', 'openai_max_context'], 131072], [['oai_settings', 'max_context_unlocked'], true]],
            label: '上下文长度',
        });
        await fixture.autosave.flush();

        expect(result).toEqual({ ok: true });
        expect(fixture.saved).toHaveLength(1);
        expect(fixture.saved[0].oai_settings).toMatchObject({ temp_openai: 1, openai_max_context: 131072, max_context_unlocked: true });
        expect(fixture.reloadSettings).toHaveBeenCalledTimes(1);
        expect(fixture.autosave.getStatus()).toMatchObject({ phase: 'saved', message: '上下文长度已保存' });
    });

    test('a failed save restores the previous values, including keys that did not exist', async () => {
        const fixture = createFixture({ failSave: true });
        const result = await fixture.autosave.commit({
            changes: [[['oai_settings', 'openai_max_context'], 131072], [['power_user', 'max_context_unlocked'], true]],
            label: '上下文长度',
        });

        expect(result.ok).toBe(false);
        expect(fixture.state.settings.oai_settings.openai_max_context).toBe(4095);
        expect(fixture.state.settings.power_user).toEqual({});
        expect(fixture.reloadSettings).not.toHaveBeenCalled();
        expect(fixture.toasts).toEqual([{ title: '上下文长度保存失败', message: 'disk full' }]);
        expect(fixture.autosave.getStatus()).toMatchObject({ phase: 'error', detail: 'disk full' });
    });

    test('a value equal to the saved one is not written again', async () => {
        const fixture = createFixture();
        const result = await fixture.autosave.commit({ changes: [[['oai_settings', 'temp_openai'], 1]], label: 'Temperature' });

        expect(result).toEqual({ ok: true, unchanged: true });
        expect(fixture.apiFetch).not.toHaveBeenCalled();
    });

    test('an engine that does not sync turns the status into a warning without undoing the save', async () => {
        const fixture = createFixture({ reloadResult: { ok: false, error: 'bridge timeout' } });
        await fixture.autosave.commit({ changes: [[['oai_settings', 'temp_openai'], 0.7]], label: 'Temperature' });
        await fixture.autosave.flush();

        expect(fixture.saved).toHaveLength(1);
        expect(fixture.autosave.getStatus()).toMatchObject({ phase: 'warning', message: '已保存，但生成引擎未同步' });
        expect(fixture.autosave.getStatus().detail).toContain('bridge timeout');
    });

    test('engine reloads requested while one is running collapse into a single extra reload', async () => {
        const fixture = createFixture();
        /** @type {(value: any) => void} */
        let release = () => {};
        fixture.reloadSettings.mockImplementationOnce(() => new Promise(resolve => {
            release = resolve;
        }));
        const first = fixture.autosave.syncEngine();
        fixture.autosave.syncEngine();
        fixture.autosave.syncEngine();
        release({ ok: true });
        await first;

        expect(fixture.reloadSettings).toHaveBeenCalledTimes(2);
    });

    test('labels ending in latin letters get a space before the status text', async () => {
        const fixture = createFixture();
        await fixture.autosave.commit({ changes: [[['main_api'], 'textgenerationwebui']], label: '主 API' });
        expect(fixture.autosave.getStatus().message).toBe('主 API 已保存');
    });

    test('a secret is written, the saved-key state refreshed, and the settings file left alone', async () => {
        const fixture = createFixture();
        const result = await fixture.autosave.commitSecret({ key: 'api_key_custom', value: 'sk-test', label: 'custom modern', description: 'API Key' });

        expect(result).toEqual({ ok: true });
        expect(fixture.apiFetch).toHaveBeenCalledWith('/api/secrets/write', { body: { key: 'api_key_custom', value: 'sk-test', label: 'custom modern' } });
        expect(fixture.state.secretState).toEqual({ api_key_custom: [{ id: '1', active: true }] });
        expect(fixture.saved).toHaveLength(0);
    });
});

describe('coalesced runner', () => {
    test('calls made while a run is in progress trigger exactly one more run', async () => {
        let runs = 0;
        /** @type {Array<() => void>} */
        const releases = [];
        const run = createCoalescedRunner(async () => {
            runs += 1;
            await new Promise(resolve => releases.push(resolve));
        });

        const first = run();
        run();
        run();
        releases.shift()?.();
        await new Promise(resolve => setTimeout(resolve, 0));
        releases.shift()?.();
        await first;

        expect(runs).toBe(2);
    });
});
