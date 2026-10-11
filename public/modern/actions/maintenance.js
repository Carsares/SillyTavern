import { downloadFile, stripJsonlExtension } from '../core/utils.js';
import { describeReloadFailure } from '../core/bridge-reload.js';

/**
 * 设置页「数据维护」标签（B4）的业务动作。所有删除类动作遵守同一套规则：先列明细、默认只预览、
 * 带 token 和文件身份校验、必须经过一次明确的确认步骤（begin → confirm），失败按条目报告。
 * 状态都放在 state.maintenance 下，由 ensureMaintenanceState 一次性建出。
 */

/** 一个类别最多渲染、可全选的条目数。超过的部分不会被「全选」选中，需要分批清理。 */
export const DATA_MAID_MAX_ROWS = 500;

/** 扫描报告的有效时间：超过之后要重新扫描才能删除或移动，避免按一份过期的明细操作。 */
export const REPORT_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Data Maid 报告的 9 个类别。managedElsewhere 的类别在本页另有专门分区，不提供一键勾选删除。
 * danger 的类别会整份删除用户内容（图片、聊天文件），界面上用红色警告。
 */
export const DATA_MAID_CATEGORIES = Object.freeze([
    {
        key: 'images',
        label: '未引用的用户图片',
        hint: '用户图片目录里，没有被任何聊天消息或聊天背景引用的文件。',
        warning: '可能包含手动上传的图片。这里只能判断「没有聊天引用它」，不能判断它是不是你想留的素材，删除后无法恢复。',
        danger: true,
    },
    {
        key: 'files',
        label: '未引用的聊天附件',
        hint: '附件目录里，没有被聊天、角色附件或全局附件引用的文件。',
    },
    {
        key: 'chats',
        label: '没有角色卡的角色聊天',
        hint: '聊天目录里找不到对应角色卡的会话文件，通常来自已删除或改名的角色。',
        warning: '这些是完整的聊天记录文件，删除后无法恢复。如果角色只是被移走了，先把角色卡放回去。',
        danger: true,
    },
    {
        key: 'groupChats',
        label: '没有群组引用的群聊',
        hint: '群聊目录里，没有被任何群组登记的聊天文件。',
        warning: '这些是完整的聊天记录文件，删除后无法恢复。',
        danger: true,
    },
    { key: 'avatarThumbnails', label: '多余的角色头像缩略图', hint: '对应角色已不存在的缩略图，可自动重新生成。' },
    { key: 'backgroundThumbnails', label: '多余的背景缩略图', hint: '对应背景已不存在的缩略图，可自动重新生成。' },
    { key: 'personaThumbnails', label: '多余的用户头像缩略图', hint: '对应用户头像已不存在的缩略图，可自动重新生成。' },
    { key: 'chatBackups', label: '聊天备份', managedElsewhere: '请在下方「聊天备份」分区按天数清理，那里有统计和预览。' },
    { key: 'settingsBackups', label: '设置快照', managedElsewhere: '请在下方「设置快照」分区清理，那里不会提供删除最新快照的入口。' },
]);

const DATA_MAID_SKIP_TEXT = Object.freeze({
    changed: '文件在扫描之后发生了变化，没有删除',
    referenced: '文件现在被引用了，没有删除',
    missing: '文件已经不存在',
    outside: '路径不在用户目录内，没有删除',
    unknown: '这一项已处理过，或不在当前报告里',
    failed: '删除失败（文件可能被占用）',
});

const GREETING_SKIP_TEXT = Object.freeze({
    changed: '文件在扫描之后发生了变化，没有移动',
    missing: '文件已经不存在',
    outside: '路径不在聊天目录内，没有移动',
    unknown: '这一项已处理过，或不在当前报告里',
    failed: '移动失败（文件可能被占用）',
    'card-chat': '角色卡仍指向这个会话，没有移动',
    'repoint-failed': '改写角色卡的当前会话失败，没有移动',
    'no-modern-sibling': '找不到时间相近的 Modern 会话了，没有移动',
    'message-count': '会话里已有别的内容，没有移动',
    'not-greeting': '会话内容已不是纯开场白，没有移动',
    metadata: '会话设置里出现了用户数据，没有移动',
    'media-or-extra': '会话里出现了附件或其他内容，没有移动',
    'modern-source': '会话已被 Modern 写入，没有移动',
    'user-or-system': '会话里出现了用户或系统消息，没有移动',
    'no-character': '角色卡已不存在，没有移动',
    'name-mismatch': '文件名与角色卡名称不一致，没有移动',
    busy: '这个会话正在被界面使用，没有移动',
});

