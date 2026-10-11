// 角色卡内嵌世界书（Character Card V2 的 data.character_book）转换为世界书文件的纯函数，不访问网络和 DOM。
//
// 字段映射移植自旧版 public/scripts/world-info.js 的 convertCharacterBook，Modern 无法直接引用旧版模块，
// 所以这里保留一份，并由 tests/modern-character-book.test.js 锁定对照结果。与旧版有意不同的地方：
//   1. 不修改传入的角色卡对象（旧版会就地给缺少 id 的条目补 id）；
//   2. 缺失或重复的条目 id 取最小的空闲整数，不会让两个条目互相覆盖（旧版按 id 当键，后者覆盖前者）；
//   3. 缺失的 insertion_order、keys、content 补成世界书的默认值，不再写出 undefined；
//   4. 缺少 enabled 字段的条目按启用处理（旧版 !undefined 会把整本书停用）。

const WORLD_INFO_POSITION_BEFORE = 0;
const WORLD_INFO_POSITION_AFTER = 1;
const DEFAULT_DEPTH = 4;
const DEFAULT_WEIGHT = 100;
const DEFAULT_ORDER = 100;

/**
 * 旧版 newWorldInfoEntryTemplate 的默认值（不含 characterFilter* 三项，旧版也把它们排除在模板外）。
 * 每次调用返回新对象，避免数组默认值被多个条目共用。
 * @returns {Record<string, any>} 一个条目的默认字段
 */
function createEntryTemplate() {
    return {
        key: [],
        keysecondary: [],
        comment: '',
        content: '',
        constant: false,
        vectorized: false,
        selective: true,
        selectiveLogic: 0,
        addMemo: false,
        order: DEFAULT_ORDER,
        position: WORLD_INFO_POSITION_BEFORE,
        disable: false,
        ignoreBudget: false,
        excludeRecursion: false,
        preventRecursion: false,
        matchPersonaDescription: false,
        matchCharacterDescription: false,
        matchCharacterPersonality: false,
        matchCharacterDepthPrompt: false,
        matchScenario: false,
        matchCreatorNotes: false,
        delayUntilRecursion: 0,
        probability: 100,
        useProbability: true,
        depth: DEFAULT_DEPTH,
        outletName: '',
        group: '',
        groupOverride: false,
        groupWeight: DEFAULT_WEIGHT,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        useGroupScoring: null,
        automationId: '',
        role: 0,
        sticky: null,
        cooldown: null,
        delay: null,
        triggers: [],
    };
}

/**
 * @param {unknown} value 任意值
 * @returns {value is Record<string, any>} 是否为普通对象（非数组、非 null）
 */
function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 关键词列表：数组原样复制，逗号分隔的字符串拆开，其余视为空。
 * @param {unknown} value 卡片里的 keys / secondary_keys
 * @returns {any[]} 关键词数组
 */
function toKeyList(value) {
    if (Array.isArray(value)) {
        return [...value];
    }
    if (typeof value === 'string') {
        return value.split(',').map(key => key.trim()).filter(Boolean);
    }
    return [];
}

/**
 * @param {unknown} value 卡片里的数值字段
 * @param {number} fallback 缺失或不是数字时的默认值
 * @returns {number} 数值
 */
function toNumber(value, fallback) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

/**
 * 深拷贝角色卡里的世界书，让转换不影响调用方持有的角色卡。
 * @param {any} book data.character_book
 * @returns {any} 独立副本
 */
function deepClone(book) {
    return typeof structuredClone === 'function' ? structuredClone(book) : JSON.parse(JSON.stringify(book));
}

/**
 * 给没有 id 或 id 重复的条目补 id。旧版缺 id 时用数组下标，这里也先用下标；
 * 下标已被占用的缺 id 条目和 id 重复的条目（保留第一个）依次取最小的空闲整数。
 * @param {any[]} entries 世界书副本里的条目（原地补 id，调用方传入的必须是副本）
 */
function assignEntryIds(entries) {
    const used = new Set();
    /** @type {{ entry: any, index: number, missing: boolean }[]} */
    const needsId = [];
    entries.forEach((entry, index) => {
        if (!isPlainObject(entry)) {
            return;
        }
        const missing = entry.id === undefined || entry.id === null || entry.id === '';
        if (!missing && !used.has(String(entry.id))) {
            used.add(String(entry.id));
        } else {
            needsId.push({ entry, index, missing });
        }
    });

    const unresolved = [];
    for (const item of needsId) {
        if (item.missing && !used.has(String(item.index))) {
            item.entry.id = item.index;
            used.add(String(item.index));
        } else {
            unresolved.push(item);
        }
    }

    let nextFree = 0;
    for (const { entry } of unresolved) {
        while (used.has(String(nextFree))) {
            nextFree += 1;
        }
        entry.id = nextFree;
        used.add(String(nextFree));
    }
}

/**
 * 把角色卡内嵌世界书转成世界书文件的 entries 结构，字段映射与旧版 convertCharacterBook 一致。
 * 不修改入参。返回值里的 originalData 是补全 id 后的卡内世界书副本，旧版同样把它写进世界书文件。
 * @param {any} characterBook 角色卡的 data.character_book
 * @returns {{ entries: Record<string, any>, originalData: any }} entries 以条目 id 为键
 */
