import { describeReloadFailure, noEngineSync } from '../core/bridge-reload.js';
import {
    convertCharacterBook,
    findExistingWorldName,
    getEmbeddedBookInfo,
    pickAlternateWorldName,
} from '../core/character-book.js';
import { saveSettingsSerialized } from '../core/keyed-queue.js';
import { getCharacterWorldStatus } from './character-data.js';

// 与旧版共用的「只提示一次」标记：settings.accountStorage['AlertWI_<avatar>']（旧版 checkEmbeddedWorld 写同一个键）。
const ALERT_KEY_PREFIX = 'AlertWI_';

// 写世界书文件撞上同名（409）后重新取名的最多次数：每次重取名都会重新询问用户，超过说明有人在持续创建同名文件。
const MAX_WRITE_ATTEMPTS = 3;

/**
 * 角色卡内嵌世界书（data.character_book）导入为独立世界书文件，并把角色关联到它。
 *
 * 与旧版（public/scripts/world-info.js 的 importEmbeddedWorldInfo）有意不同的地方：
 * - 旧版先写世界书，再改角色的关联字段，最后保存角色时由后端 /api/characters/edit 用世界书文件重写卡内的
 *   character_book。Modern 用 /api/characters/merge-attributes 只写 data.extensions.world，不重写 character_book，
 *   所以导出的角色卡仍保留作者原始的内嵌世界书；
 * - 旧版的默认名是书名或「<角色名>'s Lorebook」，Modern 先用角色已有的关联名，这样一个「未找到」的关联可以按原名恢复；
 * - 重名时旧版弹确认框问是否覆盖，Modern 在角色详情里内联给出「另存为(2) / 覆盖 / 取消」，不用 window.confirm；
 * - 空书（没有任何条目）不当作内嵌世界书。
 *
 * 为什么必须导入：生成只读取 data.extensions.world 指向的世界书文件，没有导入、关联的内嵌世界书在生成时完全不参与。
 *
 * @param {object} deps 依赖
 * @param {any} deps.state 全局界面状态
 * @param {(path: string, options?: any) => Promise<any>} deps.apiFetch 带 CSRF 的 JSON 请求
 * @param {(options?: any) => Promise<any>} deps.loadData 重新读取全部数据
 * @param {Function} deps.render 重新渲染当前路由
 * @param {Function} deps.showToast 弹出提示
 * @param {(avatar: string, options?: { force?: boolean }) => Promise<any>} deps.loadCharacterDetail 读取完整角色卡（actions/character-detail.js）
 * @param {() => Promise<any>} [deps.reloadCharacter] 通知生成引擎重载角色列表
 * @param {(names?: string[] | null, options?: { refreshList?: boolean }) => Promise<any>} [deps.reloadWorldInfo] 通知生成引擎丢弃世界书缓存并刷新世界书列表
 * @param {(avatar: string, previousWorld: string, nextWorld: string) => void} [deps.onWorldLinked] 角色的关联世界书已改变，供编辑器同步表单基线
 */