export function describeDataMaidSkip(reason) {
    return DATA_MAID_SKIP_TEXT[reason] || `未删除（${reason}）`;
}

export function describeGreetingSkip(reason) {
    return GREETING_SKIP_TEXT[reason] || `未移动（${reason}）`;
}

function createInitialMaintenanceState() {
    return {
        storage: { loading: false, loaded: false, error: '', data: null },
        dataMaid: {
            loading: false,
            error: '',
            token: '',
            scannedAt: 0,
            report: null,
            selected: /** @type {string[]} */ ([]),
            expanded: /** @type {string[]} */ ([]),
            skipped: /** @type {Record<string, string>} */ ({}),
            preview: /** @type {any} */ (null),
            confirming: false,
            deleting: false,
            result: /** @type {any} */ (null),
        },
        greetings: {
            loading: false,
            error: '',
            token: '',
            scannedAt: 0,
            items: /** @type {any[] | null} */ (null),
            stats: /** @type {any} */ (null),
            truncated: false,
            selected: /** @type {string[]} */ ([]),
            confirming: false,
            resolving: false,
            result: /** @type {any} */ (null),
        },
        snapshots: {
            keep: 20,
            previewing: false,
            preview: /** @type {any} */ (null),
            confirmDelete: '',
            deleting: '',
            pruning: false,
            error: '',
            result: /** @type {any} */ (null),
        },
        chatBackups: {
            loading: false,
            error: '',
            stats: /** @type {any} */ (null),
            days: 30,
            previewing: false,
            preview: /** @type {any} */ (null),
            deleting: false,
            progress: '',
            result: /** @type {any} */ (null),
        },
        exporting: { busy: false, error: '', done: '' },
    };
}

/**
 * state.maintenance 在 core/state.js 里只是个空对象骨架；第一次用到时在这里补齐各分区的状态。
 * @param {any} state 全局界面状态。
 * @returns {ReturnType<typeof createInitialMaintenanceState>} 数据维护页状态。
 */
export function ensureMaintenanceState(state) {
    if (!state.maintenance || typeof state.maintenance !== 'object') {
        state.maintenance = {};
    }
    if (!state.maintenance.storage) {
        Object.assign(state.maintenance, createInitialMaintenanceState());
    }
    return state.maintenance;
}

/** 隔离会话时，某个会话没有被移动：它的聊天文件保护要解除，但这不是一个需要向上报告的错误。 */
class ChatFileUnchangedSignal extends Error { }

function toErrorMessage(error) {
    return error?.message || String(error);
}

/**
 * @param {import('../shell/feature-slot-actions.js').FeatureSlotDeps} deps 见 shell/feature-slot-actions.js。
 * @returns {Record<string, any>} 并入路由上下文的动作，名字都以 maintenance 开头。
 */
