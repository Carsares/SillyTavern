import { characterFormDefaults } from '../core/constants.js';
import {
    alternateGreetingsToInput,
    arrayToEntryInput,
    entryInputToArray,
    inputToAlternateGreetings,
    numberInput,
} from '../core/utils.js';

// 卡片里的标签可能带空串或纯空白项（导入的旧卡常见），展示和编辑时都只保留有内容的标签。
export function cleanCharacterTags(tags) {
    return Array.isArray(tags)
        ? tags.map(tag => String(tag ?? '').trim()).filter(Boolean)
        : [];
}

// 作者字段常见「A,,A,」这类脏数据：按逗号拆开、去空白、去空项并去重后再展示；只影响展示，不改卡片数据。
export function formatCharacterCreator(creator) {
    const names = String(creator ?? '')
        .split(/[,，]/)
        .map(name => name.trim())
        .filter(Boolean);
    return [...new Set(names)].join('、');
}

// 列表行只展示整理后的作者名：返回浅拷贝给渲染用，卡片原始数据保持不变。
export function withDisplayCreator(character) {
    const creator = character?.data?.creator;
    if (!creator) {
        return character;
    }

    const displayCreator = formatCharacterCreator(creator);
    return displayCreator === creator ? character : { ...character, data: { ...character.data, creator: displayCreator } };
}

// 统计重新读取后新出现的字段数：顶层字段和 data 下的字段分别计入，用于「读取完整卡」的结果提示。
export function countAddedCharacterFields(previous, next) {
    const listFieldPaths = character => {
        if (!character || typeof character !== 'object') {
            return [];
        }

        const paths = Object.keys(character).filter(key => key !== 'data');
        const data = character.data;
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            paths.push(...Object.keys(data).map(key => `data.${key}`));
        }
        return paths;
    };

    const previousPaths = new Set(listFieldPaths(previous));
    return listFieldPaths(next).filter(fieldPath => !previousPaths.has(fieldPath)).length;
}

/**
 * 角色卡里记录的关联世界书只是文件名，文件可能已被删除或改名。
 * 世界书列表读取失败且没有其他名单可对照时返回 'unknown'，避免误报「未找到」。
 * @param {unknown} worldName 角色卡 data.extensions.world
 * @param {{ worldbooks?: any[], settingsBundle?: { world_names?: string[] }, errors?: { key?: string }[] }} [sources] 当前已读取的世界书名单
 * @returns {'none' | 'found' | 'missing' | 'unknown'} 关联状态
 */
export function getCharacterWorldStatus(worldName, { worldbooks = [], settingsBundle = {}, errors = [] } = {}) {
    const name = String(worldName ?? '').trim();
    if (!name) {
        return 'none';
    }

    const knownNames = new Set([
        ...(Array.isArray(worldbooks) ? worldbooks : []).map(worldbook => worldbook?.file_id || worldbook?.name),
        ...(Array.isArray(settingsBundle?.world_names) ? settingsBundle.world_names : []),
    ].filter(Boolean));
    if (knownNames.has(name)) {
        return 'found';
    }

    const worldListFailed = (Array.isArray(errors) ? errors : []).some(error => error?.key === 'worldbooks');
    return worldListFailed && !knownNames.size ? 'unknown' : 'missing';
}