export function createCharacterEmbeddedWorldActions({
    state,
    apiFetch,
    loadData,
    render,
    showToast,
    loadCharacterDetail,
    reloadCharacter = noEngineSync,
    reloadWorldInfo = noEngineSync,
    onWorldLinked = () => {},
}) {
    /** @type {Map<string, Promise<any>>} 正在导入的角色，同一角色的重复请求共用同一次导入 */
    const inFlight = new Map();
    /** @type {((choice: string) => void) | null} 等待用户选择的重名处理 */
    let pendingConflict = null;

    function getUiState() {
        if (!state.characterEmbeddedWorld) {
            state.characterEmbeddedWorld = { prompt: '', importing: '', conflict: null };
        }
        return state.characterEmbeddedWorld;
    }

    function getKnownWorldNames() {
        return new Set([
            ...(Array.isArray(state.worldbooks) ? state.worldbooks : []).map(worldbook => worldbook?.file_id || worldbook?.name),
            ...(Array.isArray(state.settingsBundle?.world_names) ? state.settingsBundle.world_names : []),
        ].filter(Boolean));
    }

    // 写入撞上同名后重新读取世界书名单：以后端的列表为准，读取失败时沿用已知名单。
    async function fetchWorldNames(fallbackNames) {
        try {
            const worldbooks = await apiFetch('/api/worldinfo/list');
            if (Array.isArray(worldbooks)) {
                return new Set(worldbooks.map(worldbook => worldbook?.file_id || worldbook?.name).filter(Boolean));
            }
        } catch (error) {
            console.warn('Modern embedded world: failed to re-read the world book list', error);
        }
        return new Set(fallbackNames);
    }

    async function sanitizeWorldName(name) {
        const result = await apiFetch('/api/files/sanitize-filename', { body: { fileName: name } });
        return typeof result?.fileName === 'string' ? result.fileName.trim() : '';
    }

    // 关联只写 data.extensions.world。卡里的内嵌世界书缺 extensions 时一并补上空对象，满足后端对 V2 卡的校验
    // （src/validator/TavernCardValidator.js 要求 character_book 有 extensions 和 entries）。
    function buildLinkPayload(avatar, character, worldName) {
        const data = { extensions: { world: worldName } };
        const book = character?.data?.character_book;
        if (!book?.extensions || typeof book.extensions !== 'object') {
            data.character_book = { extensions: {} };
        }
        return { avatar, data };
    }

    /**
     * 把角色卡内嵌世界书导入为世界书文件并关联到角色。
     * 已经关联到一本存在的世界书时什么都不写（幂等）。
     * @param {string} avatar 角色头像文件名
     * @param {object} [options] 选项
     * @param {(info: { avatar: string, requestedName: string, existingName: string, alternateName: string, entryCount: number }) => string | Promise<string>} [options.onConflict]
     *   重名时返回 'rename'（另存为「<名称> (2)」）、'overwrite'（覆盖已有的）或 'cancel'；不提供时遇到重名直接返回 conflict，不写任何东西
     * @returns {Promise<{ ok: boolean, status: string, worldName?: string, entryCount?: number, linked?: boolean, renamed?: boolean, overwritten?: boolean, existingName?: string, alternateName?: string, refreshError?: string, engineSync?: Promise<{ character: any, world: any }> }>} 结果；engineSync 在引擎确认后完成（永不 reject）；
     *   status 为 imported、already-linked、no-book、cancelled 或 conflict。读取、写入或关联失败时抛出错误
     */
    function importEmbeddedWorldbook(avatar, { onConflict } = {}) {
        if (!avatar) {
            return Promise.reject(new Error('请先选择角色。'));
        }
        const running = inFlight.get(avatar);
        if (running) {
            return running;
        }

        const run = performImport(avatar, onConflict).finally(() => {
            if (inFlight.get(avatar) === run) {
                inFlight.delete(avatar);
            }
        });
        inFlight.set(avatar, run);
        return run;
    }

    async function performImport(avatar, onConflict) {
        // 一律重新读取完整卡：列表在懒加载模式下只有摘要，没有 character_book
        const character = await loadCharacterDetail(avatar, { force: true });
        if (!character) {
            throw new Error('角色卡读取失败，无法检查内嵌世界书。');
        }

        const info = getEmbeddedBookInfo(character);
        if (!info.has) {
            return { ok: true, status: 'no-book' };
        }

        const linkedName = String(character.data?.extensions?.world ?? '').trim();
        if (getCharacterWorldStatus(linkedName, state) === 'found') {
            return { ok: true, status: 'already-linked', worldName: linkedName, entryCount: info.entryCount };
        }

        // 名称优先级：角色已有的关联名（让「未找到」的关联按原名恢复）→ 书名 / 「<角色名>'s Lorebook」
        let requestedName = '';
        for (const candidate of [linkedName, info.suggestedName]) {
            if (!candidate) {
                continue;
            }
            requestedName = await sanitizeWorldName(candidate);
            if (requestedName) {
                break;
            }
        }
        if (!requestedName) {
            throw new Error('世界书名称清理后为空，请先在世界书页手动创建世界书，再到角色编辑里关联。');
        }

        const converted = convertCharacterBook(character.data.character_book);
        let knownNames = getKnownWorldNames();
        let targetName = requestedName;
        let overwritten = false;
        let renamed = false;

        for (let attempt = 1; ; attempt++) {
            const existingName = findExistingWorldName(knownNames, requestedName);
            targetName = requestedName;
            overwritten = false;
            renamed = false;
            if (existingName !== undefined) {
                const alternateName = pickAlternateWorldName(requestedName, knownNames);
                const choice = typeof onConflict === 'function'
                    ? await onConflict({ avatar, requestedName, existingName, alternateName, entryCount: info.entryCount })
                    : 'conflict';
                if (choice === 'rename') {
                    targetName = alternateName;
                    renamed = true;
                } else if (choice === 'overwrite') {
                    targetName = existingName;
                    overwritten = true;
                } else {
                    return { ok: false, status: choice === 'conflict' ? 'conflict' : 'cancelled', existingName, alternateName };
                }
            }

            try {
                await apiFetch('/api/worldinfo/edit', {
                    body: {
                        name: targetName,
                        data: { name: targetName, entries: converted.entries, originalData: converted.originalData },
                        overwrite: overwritten,
                    },
                });
                break;
            } catch (error) {
                // 别处刚好创建了同名文件：重新读取名单，再按新的重名情况询问
                if (/** @type {any} */ (error)?.status === 409 && !overwritten && attempt < MAX_WRITE_ATTEMPTS) {
                    knownNames = await fetchWorldNames(knownNames);
                    continue;
                }
                throw error;
            }
        }

        // 世界书文件已落盘：关联、刷新界面数据、通知引擎。关联失败也要先刷新和通知，再把错误带上「文件已写入」的说明抛出
        let linkError = null;
        const needsLink = targetName !== linkedName;
        if (needsLink) {
            try {
                await apiFetch('/api/characters/merge-attributes', { body: buildLinkPayload(avatar, character, targetName) });
            } catch (error) {
                linkError = error;
            }
        }

        const linked = needsLink && !linkError;
        if (linked) {
            onWorldLinked(avatar, linkedName, targetName);
        }

        // 通知引擎但不等它确认：冷启动的引擎要数秒才响应，导入流程不必等；生成 / 候选切换发出前会等待在途同步，
        // 引擎侧也按到达顺序先重载后生成。同步失败时另弹一条提示，调用方需要等结果可以 await 返回值里的 engineSync
        const characterSync = linked ? reloadCharacter() : Promise.resolve(null);
        const worldSync = reloadWorldInfo([targetName]);
        const engineSync = Promise.all([characterSync, worldSync]).then(([characterReload, worldReload]) => {
            const failure = describeReloadFailure(characterReload) || describeReloadFailure(worldReload);
            if (failure) {
                showToast('生成引擎未同步', `世界书「${targetName}」已导入${failure}`);
            }
            return { character: characterReload, world: worldReload };
        });

        /** @type {string} */
        let refreshError = '';
        try {
            await loadData({ silent: true });
            await loadCharacterDetail(avatar, { force: true });
        } catch (error) {
            refreshError = /** @type {any} */ (error)?.message || String(error);
        }

        if (linkError) {
            const detail = /** @type {any} */ (linkError)?.message || String(linkError);
            throw new Error(`世界书「${targetName}」已写入，但关联到角色失败：${detail}`);
        }

        return {
            ok: true,
            status: 'imported',
            worldName: targetName,
            entryCount: info.entryCount,
            linked,
            renamed,
            overwritten,
            refreshError,
            engineSync,
        };
    }

    // 重名时把选择交给角色详情里的内联面板，等用户点击后继续导入。
    function askConflict(info) {
        return new Promise(resolve => {
            pendingConflict = resolve;
            getUiState().conflict = { ...info };
            render();
            // 面板紧贴在状态行下方，窗口较矮时可能在视口外：滚到可见位置，免得用户找不到要选的按钮
            if (typeof document !== 'undefined') {
                setTimeout(() => document.querySelector('[data-character-embedded-world-conflict]')?.scrollIntoView({ block: 'nearest' }), 0);
            }
        });
    }

    /**
     * 「导入并关联」按钮：导入、必要时等待用户处理重名，并给出结果提示。失败时抛出，由事件处理函数统一提示。
     * @param {string} avatar 角色头像文件名
     */
    async function startCharacterEmbeddedWorldImport(avatar) {
        const ui = getUiState();
        if (!avatar || ui.importing === avatar) {
            return;
        }
        if (ui.importing) {
            // 另一个角色停在重名选择上：用户已经转去处理这个角色，按取消处理；其他情况是另一次导入正在进行，不并发
            if (!pendingConflict) {
                return;
            }
            resolveCharacterEmbeddedWorldConflict('cancel');
        }

        ui.importing = avatar;
        ui.conflict = null;
        render();
        try {
            const result = await importEmbeddedWorldbook(avatar, { onConflict: askConflict });
            if (result.status === 'imported') {
                ui.prompt = ui.prompt === avatar ? '' : ui.prompt;
                const overwriteNote = result.overwritten ? '，已覆盖同名世界书' : '';
                const renameNote = result.renamed ? '（原名称已被占用，已另存）' : '';
                const refreshNote = result.refreshError ? `（界面数据刷新失败：${result.refreshError}，请手动刷新）` : '';
                showToast('内嵌世界书已导入', `「${result.worldName}」${result.entryCount} 条，已关联到角色${renameNote}${overwriteNote}${refreshNote}`);
            } else if (result.status === 'already-linked') {
                ui.prompt = ui.prompt === avatar ? '' : ui.prompt;
                showToast('已经关联', `这个角色已关联世界书「${result.worldName}」，没有重复导入。`);
            } else if (result.status === 'no-book') {
                ui.prompt = ui.prompt === avatar ? '' : ui.prompt;
                showToast('没有内嵌世界书', '重新读取后发现这张角色卡没有可导入的世界书条目。');
            } else if (result.status === 'cancelled') {
                showToast('已取消导入', `没有写入世界书，「${result.existingName}」保持原样。`);
            }
        } finally {
            // 被另一个角色的导入顶替后，状态已经属于新的导入，不能清掉
            if (ui.importing === avatar) {
                ui.importing = '';
                ui.conflict = null;
                pendingConflict = null;
            }
            render();
        }
    }

    /**
     * 内联面板的重名选择。
     * @param {string} choice 'rename'、'overwrite' 或 'cancel'
     */
    function resolveCharacterEmbeddedWorldConflict(choice) {
        const resolve = pendingConflict;
        pendingConflict = null;
        getUiState().conflict = null;
        resolve?.(['rename', 'overwrite'].includes(choice) ? choice : 'cancel');
        render();
    }

    function dismissCharacterEmbeddedWorldPrompt() {
        getUiState().prompt = '';
        render();
    }

    // 写「已提示」标记（value 为 null 表示清除）。设置没有读取成功（空对象或解析失败）时只记在内存里，
    // 避免用残缺的设置覆盖用户的设置文件。
    async function writeAlertMarker(avatar, value) {
        const settings = state.settings;
        if (!settings || typeof settings !== 'object') {
            return;
        }

        const settingsUsable = Object.keys(settings).length > 0 && !(state.errors || []).some(error => error?.key === 'settings');
        const key = `${ALERT_KEY_PREFIX}${avatar}`;
        const storage = { ...(settings.accountStorage && typeof settings.accountStorage === 'object' ? settings.accountStorage : {}) };
        if (value === null) {
            if (!Object.hasOwn(storage, key)) {
                return;
            }
            delete storage[key];
        } else {
            storage[key] = value;
        }
        settings.accountStorage = storage;

        if (!settingsUsable) {
            return;
        }

        try {
            await saveSettingsSerialized(apiFetch, settings);
        } catch (error) {
            console.warn('Modern embedded world: failed to save the prompt marker', error);
        }
    }

    function hasAlertMarker(avatar) {
        const storage = state.settings?.accountStorage;
        return Boolean(storage && typeof storage === 'object' && Object.hasOwn(storage, `${ALERT_KEY_PREFIX}${avatar}`));
    }

    /**
     * 角色被删除后清掉它的「已提示」标记（旧版删除角色时同样清除），同名文件以后重新导入时才会再提示。
     * @param {string} avatar 角色头像文件名
     */
    async function forgetEmbeddedWorldAlert(avatar) {
        if (!avatar || !hasAlertMarker(avatar)) {
            return;
        }
        await writeAlertMarker(avatar, null);
    }

    /**
     * 导入角色卡（本地文件或远程资源）后，卡里带着尚未关联的内嵌世界书时提示一次。
     * 旧版在选中角色时检查（world-info.js 的 checkEmbeddedWorld），Modern 改在导入完成后检查，规则相同：
     * 角色已关联一本存在的世界书则不提示；每个头像只提示一次（标记键 AlertWI_<avatar> 与旧版共用）；
     * power_user.world_import_dialog 为 false 时只弹提示，不显示内联的导入询问。
     * 导入本身已经成功，这里的任何失败都只写日志，不会向外抛出。
     * @param {string} avatar 刚导入的角色头像文件名
     * @param {object} [options] 选项
     * @param {'file' | 'remote'} [options.source] 来源；远程导入发生在别的页面，所以额外弹一条提示
     * @param {any} [options.character] 已读取的完整角色卡；不提供时重新读取
     * @returns {Promise<{ offered: boolean, reason?: string }>} 是否显示了提示
     */
    async function offerEmbeddedWorldAfterImport(avatar, { source = 'file', character = null } = {}) {
        try {
            if (!avatar) {
                return { offered: false, reason: 'no-avatar' };
            }
            const card = character || await loadCharacterDetail(avatar, { force: true });
            const info = getEmbeddedBookInfo(card);
            if (!info.has) {
                return { offered: false, reason: 'no-book' };
            }
            if (getCharacterWorldStatus(card?.data?.extensions?.world, state) === 'found') {
                return { offered: false, reason: 'linked' };
            }
            if (hasAlertMarker(avatar)) {
                return { offered: false, reason: 'already-alerted' };
            }

            await writeAlertMarker(avatar, 'true');
            const useDialog = state.settings?.power_user?.world_import_dialog !== false;
            if (useDialog) {
                getUiState().prompt = avatar;
            }
            if (source === 'remote' || !useDialog) {
                const name = card?.name || card?.data?.name || avatar;
                showToast(`${name} 带有内嵌世界书`, `共 ${info.entryCount} 条，还没有导入，生成时不会使用。到角色库打开这个角色，点「导入并关联」即可。`);
            }
            return { offered: true };
        } catch (error) {
            console.warn('Modern embedded world: prompt after import failed', error);
            return { offered: false, reason: 'error' };
        }
    }

    return {
        importEmbeddedWorldbook,
        startCharacterEmbeddedWorldImport,
        resolveCharacterEmbeddedWorldConflict,
        dismissCharacterEmbeddedWorldPrompt,
        offerEmbeddedWorldAfterImport,
        forgetEmbeddedWorldAlert,
    };
}
