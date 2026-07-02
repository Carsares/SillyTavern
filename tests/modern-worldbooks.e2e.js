import { Buffer } from 'node:buffer';
import { test, expect } from '@playwright/test';
import { createModernResourceFixture, gotoModern, mockModernWorkspace } from './modern-test-utils.js';

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function fulfillJson(route, body, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

function multipartFileName(bodyText, fieldName) {
    const match = new RegExp(`name="${fieldName}"; filename="([^"]+)"`).exec(bodyText);
    return match?.[1]?.trim() || '';
}

function createWorldbookDetail(name, entries = {}) {
    return {
        name,
        entries,
        extensions: {},
        originalData: {
            entries: Object.values(entries).map(entry => ({
                uid: entry.uid,
                keys: entry.key,
                secondary_keys: entry.keysecondary || [],
                comment: entry.comment || '',
                content: entry.content || '',
                insertion_order: entry.order || 0,
                enabled: !entry.disable,
                extensions: {
                    position: entry.position,
                    depth: entry.depth,
                    probability: entry.probability,
                },
            })),
        },
    };
}

function createWorldbookFixture() {
    const loreEntries = {
        0: {
            uid: 0,
            key: ['alpha'],
            keysecondary: [],
            comment: 'alpha entry',
            content: 'Alpha lore content.',
            order: 0,
            position: 0,
            depth: 4,
            probability: 100,
            selective: true,
            disable: false,
        },
        1: {
            uid: 1,
            key: ['beta'],
            keysecondary: [],
            comment: 'beta entry',
            content: 'Beta lore content.',
            order: 1,
            position: 0,
            depth: 4,
            probability: 100,
            selective: true,
            disable: false,
        },
        2: {
            uid: 2,
            key: ['gamma'],
            keysecondary: [],
            comment: 'gamma entry',
            content: 'Gamma lore content.',
            order: 2,
            position: 0,
            depth: 4,
            probability: 100,
            selective: true,
            disable: true,
        },
    };

    const fixture = createModernResourceFixture({
        settings: {
            world_info_settings: {
                world_info: {
                    globalSelect: ['Lore'],
                },
            },
        },
        settingsBundle: {
            world_names: ['Lore'],
        },
        worldbooks: [{ file_id: 'Lore', name: 'Lore' }],
    });
    fixture.worldDetails = {
        Lore: createWorldbookDetail('Lore', loreEntries),
    };
    fixture.requests.worldbookWorkflows = {
        gets: [],
        edits: [],
        imports: [],
        deletes: [],
    };

    return fixture;
}

function upsertWorldbook(fixture, name) {
    if (!fixture.worldbooks.some(worldbook => worldbook.file_id === name)) {
        fixture.worldbooks.push({ file_id: name, name });
    }
    fixture.settingsBundle.world_names = [...new Set([...(fixture.settingsBundle.world_names || []), name])];
}

async function mockModernWorldbooksWorkspace(page) {
    const fixture = createWorldbookFixture();
    const requests = fixture.requests.worldbookWorkflows;
    await mockModernWorkspace(page, fixture);

    await page.route('**/api/worldinfo/get', route => {
        const payload = route.request().postDataJSON();
        requests.gets.push(clone(payload));
        return fulfillJson(route, fixture.worldDetails[payload.name] || createWorldbookDetail(payload.name));
    });

    await page.route('**/api/worldinfo/edit', route => {
        const payload = route.request().postDataJSON();
        requests.edits.push(clone(payload));
        fixture.worldDetails[payload.name] = clone(payload.data);
        upsertWorldbook(fixture, payload.name);
        return fulfillJson(route, { ok: true });
    });

    await page.route('**/api/worldinfo/import', route => {
        const bodyText = route.request().postData() || '';
        const fileName = multipartFileName(bodyText, 'avatar') || `Imported-${requests.imports.length + 1}.json`;
        const name = fileName.replace(/\.json$/i, '');
        requests.imports.push({
            bodyText,
            contentType: route.request().headers()['content-type'] || '',
            fileName,
        });
        fixture.worldDetails[name] = createWorldbookDetail(name, {
            0: {
                uid: 0,
                key: ['imported'],
                comment: 'imported entry',
                content: 'Imported lore content.',
                order: 0,
                position: 0,
                depth: 4,
                probability: 100,
                selective: true,
                disable: false,
            },
        });
        upsertWorldbook(fixture, name);
        return fulfillJson(route, { name });
    });

    await page.route('**/api/worldinfo/delete', route => {
        const payload = route.request().postDataJSON();
        requests.deletes.push(clone(payload));
        fixture.worldbooks = fixture.worldbooks.filter(worldbook => worldbook.file_id !== payload.name);
        fixture.settingsBundle.world_names = (fixture.settingsBundle.world_names || []).filter(name => name !== payload.name);
        delete fixture.worldDetails[payload.name];
        return fulfillJson(route, { ok: true });
    });

    return fixture;
}

async function selectWorldEntry(page, entryKey, selectedCount) {
    await page.locator(`[data-world-entry-select="${entryKey}"]`).check();
    await expect(page.locator('[data-delete-selected-world-entries]')).toContainText(`删除所选 ${selectedCount}`);
}

test.describe('Modern worldbooks page', () => {
    test('manages worldbooks and entries through modern controls', async ({ page }) => {
        const fixture = await mockModernWorldbooksWorkspace(page);
        const requests = fixture.requests.worldbookWorkflows;

        await gotoModern(page, 'worldbooks', '世界书');

        await expect.poll(() => requests.gets.length).toBe(1);
        await expect(page.locator('.world-entry-card')).toHaveCount(3);
        await expect(page.locator('[data-select-worldbook="Lore"]')).toContainText('全局启用');

        await page.locator('[data-create-worldbook]').click();
        await page.locator('[data-worldbook-create-name]').fill('CreatedWorld');
        await page.locator('[data-save-worldbook-create]').click();

        await expect.poll(() => requests.edits.length).toBe(1);
        expect(requests.edits[0]).toMatchObject({
            name: 'CreatedWorld',
            data: { name: 'CreatedWorld', entries: {}, extensions: {} },
        });
        await expect(page.locator('[data-select-worldbook="CreatedWorld"]')).toBeVisible();

        await page.locator('[data-select-worldbook="Lore"]').click();
        await page.locator('[data-toggle-world-global="Lore"]').click();

        await expect.poll(() => fixture.requests.settingsSave.length).toBe(1);
        expect(fixture.requests.settingsSave[0].world_info_settings.world_info.globalSelect).toEqual([]);
        await expect(page.locator('[data-select-worldbook="Lore"]')).toContainText('未启用');

        await selectWorldEntry(page, '1', 1);
        await selectWorldEntry(page, '2', 2);
        await expect(page.locator('[data-bulk-world-entries="disable"]')).toBeEnabled();
        await page.locator('[data-bulk-world-entries="disable"]').click();

        await expect.poll(() => requests.edits.length).toBe(2);
        expect(requests.edits.at(-1).data.entries[1].disable).toBe(true);
        expect(requests.edits.at(-1).data.entries[2].disable).toBe(true);
        await expect(page.locator('.world-entry-card', { hasText: 'beta entry' })).toContainText('禁用');
        await expect(page.locator('[data-delete-selected-world-entries]')).toContainText('删除所选 0');

        await selectWorldEntry(page, '1', 1);
        await selectWorldEntry(page, '2', 2);
        await expect(page.locator('[data-bulk-world-entries="enable"]')).toBeEnabled();
        await page.locator('[data-bulk-world-entries="enable"]').click();

        await expect.poll(() => requests.edits.length).toBe(3);
        expect(requests.edits.at(-1).data.entries[1].disable).toBe(false);
        expect(requests.edits.at(-1).data.entries[2].disable).toBe(false);
        await expect(page.locator('.world-entry-card', { hasText: 'gamma entry' })).toContainText('启用');
        await expect(page.locator('[data-delete-selected-world-entries]')).toContainText('删除所选 0');

        await page.locator('[data-copy-world-entry="Lore"][data-world-entry-key="0"]').click();

        await expect.poll(() => requests.edits.length).toBe(4);
        expect(requests.edits.at(-1).data.entries[3]).toMatchObject({ uid: 3, comment: 'alpha entry' });
        await expect(page.locator('[data-world-entry-select="3"]')).toBeVisible();

        await page.locator('[data-delete-world-entry="Lore"][data-world-entry-key="3"]').click();
        await page.locator('[data-confirm-world-entry-delete]').click();

        await expect.poll(() => requests.edits.length).toBe(5);
        expect(requests.edits.at(-1).data.entries[3]).toBeUndefined();
        await expect(page.locator('[data-world-entry-select="3"]')).toHaveCount(0);

        await selectWorldEntry(page, '1', 1);
        await selectWorldEntry(page, '2', 2);
        await expect(page.locator('[data-delete-selected-world-entries]')).toBeEnabled();
        await page.locator('[data-delete-selected-world-entries]').click();
        await expect(page.locator('.danger-panel', { hasText: '批量删除条目' })).toBeVisible();
        await page.locator('[data-cancel-world-entry-bulk-delete]').click();
        expect(requests.edits).toHaveLength(5);

        await page.locator('[data-delete-selected-world-entries]').click();
        await page.locator('[data-confirm-world-entry-bulk-delete]').click();

        await expect.poll(() => requests.edits.length).toBe(6);
        expect(requests.edits.at(-1).data.entries[1]).toBeUndefined();
        expect(requests.edits.at(-1).data.entries[2]).toBeUndefined();
        await expect(page.locator('.world-entry-card')).toHaveCount(1);

        const downloadPromise = page.waitForEvent('download');
        await page.locator('[data-export-worldbook="Lore"]').click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toBe('Lore.json');

        await page.locator('[data-worldbook-import-file]').setInputFiles({
            name: 'ImportedLore.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify({ entries: [] })),
        });

        await expect.poll(() => requests.imports.length).toBe(1);
        expect(requests.imports[0]).toMatchObject({
            fileName: 'ImportedLore.json',
        });
        expect(requests.imports[0].contentType).toContain('multipart/form-data');
        await expect(page.locator('[data-select-worldbook="ImportedLore"]')).toBeVisible();
        await expect(page.locator('.panel-title', { hasText: 'ImportedLore' })).toBeVisible();

        await page.locator('[data-delete-worldbook="ImportedLore"]').click();
        await page.locator('[data-confirm-worldbook-delete]').click();

        await expect.poll(() => requests.deletes.length).toBe(1);
        expect(requests.deletes[0]).toEqual({ name: 'ImportedLore' });
        await expect(page.locator('[data-select-worldbook="ImportedLore"]')).toHaveCount(0);
    });
});