export function createCharacterDataHelpers() {
    function defaultCharacterForm() {
        return { ...characterFormDefaults };
    }

    function getCharacterData(character) {
        return character?.data || {};
    }

    function getCharacterTags(character) {
        const dataTags = getCharacterData(character).tags;
        return cleanCharacterTags(Array.isArray(dataTags) ? dataTags : character?.tags);
    }

    function characterToForm(character) {
        const data = getCharacterData(character);
        const extensions = data.extensions || {};
        const depthPrompt = extensions.depth_prompt || {};

        return {
            ...defaultCharacterForm(),
            name: data.name || character?.name || '',
            description: data.description || character?.description || '',
            personality: data.personality || character?.personality || '',
            scenario: data.scenario || character?.scenario || '',
            first_mes: data.first_mes || character?.first_mes || '',
            mes_example: data.mes_example || character?.mes_example || '',
            creator_notes: data.creator_notes || character?.creatorcomment || '',
            system_prompt: data.system_prompt || '',
            post_history_instructions: data.post_history_instructions || '',
            creator: data.creator || '',
            character_version: data.character_version || '',
            tags: arrayToEntryInput(getCharacterTags(character)),
            world: extensions.world || '',
            alternate_greetings: alternateGreetingsToInput(data.alternate_greetings),
            depth_prompt_prompt: depthPrompt.prompt || '',
            depth_prompt_depth: String(depthPrompt.depth ?? 4),
            depth_prompt_role: depthPrompt.role || 'system',
            talkativeness: String(extensions.talkativeness ?? character?.talkativeness ?? 0.5),
            favorite: Boolean(extensions.fav ?? character?.fav),
        };
    }

    // 表单值统一按字符串比较：输入框回写的是字符串，基线里的布尔值和数字也按同样口径归一。
    function isCharacterFormDirty(form, baseline) {
        if (!form || !baseline) {
            return false;
        }

        const fields = new Set([...Object.keys(baseline), ...Object.keys(form)]);
        for (const field of fields) {
            if (String(form[field] ?? '') !== String(baseline[field] ?? '')) {
                return true;
            }
        }

        return false;
    }

    function characterCreatePayload(form) {
        return {
            ch_name: form.name.trim(),
            description: form.description,
            personality: form.personality,
            scenario: form.scenario,
            first_mes: form.first_mes,
            mes_example: form.mes_example,
            creator_notes: form.creator_notes,
            system_prompt: form.system_prompt,
            post_history_instructions: form.post_history_instructions,
            tags: entryInputToArray(form.tags),
            creator: form.creator,
            character_version: form.character_version,
            world: form.world,
            alternate_greetings: inputToAlternateGreetings(form.alternate_greetings),
            depth_prompt_prompt: form.depth_prompt_prompt,
            depth_prompt_depth: numberInput(form.depth_prompt_depth, 4),
            depth_prompt_role: form.depth_prompt_role || 'system',
            talkativeness: numberInput(form.talkativeness, 0.5),
            fav: form.favorite ? 'true' : 'false',
        };
    }

    // 带头像创建时改走 multipart（与旧版创建请求一致）：标签按逗号拼回、备用开场白逐条追加，
    // 发言概率另放进 extensions，保证卡片 V2 字段和 JSON 创建时一样是数字。
    function characterCreateFormData(payload, avatarFile) {
        const formData = new FormData();
        for (const [key, value] of Object.entries(payload)) {
            if (key === 'tags') {
                formData.set('tags', value.join(','));
            } else if (key === 'alternate_greetings') {
                value.forEach(greeting => formData.append('alternate_greetings', greeting));
            } else {
                formData.set(key, String(value ?? ''));
            }
        }
        formData.set('extensions', JSON.stringify({ talkativeness: payload.talkativeness }));
        formData.set('avatar', avatarFile, avatarFile.name || 'avatar.png');
        return formData;
    }

    function characterMergePayload(avatar, form) {
        const tags = entryInputToArray(form.tags);
        const talkativeness = numberInput(form.talkativeness, 0.5);
        const favorite = !!form.favorite;
        const depthPrompt = {
            prompt: form.depth_prompt_prompt || '',
            depth: numberInput(form.depth_prompt_depth, 4),
            role: form.depth_prompt_role || 'system',
        };

        return {
            avatar,
            name: form.name.trim(),
            description: form.description,
            personality: form.personality,
            scenario: form.scenario,
            first_mes: form.first_mes,
            mes_example: form.mes_example,
            creatorcomment: form.creator_notes,
            talkativeness,
            fav: favorite,
            tags,
            data: {
                name: form.name.trim(),
                description: form.description,
                personality: form.personality,
                scenario: form.scenario,
                first_mes: form.first_mes,
                mes_example: form.mes_example,
                creator_notes: form.creator_notes,
                system_prompt: form.system_prompt,
                post_history_instructions: form.post_history_instructions,
                alternate_greetings: inputToAlternateGreetings(form.alternate_greetings),
                tags,
                creator: form.creator,
                character_version: form.character_version,
                extensions: {
                    world: form.world,
                    talkativeness,
                    fav: favorite,
                    depth_prompt: depthPrompt,
                },
            },
        };
    }

    return {
        characterCreateFormData,
        characterCreatePayload,
        characterMergePayload,
        characterToForm,
        defaultCharacterForm,
        getCharacterTags,
        isCharacterFormDirty,
    };
}
