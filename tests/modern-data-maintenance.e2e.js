/* global localStorage */
import { Buffer } from 'node:buffer';
import { test, expect } from '@playwright/test';
import { createModernResourceFixture, gotoModern, mockBridgeFrame, mockModernWorkspace } from './modern-test-utils.js';

const desktopViewport = { width: 1440, height: 900 };
// 1x1 transparent PNG
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function fulfillJson(route, body, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function postJson(route) {
    try {
        return route.request().postDataJSON() || {};
    } catch {
        return {};
    }
}

const SNAPSHOT_NAMES = [
    'settings_modern-user_20260105-120000.json',
    'settings_modern-user_20260104-120000.json',
    'settings_modern-user_20260103-120000.json',
    'settings_modern-user_20260102-120000.json',
];

function createReport() {
    return {
        images: [
            { name: 'upload-1.png', hash: 'h-img-1', parent: 'chat-pics', size: 2048, mtime: 1760000000000 },
            { name: 'upload-2.png', hash: 'h-img-2', parent: 'chat-pics', size: 1024, mtime: 1760000100000 },
        ],
        files: [{ name: 'notes.txt', hash: 'h-file-1', size: 10, mtime: 1760000200000 }],
        chats: [{ name: 'Ghost - 2024-01-01@10h00m00s000ms.jsonl', hash: 'h-chat-1', parent: 'Ghost', size: 5000, mtime: 1760000300000 }],
        groupChats: [],
        avatarThumbnails: [{ name: 'a.jpg', hash: 'h-thumb-1', size: 300, mtime: 1760000400000 }],
        backgroundThumbnails: [],
        personaThumbnails: [],
        chatBackups: [{ name: 'chat_x_20260101-000000.jsonl', hash: 'h-cb-1', size: 900, mtime: 1760000500000 }],
        settingsBackups: [{ name: 'settings_modern-user_20250101-000000.json', hash: 'h-sb-1', size: 700, mtime: 1760000600000 }],
    };
}

function createGreetingItems() {
    return [
        {
            hash: 'g-1',
            avatar: 'Alice.png',
            characterName: 'Alice',
            file: 'Alice - 2026-07-03@18h14m24s106ms.jsonl',
            size: 413,
            mtime: 1783000000000,
            sendDate: '2026-07-03T10:14:24.106Z',
            swipeCount: 1,
            preview: 'Hello, I am Alice.',
            isCardChat: false,
            modern: { file: 'Modern 2026-07-03T10-14-22-467Z.jsonl', size: 900, messageCount: 5, startsWithSameGreeting: true, timeDeltaMs: 2000 },
        },
        {
            hash: 'g-2',
            avatar: 'Bruno.png',
            characterName: 'Bruno',
            file: 'Bruno - 2026-07-03@18h15m00s000ms.jsonl',
            size: 380,
            mtime: 1783000100000,
            sendDate: '2026-07-03T10:15:00.000Z',
            swipeCount: 2,
            preview: 'Bruno here.',
            isCardChat: true,
            modern: { file: 'Modern 2026-07-03T10-14-58-000Z.jsonl', size: 700, messageCount: 3, startsWithSameGreeting: true, timeDeltaMs: 2000 },
        },
    ];
}

/**
 * Routes for the data maintenance endpoints. Every request is recorded; nothing here deletes anything real, and the
 * `state` object lets a test change what the server answers next.
 */
async function mockMaintenance(page, overrides = {}) {
    const fixture = createModernResourceFixture({ me: { name: 'Modern E2E User', handle: 'modern-user' } });
    const state = {
        report: createReport(),
        greetings: createGreetingItems(),
        snapshots: SNAPSHOT_NAMES.map((name, index) => ({ name, date: 1767614400000 - index * 86400000, size: 1000 + index })),
        backupStats: {
            total: { files: 5, bytes: 5000 },
            series: [
                { key: 'alice', files: 3, bytes: 3000, oldest: 1760000000000, newest: 1767614400000 },
                { key: 'alice_2', files: 2, bytes: 2000, oldest: 1760000000000, newest: 1760100000000 },
            ],
            unrecognized: { files: 0, bytes: 0 },
            truncated: false,
            olderThan: null,
            config: { enabled: true, checkIntegrity: true, numberOfBackups: 50, maxTotalBackups: -1, throttleInterval: 10000, allowFullDataBackup: true },
        },
        oldBackupNames: ['chat_alice_20250101-000000.jsonl', 'chat_alice_20250102-000000.jsonl', 'chat_alice_2_20250101-000000.jsonl'],
        deleteResult: null,
        resolveResult: null,
        exportResponse: { status: 200, contentType: 'application/zip', body: Buffer.from('PK-fake-zip') },
        ...overrides,
    };
    const requests = {
        usage: [], report: [], view: [], delete: [], finalize: [],
        greetingReports: [], resolve: [],
        snapshotDeletes: [], snapshotPrunes: [],
        backupStats: [], backupDeletes: [],
        exports: [],
    };

    await mockModernWorkspace(page, fixture);
    const bridgeCalls = await mockBridgeFrame(page);

    await page.route('**/api/data-maid/usage', route => {
        requests.usage.push(postJson(route));
        return fulfillJson(route, {
            entries: [
                { key: 'chats', bytes: 7340032, files: 120 },
                { key: 'characters', bytes: 2097152, files: 33 },
                { key: 'userImages', bytes: 524288, files: 9, symlinks: 1 },
                { key: 'thumbnails', bytes: 0, files: 0 },
                { key: 'other', bytes: 4096, files: 3 },
            ],
            totalBytes: 9965568,
            totalFiles: 165,
            truncated: false,
            durationMs: 42,
            disk: { freeBytes: 53687091200, totalBytes: 107374182400 },
            limits: { maxEntries: 300000, timeoutMs: 15000 },
        });
    });
    await page.route('**/api/data-maid/report', route => {
        requests.report.push(postJson(route));
        return fulfillJson(route, { report: clone(state.report), token: `tok-${requests.report.length}` });
    });
    await page.route(/\/api\/data-maid\/view\?/u, route => {
        const url = new URL(route.request().url());
        requests.view.push({ token: url.searchParams.get('token'), hash: url.searchParams.get('hash') });
        if (url.searchParams.get('hash') === 'h-file-1') {
            return route.fulfill({ status: 200, contentType: 'text/plain', body: 'loose note content' });
        }
        return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 });
    });
    await page.route('**/api/data-maid/delete', route => {
        const body = postJson(route);
        requests.delete.push(clone(body));
        return fulfillJson(route, state.deleteResult || { deleted: body.hashes, skipped: [], freedBytes: 1234 });
    });
    await page.route('**/api/data-maid/finalize', route => {
        requests.finalize.push(postJson(route));
        return route.fulfill({ status: 204, body: '' });
    });
    await page.route('**/api/data-maid/duplicate-greetings', route => {
        requests.greetingReports.push(postJson(route));
        return fulfillJson(route, { token: `gtok-${requests.greetingReports.length}`, items: clone(state.greetings), stats: { directories: 4, legacyFiles: 6 }, truncated: false, expiresInMs: 1800000 });
    });
    await page.route('**/api/data-maid/duplicate-greetings/resolve', route => {
        const body = postJson(route);
        requests.resolve.push(clone(body));
        const result = state.resolveResult || {
            quarantine: 'backups/quarantine-20260102-030405',
            moved: body.hashes.map(hash => {
                const item = state.greetings.find(candidate => candidate.hash === hash);
                return {
                    hash,
                    avatar: item.avatar,
                    file: item.file,
                    size: item.size,
                    from: `chats/${item.avatar.replace('.png', '')}/${item.file}`,
                    to: `backups/quarantine-20260102-030405/chats/${item.avatar.replace('.png', '')}/${item.file}`,
                };
            }),
            skipped: [],
        };
        state.greetings = state.greetings.filter(item => !result.moved.some(moved => moved.hash === item.hash));
        return fulfillJson(route, result);
    });
    await page.route('**/api/settings/get-snapshots', route => fulfillJson(route, clone(state.snapshots)));
    await page.route('**/api/settings/delete-snapshot', route => {
        const body = postJson(route);
        requests.snapshotDeletes.push(clone(body));
        state.snapshots = state.snapshots.filter(snapshot => snapshot.name !== body.name);
        return fulfillJson(route, { ok: true, name: body.name, size: 1001 });
    });
    await page.route('**/api/settings/prune-snapshots', route => {
        const body = postJson(route);
        requests.snapshotPrunes.push(clone(body));
        const doomed = state.snapshots.slice(body.keep);
        if (body.dryRun === false) {
            state.snapshots = state.snapshots.slice(0, body.keep);
        }
        return fulfillJson(route, {
            dryRun: body.dryRun !== false,
            keep: body.keep,
            total: state.snapshots.length + (body.dryRun === false ? doomed.length : 0),
            kept: body.keep,
            candidates: doomed.map(({ name, size, date }) => ({ name, size, date })),
            deleted: body.dryRun === false ? doomed.map(snapshot => snapshot.name) : [],
            skipped: [],
            freedBytes: body.dryRun === false ? 2005 : 0,
        });
    });
    await page.route('**/api/backups/chat/stats', route => {
        const body = postJson(route);
        requests.backupStats.push(clone(body));
        const olderThan = body.olderThanDays
            ? { days: body.olderThanDays, cutoff: 1, files: state.oldBackupNames.length, bytes: state.oldBackupNames.length * 100, names: [...state.oldBackupNames], namesTruncated: false }
            : null;
        return fulfillJson(route, { ...clone(state.backupStats), olderThan });
    });
    await page.route('**/api/backups/chat/delete', route => {
        const body = postJson(route);
        requests.backupDeletes.push(clone(body));
        state.oldBackupNames = state.oldBackupNames.filter(name => name !== body.name);
        return route.fulfill({ status: 200, contentType: 'text/plain', body: 'OK' });
    });
    await page.route('**/api/users/backup', route => {
        requests.exports.push(postJson(route));
        return route.fulfill({
            status: state.exportResponse.status,
            contentType: state.exportResponse.contentType,
            body: state.exportResponse.body,
            headers: state.exportResponse.headers,
        });
    });

    return { fixture, state, requests, bridgeCalls };
}

