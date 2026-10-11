/**
 * 聊天背景（B5）的业务动作，经 shell/feature-slot-actions.js 的 chatBackground 分组并入所有路由上下文。
 *
 * 写入口：
 *   全局背景   settings.background（name、url，保留 fitting 等其他字段）→ saveSettingsSerialized → loadData → reloadSettings
 *   聊天锁定   chat_metadata.custom_background → updateModernChatMetadata（队列、带 integrity、保存后等待 reloadChat）
 *   专属上传   /api/images/upload 落到 user/images/<角色名>/，并登记到 chat_metadata.chat_backgrounds，
 *              否则数据维护（Data Maid）会把它当成未引用图片删掉
 * 读入口：getChatBackgroundInfo / getBackgroundReferenceInfo 只读 state，聊天头未读取时不发请求。
 */
import { describeReloadFailure, noEngineSync } from '../core/bridge-reload.js';
import {
    TRANSPARENT_BACKGROUND_NAME,
    buildBackgroundCssUrl,
    buildChatImageCssUrl,
    clampChatBackgroundDim,
    ensureChatBackgroundState,
    findBackgroundReferences,
    isTransparentBackground,
    parseBackgroundCssUrl,
    parseGlobalBackground,
    resetChatBackgroundImageStatus,
    resolveChatBackground,
    writeChatBackgroundPrefs,
} from '../core/chat-background.js';
import { saveSettingsSerialized } from '../core/keyed-queue.js';

const CHAT_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'jfif', 'webp', 'gif', 'bmp'];

function pad(value, length = 2) {
    return String(value).padStart(length, '0');
}