export function convertCharacterBook(characterBook) {
    const book = isPlainObject(characterBook) ? deepClone(characterBook) : { entries: [] };
    const sourceEntries = Array.isArray(book.entries) ? book.entries : [];
    assignEntryIds(sourceEntries);

    /** @type {Record<string, any>} */
    const entries = {};
    sourceEntries.forEach((entry, index) => {
        if (!isPlainObject(entry)) {
            return;
        }

        const extensions = isPlainObject(entry.extensions) ? entry.extensions : {};
        const template = createEntryTemplate();
        entries[entry.id] = {
            ...template,
            uid: entry.id,
            key: toKeyList(entry.keys),
            keysecondary: toKeyList(entry.secondary_keys),
            comment: entry.comment || '',
            content: typeof entry.content === 'string' ? entry.content : String(entry.content ?? ''),
            constant: entry.constant || false,
            selective: entry.selective || false,
            order: toNumber(entry.insertion_order, DEFAULT_ORDER),
            // 世界书的位置序号放在 extensions.position；没有时按 V2 规范的 before_char / after_char 推断
            position: extensions.position ?? (entry.position === 'before_char' ? WORLD_INFO_POSITION_BEFORE : WORLD_INFO_POSITION_AFTER),
            excludeRecursion: extensions.exclude_recursion ?? false,
            preventRecursion: extensions.prevent_recursion ?? false,
            delayUntilRecursion: extensions.delay_until_recursion ?? false,
            disable: entry.enabled === undefined || entry.enabled === null ? false : !entry.enabled,
            addMemo: Boolean(entry.comment),
            displayIndex: extensions.display_index ?? index,
            probability: extensions.probability ?? 100,
            useProbability: extensions.useProbability ?? true,
            depth: extensions.depth ?? DEFAULT_DEPTH,
            selectiveLogic: extensions.selectiveLogic ?? 0,
            outletName: extensions.outlet_name ?? '',
            group: extensions.group ?? '',
            groupOverride: extensions.group_override ?? false,
            groupWeight: extensions.group_weight ?? DEFAULT_WEIGHT,
            scanDepth: extensions.scan_depth ?? null,
            caseSensitive: extensions.case_sensitive ?? null,
            matchWholeWords: extensions.match_whole_words ?? null,
            useGroupScoring: extensions.use_group_scoring ?? null,
            automationId: extensions.automation_id ?? '',
            role: extensions.role ?? 0,
            vectorized: extensions.vectorized ?? false,
            sticky: extensions.sticky ?? null,
            cooldown: extensions.cooldown ?? null,
            delay: extensions.delay ?? null,
            matchPersonaDescription: extensions.match_persona_description ?? false,
            matchCharacterDescription: extensions.match_character_description ?? false,
            matchCharacterPersonality: extensions.match_character_personality ?? false,
            matchCharacterDepthPrompt: extensions.match_character_depth_prompt ?? false,
            matchScenario: extensions.match_scenario ?? false,
            matchCreatorNotes: extensions.match_creator_notes ?? false,
            extensions: deepClone(extensions),
            triggers: Array.isArray(extensions.triggers) ? [...extensions.triggers] : [],
            ignoreBudget: extensions.ignore_budget ?? false,
        };
    });

    return { entries, originalData: book };
}

/**
 * 读取角色卡内嵌世界书的概要。没有条目的空书不算内嵌世界书（旧版会提示导入一本空书）。
 * @param {any} character 角色卡（/api/characters/get 或列表返回的对象；懒加载的摘要里没有 character_book）
 * @returns {{ has: boolean, entryCount: number, bookName: string, suggestedName: string }} has 表示有可导入的条目；
 * suggestedName 是旧版的默认名：书自己的名称，没有时用「<角色名>'s Lorebook」
 */
export function getEmbeddedBookInfo(character) {
    const book = character?.data?.character_book;
    const entries = isPlainObject(book) && Array.isArray(book.entries) ? book.entries : [];
    const bookName = isPlainObject(book) && typeof book.name === 'string' ? book.name.trim() : '';
    const characterName = String(character?.name || character?.data?.name || '').trim() || 'Character';

    return {
        has: entries.length > 0,
        entryCount: entries.length,
        bookName,
        suggestedName: bookName || `${characterName}'s Lorebook`,
    };
}

/**
 * 世界书重名比较用的写法：忽略大小写和重音符号，与旧版 equalsIgnoreCaseAndAccents 一致。
 * 后端文件名区分重音但 macOS / Windows 的文件系统不区分大小写，所以宁可多判一次重名。
 * @param {unknown} name 世界书名称
 * @returns {string} 折叠后的写法
 */
function foldWorldName(name) {
    return String(name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * 在已有世界书名称里找与候选名重名的那个（忽略大小写和重音）。
 * @param {Iterable<string>} existingNames 已有世界书名称
 * @param {string} candidate 候选名称
 * @returns {string | undefined} 已有的那个名称（保持它自己的写法），没有重名时为 undefined
 */
export function findExistingWorldName(existingNames, candidate) {
    const folded = foldWorldName(candidate);
    for (const name of existingNames) {
        if (foldWorldName(name) === folded) {
            return name;
        }
    }
    return undefined;
}

/**
 * 重名时的另存名称：「<名称> (2)」，被占用则依次尝试 (3)、(4)…
 * @param {string} baseName 想用的名称
 * @param {Iterable<string>} existingNames 已有世界书名称
 * @returns {string} 不与已有名称重名的新名称
 */
export function pickAlternateWorldName(baseName, existingNames) {
    const names = [...existingNames];
    for (let suffix = 2; suffix < 10_000; suffix++) {
        const candidate = `${baseName} (${suffix})`;
        if (findExistingWorldName(names, candidate) === undefined) {
            return candidate;
        }
    }
    return `${baseName} (${Date.now()})`;
}