async function openMaintenance(page) {
    await page.addInitScript(() => {
        localStorage.setItem('st-modern-settings-section', 'maintenance');
    });
    await gotoModern(page, 'settings', '设置中心');
    await expect(page.locator('[data-settings-section="maintenance"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-settings-maintenance]')).toBeVisible();
}

test.describe('Modern data maintenance', () => {
    test.use({ viewport: desktopViewport });

    test('shows the maintenance tab with all six sections', async ({ page }) => {
        await mockMaintenance(page);
        await openMaintenance(page);

        await expect(page.locator('.settings-tabs [data-settings-section]')).toHaveText([/界面与请求/, /账户与资源/, /设置快照/, /数据维护/, /原始设置/, /安全诊断/]);
        await expect(page.locator('[data-maintenance-section]')).toHaveCount(6);
        for (const section of ['storage', 'data-maid', 'duplicate-greetings', 'snapshots', 'chat-backups', 'export']) {
            await expect(page.locator(`[data-maintenance-section="${section}"]`)).toBeVisible();
        }
    });

    test('measures storage usage and lists the directories with sizes', async ({ page }) => {
        const { requests } = await mockMaintenance(page);
        await openMaintenance(page);
        expect(requests.usage).toHaveLength(0);

        await page.locator('[data-maintenance-load-usage]').click();

        const rows = page.locator('[data-maintenance-usage-table] tbody tr');
        await expect(rows).toHaveCount(4);
        await expect(rows.first()).toContainText('角色聊天');
        await expect(rows.first()).toContainText('7.0 MB');
        await expect(rows.first()).toContainText('120');
        await expect(page.locator('[data-maintenance-section="storage"]')).toContainText('磁盘剩余 50.0 GB / 100.0 GB');
        await expect(page.locator('[data-maintenance-section="storage"]')).toContainText('1 个空目录未列出');
        await expect(page.locator('[data-maintenance-section="storage"]')).toContainText('1 个符号链接已跳过');
        expect(requests.usage).toHaveLength(1);
    });

    test('lists unreferenced files by category, warns about images and chats, and keeps backups out of one-click delete', async ({ page }) => {
        const { requests } = await mockMaintenance(page);
        await openMaintenance(page);

        await page.locator('[data-maintenance-scan-data-maid]').click();

        await expect(page.locator('[data-maintenance-category="images"]')).toContainText('可能包含手动上传的图片');
        await expect(page.locator('[data-maintenance-category="images"] .danger-note')).toBeVisible();
        await expect(page.locator('[data-maintenance-category="chats"] .danger-note')).toContainText('完整的聊天记录');
        await expect(page.locator('[data-maintenance-category="files"] .danger-note')).toHaveCount(0);
        // The two blanket backup categories have no checkbox and point to their own sections
        for (const key of ['chatBackups', 'settingsBackups']) {
            await expect(page.locator(`[data-maintenance-category="${key}"]`)).toContainText('不在这里清理');
            await expect(page.locator(`[data-maintenance-category="${key}"] input[type="checkbox"]`)).toHaveCount(0);
        }
        await expect(page.locator('[data-maintenance-data-maid-row]')).toHaveCount(5);
        expect(requests.report).toHaveLength(1);
        expect(requests.delete).toHaveLength(0);
    });

    test('previews a file through the report token without deleting it', async ({ page }) => {
        const { requests } = await mockMaintenance(page);
        await openMaintenance(page);
        await page.locator('[data-maintenance-scan-data-maid]').click();

        await page.locator('[data-maintenance-data-maid-preview="h-img-1"]').click();
        await expect(page.locator('.maintenance-preview-image')).toBeVisible();
        await page.locator('[data-maintenance-data-maid-preview="h-file-1"]').click();
        await expect(page.locator('.maintenance-preview-text')).toContainText('loose note content');
        await page.locator('[data-maintenance-data-maid-preview-close]').click();
        await expect(page.locator('[data-maintenance-data-maid-preview-pane]')).toHaveCount(0);

        expect(requests.view).toEqual([{ token: 'tok-1', hash: 'h-img-1' }, { token: 'tok-1', hash: 'h-file-1' }]);
        expect(requests.delete).toHaveLength(0);
    });

    test('sends no delete request until the confirmation, and cancelling sends none at all', async ({ page }) => {
        const { requests } = await mockMaintenance(page);
        await openMaintenance(page);
        await page.locator('[data-maintenance-scan-data-maid]').click();

        // Nothing is selected: the delete button is disabled
        await expect(page.locator('[data-maintenance-data-maid-delete-begin]')).toBeDisabled();
        await page.locator('[data-maintenance-data-maid-category="images"]').check();
        await expect(page.locator('[data-maintenance-data-maid-selected]')).toContainText('已选 2 个');

        await page.locator('[data-maintenance-data-maid-delete-begin]').click();
        const confirmBox = page.locator('[data-maintenance-data-maid-confirm-box]');
        await expect(confirmBox).toBeVisible();
        await expect(confirmBox).toContainText('将永久删除 2 个文件');
        await expect(confirmBox).toContainText('无法恢复');
        await expect(confirmBox).toContainText('未引用的用户图片');
        await expect(confirmBox).toContainText('可能手动上传的图片');
        expect(requests.delete).toHaveLength(0);

        await page.locator('[data-maintenance-data-maid-delete-cancel]').click();
        await expect(confirmBox).toHaveCount(0);
        // Selection survives the cancel, and still nothing was sent
        await expect(page.locator('[data-maintenance-data-maid-selected]')).toContainText('已选 2 个');
        expect(requests.delete).toHaveLength(0);
        expect(requests.finalize).toHaveLength(0);
    });

    test('deletes only after confirmation, asks for details, and shows skipped files with the reason', async ({ page }) => {
        const { state, requests } = await mockMaintenance(page);
        state.deleteResult = { deleted: ['h-img-1'], skipped: [{ hash: 'h-img-2', reason: 'changed' }], freedBytes: 2048 };
        await openMaintenance(page);
        await page.locator('[data-maintenance-scan-data-maid]').click();

        await page.locator('[data-maintenance-data-maid-category="images"]').check();
        await page.locator('[data-maintenance-data-maid-delete-begin]').click();
        expect(requests.delete).toHaveLength(0);
        await page.locator('[data-maintenance-data-maid-delete-confirm]').click();

        await expect(page.locator('[data-maintenance-data-maid-result]')).toContainText('已删除 1 个文件，释放 2.0 KB');
        await expect(page.locator('[data-maintenance-data-maid-result]')).toContainText('upload-2.png：文件在扫描之后发生了变化');
        expect(requests.delete).toEqual([{ token: 'tok-1', hashes: ['h-img-1', 'h-img-2'], detailed: true }]);
        // The deleted file leaves the list; the skipped one stays, marked, and cannot be selected again
        await expect(page.locator('[data-maintenance-data-maid-row="h-img-1"]')).toHaveCount(0);
        await expect(page.locator('[data-maintenance-data-maid-row="h-img-2"]')).toContainText('文件在扫描之后发生了变化');
        await expect(page.locator('[data-maintenance-data-maid-item="h-img-2"]')).toBeDisabled();
    });

    test('never offers the backup categories to the delete request even when they are in the report', async ({ page }) => {
        const { requests } = await mockMaintenance(page);
        await openMaintenance(page);
        await page.locator('[data-maintenance-scan-data-maid]').click();

        // Select everything that can be selected
        for (const key of ['images', 'files', 'chats', 'avatarThumbnails']) {
            await page.locator(`[data-maintenance-data-maid-category="${key}"]`).check();
        }
        await page.locator('[data-maintenance-data-maid-delete-begin]').click();
        await page.locator('[data-maintenance-data-maid-delete-confirm]').click();
        await expect(page.locator('[data-maintenance-data-maid-result]')).toBeVisible();

        expect(requests.delete).toHaveLength(1);
        expect(requests.delete[0].hashes).toEqual(expect.arrayContaining(['h-img-1', 'h-img-2', 'h-file-1', 'h-chat-1', 'h-thumb-1']));
        expect(requests.delete[0].hashes).not.toContain('h-cb-1');
        expect(requests.delete[0].hashes).not.toContain('h-sb-1');
    });

    test('closes the report on the server when leaving the tab', async ({ page }) => {
        const { requests } = await mockMaintenance(page);
        await openMaintenance(page);
        await page.locator('[data-maintenance-scan-data-maid]').click();
        await expect(page.locator('[data-maintenance-category="images"]')).toBeVisible();
        expect(requests.finalize).toHaveLength(0);

        await page.locator('[data-settings-section="status"]').click();

        await expect.poll(() => requests.finalize).toEqual([{ token: 'tok-1' }]);
        await page.locator('[data-settings-section="maintenance"]').click();
        // The old report is gone; the page asks for a new scan
        await expect(page.locator('[data-maintenance-category]')).toHaveCount(0);
        await expect(page.locator('[data-maintenance-scan-data-maid]')).toContainText('开始扫描');
    });

    test('lists duplicate greeting-only chats, separating the one a card points at, and cancel moves nothing', async ({ page }) => {
        const { requests } = await mockMaintenance(page);
        await openMaintenance(page);

        await page.locator('[data-maintenance-scan-greetings]').click();

        await expect(page.locator('[data-maintenance-greeting-row]')).toHaveCount(2);
        await expect(page.locator('[data-maintenance-greeting-list] [data-maintenance-greeting-row="g-1"]')).toContainText('Hello, I am Alice.');
        await expect(page.locator('[data-maintenance-greeting-card-list] [data-maintenance-greeting-row="g-2"]')).toContainText('角色卡的「当前会话」正指向这个文件');
        await page.locator('[data-maintenance-greeting-all]').check();
        await page.locator('[data-maintenance-greeting-begin]').click();
        const confirmBox = page.locator('[data-maintenance-greeting-confirm-box]');
        await expect(confirmBox).toContainText('移到隔离目录，不会删除');
        await expect(confirmBox).toContainText('先把角色卡的「当前会话」改为对应的 Modern 会话');
        await page.locator('[data-maintenance-greeting-cancel]').click();
        await expect(confirmBox).toHaveCount(0);

        expect(requests.resolve).toHaveLength(0);
        expect(requests.greetingReports).toHaveLength(1);
    });

    test('quarantines the confirmed chats after repointing the card, and shows what moved and where', async ({ page }) => {
        const { fixture, requests, bridgeCalls } = await mockMaintenance(page);
        await openMaintenance(page);
        await page.locator('[data-maintenance-scan-greetings]').click();
        await page.locator('[data-maintenance-greeting-all]').check();
        await page.locator('[data-maintenance-greeting-begin]').click();
        expect(requests.resolve).toHaveLength(0);

        await page.locator('[data-maintenance-greeting-confirm]').click();

        const result = page.locator('[data-maintenance-greeting-result]');
        await expect(result).toContainText('已移动 2 个会话文件');
        await expect(result).toContainText('backups/quarantine-20260102-030405');
        await expect(result).toContainText('chats/Alice/Alice - 2026-07-03@18h14m24s106ms.jsonl');
        await expect(result).toContainText('backups/quarantine-20260102-030405/chats/Bruno/Bruno - 2026-07-03@18h15m00s000ms.jsonl');
        // The card that pointed at a moved chat now points at its Modern chat (without the extension), before the move
        expect(fixture.requests.characterMerge).toEqual([{ avatar: 'Bruno.png', chat: 'Modern 2026-07-03T10-14-58-000Z' }]);
        // One request moves everything; the files are named by the hashes of the report that was confirmed
        expect(requests.resolve).toEqual([{ token: 'gtok-1', hashes: ['g-1', 'g-2'] }]);
        await expect.poll(() => bridgeCalls.map(call => call.action)).toContain('reloadCharacter');
        // The list is scanned again after the move: nothing is left, and the result stays visible
        await expect(page.locator('[data-maintenance-section="duplicate-greetings"]')).toContainText('没有发现符合条件的重复会话');
        expect(requests.greetingReports).toHaveLength(2);
    });

    test('shows why a chat was skipped when the server refuses to move it', async ({ page }) => {
        const { state, requests } = await mockMaintenance(page);
        state.resolveResult = {
            quarantine: 'backups/quarantine-20260102-030405',
            moved: [{ hash: 'g-1', avatar: 'Alice.png', file: 'Alice - 2026-07-03@18h14m24s106ms.jsonl', size: 413, from: 'chats/Alice/Alice - 2026-07-03@18h14m24s106ms.jsonl', to: 'backups/quarantine-20260102-030405/chats/Alice/Alice - 2026-07-03@18h14m24s106ms.jsonl' }],
            skipped: [{ hash: 'g-2', reason: 'changed', file: 'Bruno - 2026-07-03@18h15m00s000ms.jsonl' }],
        };
        await openMaintenance(page);
        await page.locator('[data-maintenance-scan-greetings]').click();
        await page.locator('[data-maintenance-greeting-all]').check();
        await page.locator('[data-maintenance-greeting-begin]').click();
        await page.locator('[data-maintenance-greeting-confirm]').click();

        const result = page.locator('[data-maintenance-greeting-result]');
        await expect(result).toContainText('已移动 1 个会话文件，1 个跳过');
        await expect(result).toContainText('Bruno - 2026-07-03@18h15m00s000ms.jsonl：文件在扫描之后发生了变化，没有移动');
        expect(requests.resolve).toHaveLength(1);
    });

    test('deletes one settings snapshot only after confirmation and never offers the newest', async ({ page }) => {
        const { state, requests } = await mockMaintenance(page);
        await openMaintenance(page);

        const newest = page.locator(`[data-maintenance-snapshot-row="${SNAPSHOT_NAMES[0]}"]`);
        await expect(newest).toContainText('最新 · 不可删除');
        await expect(newest.locator('[data-maintenance-snapshot-delete]')).toHaveCount(0);

        const target = page.locator(`[data-maintenance-snapshot-row="${SNAPSHOT_NAMES[2]}"]`);
        await target.locator('[data-maintenance-snapshot-delete]').click();
        await expect(target.locator('[data-maintenance-snapshot-delete-confirm]')).toBeVisible();
        await target.locator('[data-maintenance-snapshot-delete-cancel]').click();
        expect(requests.snapshotDeletes).toHaveLength(0);

        await target.locator('[data-maintenance-snapshot-delete]').click();
        await target.locator('[data-maintenance-snapshot-delete-confirm]').click();

        await expect(page.locator('[data-maintenance-snapshot-result]')).toContainText('已删除 1 份快照');
        expect(requests.snapshotDeletes).toEqual([{ name: SNAPSHOT_NAMES[2] }]);
        await expect(target).toHaveCount(0);
        expect(state.snapshots).toHaveLength(3);
    });

    test('prunes old snapshots with a preview first, and a cancelled preview deletes nothing', async ({ page }) => {
        const { state, requests } = await mockMaintenance(page);
        await openMaintenance(page);

        await page.locator('[data-maintenance-snapshot-keep]').fill('2');
        await page.locator('[data-maintenance-snapshot-prune-preview]').click();
        const preview = page.locator('[data-maintenance-snapshot-prune-preview-pane]');
        await expect(preview).toContainText('将删除最旧的 2 份快照');
        await expect(preview).toContainText(SNAPSHOT_NAMES[2]);
        await expect(preview).toContainText(SNAPSHOT_NAMES[3]);
        await expect(preview).not.toContainText(SNAPSHOT_NAMES[0]);
        expect(requests.snapshotPrunes).toEqual([{ keep: 2, dryRun: true }]);

        await page.locator('[data-maintenance-snapshot-prune-cancel]').click();
        await expect(preview).toHaveCount(0);
        expect(requests.snapshotPrunes).toHaveLength(1);
        expect(state.snapshots).toHaveLength(4);

        await page.locator('[data-maintenance-snapshot-prune-preview]').click();
        await page.locator('[data-maintenance-snapshot-prune-confirm]').click();

        await expect(page.locator('[data-maintenance-snapshot-result]')).toContainText('已删除 2 份快照');
        expect(requests.snapshotPrunes[2]).toEqual({ keep: 2, dryRun: false, names: [SNAPSHOT_NAMES[2], SNAPSHOT_NAMES[3]] });
        expect(state.snapshots).toHaveLength(2);
    });

    test('rejects a keep value below 1 without asking the server', async ({ page }) => {
        const { requests } = await mockMaintenance(page);
        await openMaintenance(page);

        await page.locator('[data-maintenance-snapshot-keep]').fill('0');
        await page.locator('[data-maintenance-snapshot-prune-preview]').click();

        await expect(page.locator('[data-maintenance-snapshot-error]')).toContainText('不小于 1 的整数');
        expect(requests.snapshotPrunes).toHaveLength(0);
    });

    test('shows chat backup statistics with the effective configuration', async ({ page }) => {
        const { requests } = await mockMaintenance(page);
        await openMaintenance(page);

        await page.locator('[data-maintenance-load-backup-stats]').click();

        await expect(page.locator('[data-maintenance-backup-summary]')).toContainText('共 5 个备份');
        await expect(page.locator('[data-maintenance-backup-config]')).toContainText('每个系列保留 50 个');
        await expect(page.locator('[data-maintenance-backup-config]')).toContainText('总数上限不限制');
        // alice and alice_2 are separate series
        await expect(page.locator('[data-maintenance-backup-table] tbody tr')).toHaveCount(2);
        expect(requests.backupStats).toEqual([{}]);
    });

    test('previews old chat backups and deletes them one by one only after confirmation', async ({ page }) => {
        const { requests } = await mockMaintenance(page);
        await openMaintenance(page);
        await page.locator('[data-maintenance-load-backup-stats]').click();

        await page.locator('[data-maintenance-backup-days]').fill('30');
        await page.locator('[data-maintenance-backup-prune-preview]').click();
        const preview = page.locator('[data-maintenance-backup-prune-preview-pane]');
        await expect(preview).toContainText('30 天前的备份共 3 个');
        await expect(preview).toContainText('chat_alice_2_20250101-000000.jsonl');
        expect(requests.backupDeletes).toHaveLength(0);

        await page.locator('[data-maintenance-backup-prune-cancel]').click();
        await expect(preview).toHaveCount(0);
        expect(requests.backupDeletes).toHaveLength(0);

        await page.locator('[data-maintenance-backup-prune-preview]').click();
        await page.locator('[data-maintenance-backup-prune-confirm]').click();

        await expect(page.locator('[data-maintenance-backup-result]')).toContainText('已删除 3 个 30 天前的备份');
        expect(requests.backupDeletes.map(body => body.name)).toEqual(['chat_alice_20250101-000000.jsonl', 'chat_alice_20250102-000000.jsonl', 'chat_alice_2_20250101-000000.jsonl']);
        // The delete re-reads the list first: preview, cancel, preview, then the re-read before deleting
        expect(requests.backupStats.map(body => body.olderThanDays)).toEqual([undefined, 30, 30, 30, undefined]);
    });

    test('only deletes backups that are still old when confirmed', async ({ page }) => {
        const { state, requests } = await mockMaintenance(page);
        await openMaintenance(page);
        await page.locator('[data-maintenance-load-backup-stats]').click();
        await page.locator('[data-maintenance-backup-prune-preview]').click();
        await expect(page.locator('[data-maintenance-backup-prune-preview-pane]')).toContainText('共 3 个');
        // Another process removed one of them between the preview and the confirmation
        state.oldBackupNames = state.oldBackupNames.slice(1);

        await page.locator('[data-maintenance-backup-prune-confirm]').click();

        await expect(page.locator('[data-maintenance-backup-result]')).toContainText('已删除 2 个');
        await expect(page.locator('[data-maintenance-backup-result]')).toContainText('1 个在删除前已不满足条件');
        expect(requests.backupDeletes.map(body => body.name)).toEqual(['chat_alice_20250102-000000.jsonl', 'chat_alice_2_20250101-000000.jsonl']);
    });

    test('says that the export is switched off in the configuration on a 403', async ({ page }) => {
        const { state, requests } = await mockMaintenance(page);
        state.exportResponse = { status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Full data backup is disabled' }) };
        await openMaintenance(page);

        await page.locator('[data-maintenance-export]').click();

        await expect(page.locator('[data-maintenance-export-error]')).toContainText('已在配置中关闭');
        expect(requests.exports).toEqual([{ handle: 'modern-user' }]);
    });

    test('downloads the zip when the export is allowed', async ({ page }) => {
        const { requests } = await mockMaintenance(page);
        await openMaintenance(page);

        const downloadPromise = page.waitForEvent('download');
        await page.locator('[data-maintenance-export]').click();
        const download = await downloadPromise;

        expect(download.suggestedFilename()).toMatch(/^user-data-modern-user-.*\.zip$/);
        await expect(page.locator('[data-maintenance-section="export"]')).toContainText('已保存：user-data-modern-user-');
        expect(requests.exports).toEqual([{ handle: 'modern-user' }]);
    });

    test('reports a refused export that is not the configuration switch differently', async ({ page }) => {
        const { state } = await mockMaintenance(page);
        state.exportResponse = { status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthorized' }) };
        await openMaintenance(page);

        await page.locator('[data-maintenance-export]').click();

        await expect(page.locator('[data-maintenance-export-error]')).toContainText('没有导出这份数据的权限');
        await expect(page.locator('[data-maintenance-export-error]')).not.toContainText('已在配置中关闭');
    });
});