// 与旧版 humanizedDateTime 同形（2026-10-11@12h37m57s），多带毫秒，避免同一秒上传两张时互相覆盖
function formatUploadStamp(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}@${pad(date.getHours())}h${pad(date.getMinutes())}m${pad(date.getSeconds())}s${pad(date.getMilliseconds(), 3)}`;
}

async function fileToBase64(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
}

/**
 * @param {object} deps 依赖，见 shell/feature-slot-actions.js 的 FeatureSlotDeps。
 * @param {any} deps.state 全局界面状态。
 * @param {Function} deps.apiFetch 带 CSRF 的 JSON 请求。
 * @param {Function} deps.loadData 重新读取全部数据。
 * @param {Function} deps.render 重新渲染当前路由。
 * @param {Function} deps.showToast 弹出提示。
 * @param {any} [deps.bridgeReload] 引擎同步函数。
 * @param {Record<string, any>} deps.actionRegistry createActionRegistry 的返回值。
 * @param {Pick<Storage, 'getItem' | 'setItem'> | null} [deps.storage] 保存显示偏好的存储，默认 localStorage。
 * @returns {Record<string, any>} 并入路由上下文的动作。
 */
export function createChatBackgroundActions({
    state,
    apiFetch,
    loadData,
    render,
    showToast,
    bridgeReload = {},
    actionRegistry,
    storage = typeof localStorage === 'undefined' ? null : localStorage,
}) {
    const reloadSettings = bridgeReload.reloadSettings || noEngineSync;
    const chatContext = actionRegistry?.chatContextActions || {};
    const {
        getSelectedChatEntity,
        getChatContextKey,
        getChatCacheKey,
        getChatEntityName,
        getChatId,
        isGroupChatMode,
        loadChatMessages,
        updateModernChatMetadata,
    } = chatContext;

    function getBackgroundState() {
        return ensureChatBackgroundState(state, storage);
    }

    /**
     * 当前选中的聊天（角色或群聊的会话文件）；没有选中会话时为 null。
     * @returns {{ entity: any, chatId: string, groupMode: boolean, cacheKey: string, name: string } | null} 目标聊天。
     */
    function getCurrentChatTarget() {
        const entity = getSelectedChatEntity?.();
        const chatId = getChatId?.({ file_id: state.selected?.chat, file_name: state.selected?.chat }) || '';
        if (!entity || !chatId) {
            return null;
        }
        const groupMode = Boolean(isGroupChatMode?.());
        const cacheKey = getChatCacheKey(getChatContextKey(entity, groupMode), chatId);
        return { entity, chatId, groupMode, cacheKey, name: getChatEntityName(entity) };
    }

    function getKnownMetadata(target = getCurrentChatTarget()) {
        return target ? state.chatMetadata?.[target.cacheKey] || null : null;
    }

    /**
     * 聊天背景面板、遮罩和素材卡片共用的只读视图。
     * @returns {object} target 为当前聊天（无则 null）；metadata 为已读取的聊天头（未读取为 null）；resolved 为生效的背景；
     * lock/global 为解析后的锁定与全局背景；chatImages 为聊天专属图；canEdit 表示此刻可以写聊天头。
     */
    function getChatBackgroundInfo() {
        const background = getBackgroundState();
        const target = getCurrentChatTarget();
        const metadata = getKnownMetadata(target);
        const resolved = resolveChatBackground({ settings: state.settings, chatMetadata: metadata, failedPaths: background.failed });
        const lock = parseBackgroundCssUrl(metadata?.custom_background);
        const global = parseGlobalBackground(state.settings?.background);
        const chatImages = (Array.isArray(metadata?.chat_backgrounds) ? metadata.chat_backgrounds : [])
            .map(path => ({ path, parsed: typeof path === 'string' ? parseBackgroundCssUrl(buildChatImageCssUrl(path)) : null }))
            .filter(item => item.parsed?.kind === 'chat');
        return {
            target,
            metadata,
            resolved,
            lock,
            global,
            globalIsNone: !global || isTransparentBackground(global),
            chatImages,
            enabled: background.enabled,
            dim: background.dim,
            busy: background.busy,
            canEdit: Boolean(target) && !state.engine?.generating && !background.busy,
        };
    }

    /**
     * 删除、重命名前的提示依据：这些系统背景里哪些是全局背景，哪些是当前聊天的锁定背景。
     * 只看已读取的聊天头；其他聊天里的锁定无从得知，界面文案里另行说明。
     * @param {string[]} filenames 系统背景文件名。
     * @returns {{ global: string[], chat: string[], chatLabel: string }} 引用情况；chatLabel 为当前聊天的显示名。
     */
    function getBackgroundReferenceInfo(filenames) {
        const target = getCurrentChatTarget();
        const metadata = getKnownMetadata(target);
        const info = { global: /** @type {string[]} */ ([]), chat: /** @type {string[]} */ ([]), chatLabel: target ? `${target.name} / ${target.chatId}` : '' };
        for (const filename of filenames || []) {
            if (filename === TRANSPARENT_BACKGROUND_NAME) {
                continue;
            }
            const references = findBackgroundReferences({ settings: state.settings, chatMetadata: metadata, filename });
            if (references.global) {
                info.global.push(filename);
            }
            if (references.chat) {
                info.chat.push(filename);
            }
        }
        return info;
    }

    /**
     * 提示前尽量读到当前聊天的聊天头，读不到就按没有锁定处理（不报错、不弹提示）。
     */
    async function prepareBackgroundReferenceCheck() {
        const target = getCurrentChatTarget();
        if (!target || getKnownMetadata(target) || !loadChatMessages) {
            return;
        }
        try {
            await loadChatMessages(target.entity, target.chatId, { groupMode: target.groupMode, isContextCurrent: () => false });
        } catch {
            // 读取失败时 loadChatMessages 已经清掉缓存，后面按未锁定处理
        }
    }

    function clearImageStatus() {
        resetChatBackgroundImageStatus(state);
    }

    async function writeChatMetadata(mutate) {
        const target = getCurrentChatTarget();
        if (!target) {
            throw new Error('请先在聊天页选择一个会话。');
        }
        if (state.engine?.generating) {
            throw new Error('生成中不能修改聊天背景。');
        }
        const outcome = await updateModernChatMetadata(target.entity, target.chatId, mutate, { groupMode: target.groupMode });
        return { target, outcome };
    }

    async function runBusy(task) {
        const background = getBackgroundState();
        if (background.busy) {
            return undefined;
        }
        background.busy = true;
        render();
        try {
            return await task();
        } finally {
            background.busy = false;
            render();
        }
    }

    /**
     * 把系统背景设为全局背景：只改 name 和 url，fitting 等其他字段原样保留。
     * @param {string} filename backgrounds 目录下的文件名。
     */
    async function setGlobalBackground(filename) {
        const file = String(filename || '');
        if (!file || !parseBackgroundCssUrl(buildBackgroundCssUrl(file))) {
            throw new Error('背景文件名无效。');
        }

        await runBusy(async () => {
            const previous = state.settings?.background && typeof state.settings.background === 'object' ? state.settings.background : null;
            // 保留已有的 fitting、animation 等字段；设置里还没有背景时用旧版的默认值起一份
            const nextSettings = {
                ...state.settings,
                background: { ...(previous || { fitting: 'classic', animation: false }), name: file, url: buildBackgroundCssUrl(file) },
            };
            await saveSettingsSerialized(/** @type {any} */ (apiFetch), nextSettings);
            state.settings = nextSettings;
            clearImageStatus();
            await loadData({ silent: true });
            showToast('已设为全局背景', file);
            // 隐藏引擎目前不读 settings.background，这里只是保持「设置落盘后通知引擎」的统一口径，所以不阻塞界面
            // （引擎冷启动可能要几秒），失败时再补一条提示。重载已计入 state.engine.settingsSyncPending，生成前会等它。
            Promise.resolve(reloadSettings()).then(sync => {
                const failure = describeReloadFailure(sync);
                if (failure) {
                    showToast('生成引擎未能同步全局背景', failure);
                }
            });
        });
    }

    function buildChoiceCssUrl(choice) {
        if (choice?.none) {
            return buildBackgroundCssUrl(TRANSPARENT_BACKGROUND_NAME);
        }
        if (typeof choice?.chatImage === 'string') {
            const cssUrl = buildChatImageCssUrl(choice.chatImage);
            if (parseBackgroundCssUrl(cssUrl)?.kind !== 'chat') {
                throw new Error('聊天专属背景的路径无效。');
            }
            return cssUrl;
        }
        const file = String(choice?.file || '');
        if (!file || parseBackgroundCssUrl(buildBackgroundCssUrl(file))?.kind !== 'system') {
            throw new Error('背景文件名无效。');
        }
        return buildBackgroundCssUrl(file);
    }

    /**
     * 把当前聊天锁定到某个背景（写 chat_metadata.custom_background，格式与旧版相同）。
     * @param {{ file?: string, chatImage?: string, none?: boolean }} choice file 为系统背景文件名，chatImage 为专属图路径，none 为锁定成无背景。
     */
    async function lockChatBackground(choice) {
        const cssUrl = buildChoiceCssUrl(choice);
        await runBusy(async () => {
            const { outcome } = await writeChatMetadata(metadata => {
                metadata.custom_background = cssUrl;
            });
            clearImageStatus();
            const label = choice?.none ? '无背景' : (parseBackgroundCssUrl(cssUrl)?.name || '');
            showToast('已设为当前聊天背景', `${label}${describeReloadFailure(outcome.reload)}`);
        });
    }

    /**
     * 清除当前聊天的背景锁定，之后跟随全局背景。
     */
    async function clearChatBackgroundLock() {
        const known = getKnownMetadata();
        if (known && !known.custom_background) {
            showToast('当前聊天没有背景锁定', '已经在跟随全局背景。');
            return;
        }

        await runBusy(async () => {
            const { outcome } = await writeChatMetadata(metadata => {
                delete metadata.custom_background;
            });
            clearImageStatus();
            showToast('已跟随全局背景', `当前聊天的背景锁定已清除${describeReloadFailure(outcome.reload)}`);
        });
    }

    /**
     * 上传一张图作为当前聊天的专属背景：存到 user/images/<角色名>/，登记到 chat_backgrounds（Data Maid 靠它判断引用），并锁定。
     * 上传成功后写聊天头失败时，图片留在 user/images 里，会被数据维护当成未引用文件列出。
     * @param {File | null | undefined} file 用户选择的图片。
     */
    async function uploadChatBackground(file) {
        if (!file) {
            return;
        }
        const target = getCurrentChatTarget();
        if (!target) {
            throw new Error('请先在聊天页选择一个会话。');
        }
        if (state.engine?.generating) {
            throw new Error('生成中不能修改聊天背景。');
        }
        const extension = String(file.name || '').split('.').pop()?.toLowerCase() || '';
        if (!CHAT_IMAGE_EXTENSIONS.includes(extension)) {
            throw new Error(`只支持 ${CHAT_IMAGE_EXTENSIONS.join('、')} 格式的图片。`);
        }

        await runBusy(async () => {
            const image = await fileToBase64(file);
            const folderName = target.groupMode ? String(target.entity.id) : target.name;
            const uploaded = await apiFetch('/api/images/upload', {
                body: {
                    image,
                    format: extension,
                    ch_name: folderName,
                    filename: `${folderName}_${formatUploadStamp()}`.replace(/\./g, '_'),
                },
            });
            const imagePath = typeof uploaded?.path === 'string' ? uploaded.path : '';
            const cssUrl = imagePath ? buildChatImageCssUrl(imagePath) : '';
            if (parseBackgroundCssUrl(cssUrl)?.kind !== 'chat') {
                throw new Error('服务端没有返回可用的图片路径，图片可能已保存到 user/images。');
            }

            let outcome;
            try {
                ({ outcome } = await writeChatMetadata(metadata => {
                    const list = Array.isArray(metadata.chat_backgrounds) ? [...metadata.chat_backgrounds] : [];
                    if (!list.includes(imagePath)) {
                        list.push(imagePath);
                    }
                    metadata.chat_backgrounds = list;
                    metadata.custom_background = cssUrl;
                }));
            } catch (error) {
                throw new Error(`图片已上传到 ${imagePath}，但没能写入聊天：${error.message}`);
            }
            clearImageStatus();
            showToast('已上传并设为当前聊天背景', `${file.name}${describeReloadFailure(outcome.reload)}`);
        });
    }

    function setChatBackgroundEnabled(enabled) {
        const background = getBackgroundState();
        background.enabled = Boolean(enabled);
        writeChatBackgroundPrefs(storage, { enabled: background.enabled });
        render();
    }

    /**
     * 只保存遮罩浓度，不重新渲染：拖动滑块时由事件处理函数直接更新页面上的 CSS 变量。
     * @param {unknown} value 百分比。
     * @returns {number} 限制范围后的浓度。
     */
    function setChatBackgroundDim(value) {
        const background = getBackgroundState();
        background.dim = clampChatBackgroundDim(value);
        writeChatBackgroundPrefs(storage, { dim: background.dim });
        return background.dim;
    }

    function markChatBackgroundImageFailed(path) {
        const background = getBackgroundState();
        if (!path || background.failed[path]) {
            return;
        }
        background.failed[path] = true;
        render();
    }

    function markChatBackgroundImageVerified(path) {
        if (path) {
            getBackgroundState().verified[path] = true;
        }
    }

    // 系统背景被重命名或删除后，素材库的基础动作回调这里处理「当前聊天锁定」。全局背景由基础动作自己改。
    async function updateCurrentChatLock(shouldChange, change) {
        const target = getCurrentChatTarget();
        if (!target) {
            return '';
        }
        await prepareBackgroundReferenceCheck();
        const metadata = getKnownMetadata(target);
        if (!metadata || !shouldChange(metadata)) {
            return '';
        }
        try {
            await updateModernChatMetadata(target.entity, target.chatId, change, { groupMode: target.groupMode });
            return true;
        } catch (error) {
            return error.message || String(error);
        }
    }

    async function afterBackgroundRenamed(oldName, newName) {
        clearImageStatus();
        const oldPath = `backgrounds/${oldName}`;
        const matches = metadata => parseBackgroundCssUrl(metadata.custom_background)?.relativePath === oldPath;
        const result = await updateCurrentChatLock(matches, metadata => {
            if (matches(metadata)) {
                metadata.custom_background = buildBackgroundCssUrl(newName);
            }
        });
        if (result === true) {
            return '；当前聊天的背景锁定已同步到新文件名';
        }
        return result ? `；当前聊天的背景锁定未能同步（${result}），该聊天会回退到全局背景` : '';
    }

    async function afterBackgroundsDeleted(deletedNames) {
        clearImageStatus();
        const deletedPaths = new Set((deletedNames || []).map(name => `backgrounds/${name}`));
        const matches = metadata => deletedPaths.has(parseBackgroundCssUrl(metadata.custom_background)?.relativePath);
        const result = await updateCurrentChatLock(matches, metadata => {
            if (matches(metadata)) {
                delete metadata.custom_background;
            }
        });
        if (result === true) {
            return '；当前聊天的背景锁定已清除';
        }
        return result ? `；当前聊天的背景锁定未能清除（${result}），该聊天会回退到全局背景` : '';
    }

    actionRegistry?.assetActions?.registerBackgroundReferenceHooks?.({
        afterRename: afterBackgroundRenamed,
        afterDelete: afterBackgroundsDeleted,
    });

    return {
        getChatBackgroundInfo,
        getBackgroundReferenceInfo,
        prepareBackgroundReferenceCheck,
        setGlobalBackground,
        lockChatBackground,
        clearChatBackgroundLock,
        uploadChatBackground,
        setChatBackgroundEnabled,
        setChatBackgroundDim,
        markChatBackgroundImageFailed,
        markChatBackgroundImageVerified,
    };
}