export function createMaintenanceActions({ state, apiFetch, apiFetchResponse, loadData, render, showToast, bridgeReload, actionRegistry }) {
    const maintenance = () => ensureMaintenanceState(state);
    const chatContext = () => actionRegistry?.chatContextActions || {};

    function assertReportFresh(scannedAt) {
        if (!scannedAt || Date.now() - scannedAt > REPORT_MAX_AGE_MS) {
            throw new Error('扫描报告已超过 10 分钟，请重新扫描后再操作。');
        }
    }

    function assertNotGenerating(what) {
        if (state.engine?.generating) {
            throw new Error(`正在生成回复，不能${what}。请等生成结束或先停止生成。`);
        }
    }

    // ---------------------------------------------------------------- 存储占用

    async function maintenanceLoadUsage() {
        const storage = maintenance().storage;
        if (storage.loading) {
            return;
        }
        storage.loading = true;
        storage.error = '';
        render();
        try {
            storage.data = await apiFetch('/api/data-maid/usage', { body: {} });
            storage.loaded = true;
        } catch (error) {
            storage.error = `读取存储占用失败：${toErrorMessage(error)}`;
        } finally {
            storage.loading = false;
            render();
        }
    }

    // ---------------------------------------------------------------- 未引用文件清理（Data Maid）

    function revokeDataMaidPreview() {
        const preview = maintenance().dataMaid.preview;
        if (preview?.url) {
            URL.revokeObjectURL(preview.url);
        }
        maintenance().dataMaid.preview = null;
    }

    function getDisplayedRows(category) {
        const rows = maintenance().dataMaid.report?.[category] || [];
        return rows.slice(0, DATA_MAID_MAX_ROWS);
    }

    async function maintenanceScanDataMaid() {
        const dataMaid = maintenance().dataMaid;
        if (dataMaid.loading || dataMaid.deleting) {
            return;
        }
        dataMaid.loading = true;
        dataMaid.error = '';
        render();
        try {
            // 新的报告会让服务器作废旧 token，所以先丢掉本地的旧报告
            revokeDataMaidPreview();
            const result = await apiFetch('/api/data-maid/report', { body: {} });
            dataMaid.token = result.token;
            dataMaid.report = result.report;
            dataMaid.scannedAt = Date.now();
            dataMaid.selected = [];
            dataMaid.skipped = {};
            dataMaid.confirming = false;
            dataMaid.result = null;
            dataMaid.expanded = DATA_MAID_CATEGORIES.filter(category => !category.managedElsewhere && result.report?.[category.key]?.length).map(category => category.key);
        } catch (error) {
            dataMaid.error = `扫描失败：${toErrorMessage(error)}`;
        } finally {
            dataMaid.loading = false;
            render();
        }
    }

    function maintenanceToggleDataMaidItem(hash, checked) {
        const dataMaid = maintenance().dataMaid;
        const selected = new Set(dataMaid.selected);
        if (checked) {
            selected.add(hash);
        } else {
            selected.delete(hash);
        }
        dataMaid.selected = [...selected];
        dataMaid.confirming = false;
        render();
    }

    function maintenanceToggleDataMaidCategory(category, checked) {
        const dataMaid = maintenance().dataMaid;
        if (DATA_MAID_CATEGORIES.find(info => info.key === category)?.managedElsewhere) {
            return;
        }
        const hashes = getDisplayedRows(category).filter(row => !dataMaid.skipped[row.hash]).map(row => row.hash);
        const selected = new Set(dataMaid.selected);
        for (const hash of hashes) {
            if (checked) {
                selected.add(hash);
            } else {
                selected.delete(hash);
            }
        }
        dataMaid.selected = [...selected];
        dataMaid.confirming = false;
        render();
    }

    function maintenanceToggleDataMaidExpand(category) {
        const dataMaid = maintenance().dataMaid;
        dataMaid.expanded = dataMaid.expanded.includes(category)
            ? dataMaid.expanded.filter(key => key !== category)
            : [...dataMaid.expanded, category];
        render();
    }

    async function maintenancePreviewDataMaidItem(hash) {
        const dataMaid = maintenance().dataMaid;
        if (!dataMaid.token || !hash) {
            return;
        }
        revokeDataMaidPreview();
        dataMaid.preview = { hash, loading: true, kind: '', text: '', url: '', error: '' };
        render();
        try {
            const response = await apiFetchResponse(`/api/data-maid/view?token=${encodeURIComponent(dataMaid.token)}&hash=${encodeURIComponent(hash)}`, { method: 'GET' });
            const blob = await response.blob();
            if (dataMaid.preview?.hash !== hash) {
                return;
            }
            const type = blob.type || response.headers?.get?.('content-type') || '';
            if (type.startsWith('image/')) {
                dataMaid.preview = { hash, loading: false, kind: 'image', text: '', url: URL.createObjectURL(blob), error: '', size: blob.size };
            } else if (type.startsWith('text/') || type.includes('json') || type.includes('xml')) {
                const text = await blob.text();
                dataMaid.preview = { hash, loading: false, kind: 'text', text: text.slice(0, 6000), truncated: text.length > 6000, url: '', error: '', size: blob.size };
            } else {
                dataMaid.preview = { hash, loading: false, kind: 'binary', text: '', url: '', error: '', size: blob.size, type };
            }
        } catch (error) {
            if (dataMaid.preview?.hash === hash) {
                dataMaid.preview = { hash, loading: false, kind: '', text: '', url: '', error: error?.status === 404 ? '文件已变化或不存在，无法预览。' : `预览失败：${toErrorMessage(error)}` };
            }
        } finally {
            render();
        }
    }

    function maintenanceCloseDataMaidPreview() {
        revokeDataMaidPreview();
        render();
    }

    function maintenanceBeginDataMaidDelete() {
        const dataMaid = maintenance().dataMaid;
        if (!dataMaid.selected.length) {
            throw new Error('请先勾选要删除的文件。');
        }
        assertNotGenerating('清理文件');
        assertReportFresh(dataMaid.scannedAt);
        dataMaid.confirming = true;
        render();
    }

    function maintenanceCancelDataMaidDelete() {
        maintenance().dataMaid.confirming = false;
        render();
    }

    async function maintenanceConfirmDataMaidDelete() {
        const dataMaid = maintenance().dataMaid;
        if (!dataMaid.confirming) {
            throw new Error('请先点「删除所选」并确认。');
        }
        assertNotGenerating('清理文件');
        assertReportFresh(dataMaid.scannedAt);
        const excluded = new Set(DATA_MAID_CATEGORIES.filter(category => category.managedElsewhere).map(category => category.key));
        const rowsByHash = new Map();
        for (const [category, rows] of Object.entries(dataMaid.report || {})) {
            if (!excluded.has(category)) {
                for (const row of /** @type {any[]} */ (rows)) {
                    rowsByHash.set(row.hash, { ...row, category });
                }
            }
        }
        const hashes = dataMaid.selected.filter(hash => rowsByHash.has(hash));
        if (!hashes.length) {
            throw new Error('没有可删除的勾选项。');
        }

        dataMaid.deleting = true;
        render();
        try {
            const result = await apiFetch('/api/data-maid/delete', { body: { token: dataMaid.token, hashes, detailed: true } });
            if (!result || !Array.isArray(result.deleted)) {
                throw new Error('服务器没有返回删除明细，请重新扫描确认结果。');
            }

            const deleted = new Set(result.deleted);
            const skipped = /** @type {{ hash: string, reason: string }[]} */ (result.skipped || []);
            for (const [category, rows] of Object.entries(dataMaid.report || {})) {
                dataMaid.report[category] = /** @type {any[]} */ (rows).filter(row => !deleted.has(row.hash));
            }
            for (const entry of skipped) {
                dataMaid.skipped[entry.hash] = entry.reason;
            }
            dataMaid.selected = [];
            dataMaid.result = {
                deleted: result.deleted.map(hash => rowsByHash.get(hash)?.name || hash),
                skipped: skipped.map(entry => ({ name: rowsByHash.get(entry.hash)?.name || entry.hash, category: rowsByHash.get(entry.hash)?.category || '', reason: entry.reason })),
                freedBytes: Number(result.freedBytes) || 0,
            };
            showToast('清理完成', `已删除 ${result.deleted.length} 个文件${skipped.length ? `，${skipped.length} 个未删除` : ''}。`);
        } finally {
            dataMaid.deleting = false;
            dataMaid.confirming = false;
            render();
        }
    }

    /**
     * 结束本次报告：通知服务器作废 token，并清掉本地报告。离开数据维护标签时由面板调用；不等待结果，失败无所谓
     * （token 只是一次性凭证，服务器重启或下次生成新报告时也会作废）。
     * @param {{ quiet?: boolean }} [options] quiet 为真时不触发重新渲染（在渲染过程中调用）。
     */
    function maintenanceReleaseDataMaid({ quiet = false } = {}) {
        const dataMaid = maintenance().dataMaid;
        const token = dataMaid.token;
        revokeDataMaidPreview();
        dataMaid.token = '';
        dataMaid.report = null;
        dataMaid.selected = [];
        dataMaid.skipped = {};
        dataMaid.confirming = false;
        dataMaid.result = null;
        dataMaid.scannedAt = 0;
        if (token) {
            apiFetch('/api/data-maid/finalize', { body: { token } }).catch(() => {});
        }
        if (!quiet) {
            render();
        }
    }

    // ---------------------------------------------------------------- 重复的仅开场白会话

    async function maintenanceScanDuplicateGreetings({ keepResult = false } = {}) {
        const greetings = maintenance().greetings;
        if (greetings.loading || greetings.resolving) {
            return;
        }
        greetings.loading = true;
        greetings.error = '';
        render();
        try {
            const result = await apiFetch('/api/data-maid/duplicate-greetings', { body: {} });
            greetings.token = result.token;
            greetings.items = result.items || [];
            greetings.stats = result.stats || null;
            greetings.truncated = !!result.truncated;
            greetings.scannedAt = Date.now();
            greetings.selected = [];
            greetings.confirming = false;
            if (!keepResult) {
                greetings.result = null;
            }
        } catch (error) {
            greetings.error = `扫描失败：${toErrorMessage(error)}`;
        } finally {
            greetings.loading = false;
            render();
        }
    }

    function maintenanceToggleGreetingItem(hash, checked) {
        const greetings = maintenance().greetings;
        const selected = new Set(greetings.selected);
        if (checked) {
            selected.add(hash);
        } else {
            selected.delete(hash);
        }
        greetings.selected = [...selected];
        greetings.confirming = false;
        render();
    }

    function maintenanceToggleAllGreetings(checked) {
        const greetings = maintenance().greetings;
        greetings.selected = checked ? (greetings.items || []).map(item => item.hash) : [];
        greetings.confirming = false;
        render();
    }

    function maintenanceBeginGreetingResolve() {
        const greetings = maintenance().greetings;
        if (!greetings.selected.length) {
            throw new Error('请先勾选要隔离的会话。');
        }
        assertNotGenerating('整理聊天文件');
        assertReportFresh(greetings.scannedAt);
        greetings.confirming = true;
        render();
    }

    function maintenanceCancelGreetingResolve() {
        maintenance().greetings.confirming = false;
        render();
    }

    /**
     * 对一批会话文件同时加上聊天文件保护（和删除、重命名聊天用同一套），再用一次请求把它们移进同一个隔离目录。
     * 没有被移动的会话立即解除保护；结果不明的（网络错误等）保护保持，直到刷新页面。
     */
    async function resolveWithChatFileBarriers(items, token) {
        const { deleteModernChatFile } = chatContext();
        let response = null;
        let failure = null;
        let failureLeavesFilesUnchanged = false;

        async function run(index) {
            if (index >= items.length) {
                try {
                    response = await apiFetch('/api/data-maid/duplicate-greetings/resolve', { body: { token, hashes: items.map(item => item.hash) } });
                } catch (error) {
                    failure = error;
                    failureLeavesFilesUnchanged = error?.status === 400;
                }
                return;
            }

            const item = items[index];
            const chatId = stripJsonlExtension(item.file);
            const operation = async ({ confirmUnchanged } = /** @type {{ confirmUnchanged?: () => void }} */ ({})) => {
                await run(index + 1);
                const moved = new Set((response?.moved || []).map(entry => entry.hash));
                if (moved.has(item.hash)) {
                    return;
                }
                if (!failure || failureLeavesFilesUnchanged) {
                    confirmUnchanged?.();
                }
                throw new ChatFileUnchangedSignal();
            };

            try {
                if (typeof deleteModernChatFile === 'function') {
                    await deleteModernChatFile(item.avatar, chatId, operation);
                } else {
                    await operation();
                }
            } catch (error) {
                if (!(error instanceof ChatFileUnchangedSignal)) {
                    throw error;
                }
            }
        }

        await run(0);
        if (failure) {
            throw failure;
        }
        return response;
    }

    function invalidateMovedChat(avatar, file) {
        const { getChatCacheKey, deleteChatReadState, getChatId } = chatContext();
        const chatId = stripJsonlExtension(file);
        const cacheKey = getChatCacheKey ? getChatCacheKey(avatar, chatId) : `${avatar}::${chatId}`;
        delete state.chatMessages[cacheKey];
        delete state.chatMessageLimits?.[cacheKey];
        delete state.chatMetadata[cacheKey];
        delete state.chatDrafts?.[cacheKey];
        if (Array.isArray(state.chatLists?.[avatar])) {
            state.chatLists[avatar] = state.chatLists[avatar].filter(chat => (getChatId ? getChatId(chat) : stripJsonlExtension(chat?.file_id || chat?.file_name || '')) !== chatId);
        }
        deleteChatReadState?.(avatar, chatId);
        if (state.selected.character === avatar && state.selected.chat === chatId) {
            state.selected.chat = '';
        }
    }

    async function maintenanceConfirmGreetingResolve() {
        const greetings = maintenance().greetings;
        if (!greetings.confirming) {
            throw new Error('请先点「隔离所选」并确认。');
        }
        assertNotGenerating('整理聊天文件');
        assertReportFresh(greetings.scannedAt);
        const chosen = (greetings.items || []).filter(item => greetings.selected.includes(item.hash));
        if (!chosen.length) {
            throw new Error('没有可隔离的勾选项。');
        }

        greetings.resolving = true;
        render();
        const skipped = [];
        const repointed = [];
        let moved = [];
        let quarantine = '';
        let manifestError = '';
        try {
            // 角色卡当前指向的会话：先把指向改到对应的 Modern 会话，服务器才会同意移动它
            const movable = [];
            for (const item of chosen) {
                if (!item.isCardChat) {
                    movable.push(item);
                    continue;
                }
                try {
                    await apiFetch('/api/characters/merge-attributes', { body: { avatar: item.avatar, chat: stripJsonlExtension(item.modern.file) } });
                    repointed.push(item);
                    movable.push(item);
                } catch (error) {
                    skipped.push({ hash: item.hash, file: item.file, reason: 'repoint-failed', detail: toErrorMessage(error) });
                }
            }

            if (movable.length) {
                let response;
                try {
                    response = await resolveWithChatFileBarriers(movable, greetings.token);
                } catch (error) {
                    const reasonText = String(error?.message || '').includes('正在变更') ? 'busy' : 'failed';
                    for (const item of movable) {
                        skipped.push({ hash: item.hash, file: item.file, reason: reasonText, detail: toErrorMessage(error) });
                    }
                }
                if (response) {
                    moved = response.moved || [];
                    quarantine = response.quarantine || '';
                    manifestError = response.manifestError || '';
                    for (const entry of response.skipped || []) {
                        const item = movable.find(candidate => candidate.hash === entry.hash);
                        skipped.push({ hash: entry.hash, file: entry.file || item?.file || '', reason: entry.reason });
                    }
                }
            }

            for (const entry of moved) {
                invalidateMovedChat(entry.avatar, entry.file);
            }

            let syncNote = '';
            if (repointed.length) {
                await loadData({ silent: true });
                syncNote = describeReloadFailure(await bridgeReload.reloadCharacter());
            }

            greetings.result = { moved, skipped, quarantine, manifestError, repointed: repointed.map(item => item.file), syncNote };
            showToast('隔离完成', `已移动 ${moved.length} 个会话文件${skipped.length ? `，${skipped.length} 个跳过` : ''}${syncNote}`);
        } finally {
            greetings.resolving = false;
            greetings.confirming = false;
            render();
        }

        // 报告里的 token 已被消耗，重新扫描得到当前状态（保留刚才的结果提示）
        await maintenanceScanDuplicateGreetings({ keepResult: true });
    }

    // ---------------------------------------------------------------- 设置快照

    async function maintenanceLoadSnapshots() {
        try {
            await actionRegistry.settingsActions.loadSettingsSnapshots({ force: true });
        } catch (error) {
            maintenance().snapshots.error = `读取设置快照失败：${toErrorMessage(error)}`;
        }
        render();
    }

    function maintenanceSetSnapshotKeep(value) {
        const snapshots = maintenance().snapshots;
        snapshots.keep = value;
        // 保留数量变了，之前的预览就不再对应
        snapshots.preview = null;
    }

    function maintenanceBeginSnapshotDelete(name) {
        const snapshots = maintenance().snapshots;
        snapshots.confirmDelete = name;
        snapshots.result = null;
        snapshots.error = '';
        render();
    }

    function maintenanceCancelSnapshotDelete() {
        maintenance().snapshots.confirmDelete = '';
        render();
    }

    async function maintenanceConfirmSnapshotDelete() {
        const snapshots = maintenance().snapshots;
        const name = snapshots.confirmDelete;
        if (!name) {
            throw new Error('请先选择要删除的快照。');
        }
        snapshots.deleting = name;
        snapshots.error = '';
        render();
        try {
            const result = await apiFetch('/api/settings/delete-snapshot', { body: { name } });
            snapshots.result = { kind: 'deleted', names: [name], freedBytes: Number(result?.size) || 0 };
            showToast('快照已删除', name);
        } catch (error) {
            snapshots.error = error?.status === 409
                ? '最新的快照不能删除，它是恢复设置的最后保障。'
                : `删除快照失败：${toErrorMessage(error)}`;
        } finally {
            snapshots.deleting = '';
            snapshots.confirmDelete = '';
            await actionRegistry.settingsActions.loadSettingsSnapshots({ force: true }).catch(() => {});
            snapshots.preview = null;
            render();
        }
    }

    async function maintenancePreviewSnapshotPrune() {
        const snapshots = maintenance().snapshots;
        const keep = Number(snapshots.keep);
        if (!Number.isInteger(keep) || keep < 1) {
            snapshots.error = '保留数量必须是不小于 1 的整数。';
            render();
            return;
        }
        snapshots.previewing = true;
        snapshots.error = '';
        snapshots.result = null;
        render();
        try {
            snapshots.preview = await apiFetch('/api/settings/prune-snapshots', { body: { keep, dryRun: true } });
        } catch (error) {
            snapshots.error = `预览失败：${toErrorMessage(error)}`;
        } finally {
            snapshots.previewing = false;
            render();
        }
    }

    function maintenanceCancelSnapshotPrune() {
        maintenance().snapshots.preview = null;
        render();
    }

    async function maintenanceConfirmSnapshotPrune() {
        const snapshots = maintenance().snapshots;
        const preview = snapshots.preview;
        if (!preview || !preview.candidates?.length) {
            throw new Error('请先预览要清理的快照。');
        }
        snapshots.pruning = true;
        snapshots.error = '';
        render();
        try {
            // 只删用户在预览里看到的那几份，之后新产生的快照不会被卷进来
            const result = await apiFetch('/api/settings/prune-snapshots', {
                body: { keep: preview.keep, dryRun: false, names: preview.candidates.map(item => item.name) },
            });
            snapshots.result = { kind: 'pruned', names: result.deleted || [], skipped: result.skipped || [], freedBytes: Number(result.freedBytes) || 0 };
            showToast('快照已清理', `删除了 ${(result.deleted || []).length} 份。`);
        } catch (error) {
            snapshots.error = `清理失败：${toErrorMessage(error)}`;
        } finally {
            snapshots.pruning = false;
            snapshots.preview = null;
            await actionRegistry.settingsActions.loadSettingsSnapshots({ force: true }).catch(() => {});
            render();
        }
    }

    // ---------------------------------------------------------------- 聊天备份

    async function maintenanceLoadChatBackupStats() {
        const backups = maintenance().chatBackups;
        if (backups.loading) {
            return;
        }
        backups.loading = true;
        backups.error = '';
        render();
        try {
            backups.stats = await apiFetch('/api/backups/chat/stats', { body: {} });
        } catch (error) {
            backups.error = `读取备份统计失败：${toErrorMessage(error)}`;
        } finally {
            backups.loading = false;
            render();
        }
    }

    function maintenanceSetChatBackupDays(value) {
        const backups = maintenance().chatBackups;
        backups.days = value;
        backups.preview = null;
    }

    async function maintenancePreviewChatBackupPrune() {
        const backups = maintenance().chatBackups;
        const days = Number(backups.days);
        if (!Number.isInteger(days) || days < 1) {
            backups.error = '天数必须是不小于 1 的整数。';
            render();
            return;
        }
        backups.previewing = true;
        backups.error = '';
        backups.result = null;
        render();
        try {
            const result = await apiFetch('/api/backups/chat/stats', { body: { olderThanDays: days } });
            backups.stats = result;
            backups.preview = { days, ...result.olderThan };
        } catch (error) {
            backups.error = `预览失败：${toErrorMessage(error)}`;
        } finally {
            backups.previewing = false;
            render();
        }
    }

    function maintenanceCancelChatBackupPrune() {
        maintenance().chatBackups.preview = null;
        render();
    }

    async function maintenanceConfirmChatBackupPrune() {
        const backups = maintenance().chatBackups;
        const preview = backups.preview;
        if (!preview || !preview.names?.length) {
            throw new Error('请先预览要删除的备份。');
        }
        backups.deleting = true;
        backups.error = '';
        backups.progress = '';
        render();
        const deleted = [];
        const failed = [];
        try {
            // 删除前再读一遍：只删仍然满足条件、并且用户在预览里看到过的备份
            const fresh = await apiFetch('/api/backups/chat/stats', { body: { olderThanDays: preview.days } });
            const stillOld = new Set(fresh.olderThan?.names || []);
            const names = preview.names.filter(name => stillOld.has(name));
            for (const [index, name] of names.entries()) {
                try {
                    await apiFetch('/api/backups/chat/delete', { body: { name } });
                    deleted.push(name);
                } catch (error) {
                    failed.push({ name, message: toErrorMessage(error) });
                }
                if (index % 20 === 19) {
                    backups.progress = `已处理 ${index + 1} / ${names.length}`;
                    render();
                }
            }
            if (state.chatBackups?.items?.length) {
                const removed = new Set(deleted);
                state.chatBackups.items = state.chatBackups.items.filter(item => !removed.has(item.file_name));
            }
            backups.result = { days: preview.days, deleted, failed, skippedChanged: preview.names.length - names.length };
            showToast('备份已清理', `删除了 ${deleted.length} 个${failed.length ? `，${failed.length} 个失败` : ''}。`);
        } catch (error) {
            backups.error = `清理失败：${toErrorMessage(error)}`;
        } finally {
            backups.deleting = false;
            backups.progress = '';
            backups.preview = null;
            render();
            await maintenanceLoadChatBackupStats();
        }
    }

    // ---------------------------------------------------------------- 全量导出

    async function maintenanceExportUserData() {
        const exporting = maintenance().exporting;
        if (exporting.busy) {
            return;
        }
        exporting.busy = true;
        exporting.error = '';
        exporting.done = '';
        render();
        try {
            let handle = state.me?.handle;
            if (!handle) {
                handle = (await apiFetch('/api/users/me', { method: 'GET' }))?.handle;
            }
            if (!handle) {
                throw new Error('读取不到当前账号。');
            }

            // 这里要看到 403 的具体原因，而公共请求客户端会把所有 403 都当成登录失效，所以直接发请求
            const csrf = await apiFetch('/csrf-token', { method: 'GET' });
            const response = await fetch('/api/users/backup', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf?.token || '' },
                body: JSON.stringify({ handle }),
            });
            if (response.status === 403) {
                const body = await response.json().catch(() => ({}));
                exporting.error = body?.error === 'Full data backup is disabled'
                    ? '服务器已在配置中关闭完整数据导出（backups.allowFullDataBackup = false），需要管理员在 config.yaml 里开启。'
                    : '导出被拒绝：当前账号没有导出这份数据的权限。';
                return;
            }
            if (!response.ok) {
                throw new Error(`服务器返回 ${response.status}`);
            }

            const blob = await response.blob();
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName = `user-data-${handle}-${stamp}.zip`;
            downloadFile(blob, fileName, 'application/zip');
            exporting.done = `${fileName}（${blob.size} 字节）`;
            showToast('导出完成', fileName);
        } catch (error) {
            exporting.error = `导出失败：${toErrorMessage(error)}`;
        } finally {
            exporting.busy = false;
            render();
        }
    }

    return {
        maintenanceLoadUsage,
        maintenanceScanDataMaid,
        maintenanceToggleDataMaidItem,
        maintenanceToggleDataMaidCategory,
        maintenanceToggleDataMaidExpand,
        maintenancePreviewDataMaidItem,
        maintenanceCloseDataMaidPreview,
        maintenanceBeginDataMaidDelete,
        maintenanceCancelDataMaidDelete,
        maintenanceConfirmDataMaidDelete,
        maintenanceReleaseDataMaid,
        maintenanceScanDuplicateGreetings,
        maintenanceToggleGreetingItem,
        maintenanceToggleAllGreetings,
        maintenanceBeginGreetingResolve,
        maintenanceCancelGreetingResolve,
        maintenanceConfirmGreetingResolve,
        maintenanceLoadSnapshots,
        maintenanceSetSnapshotKeep,
        maintenanceBeginSnapshotDelete,
        maintenanceCancelSnapshotDelete,
        maintenanceConfirmSnapshotDelete,
        maintenancePreviewSnapshotPrune,
        maintenanceCancelSnapshotPrune,
        maintenanceConfirmSnapshotPrune,
        maintenanceLoadChatBackupStats,
        maintenanceSetChatBackupDays,
        maintenancePreviewChatBackupPrune,
        maintenanceCancelChatBackupPrune,
        maintenanceConfirmChatBackupPrune,
        maintenanceExportUserData,
    };
}
