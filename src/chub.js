import fs from 'node:fs';
import path from 'node:path';

import fetch from 'node-fetch';
import sanitize from 'sanitize-filename';

import { write } from './character-card-parser.js';
import { DEFAULT_AVATAR_PATH } from './constants.js';
import { serverDirectory } from './server-directory.js';

const USER_AGENT = 'SillyTavern';

export async function downloadChubLorebook(id, cookie) {
    const [lorebooks, creatorName, projectName] = id.split('/');
    // 可选注入已配置的 Chub cookie，携带登录态访问受限世界书；未传时保持匿名行为
    const headers = { 'Accept': 'application/json', 'User-Agent': USER_AGENT };
    if (cookie) {
        headers['Cookie'] = cookie;
    }
    const result = await fetch(`https://api.chub.ai/api/${lorebooks}/${creatorName}/${projectName}`, {
        method: 'GET',
        headers: headers,
    });

    if (!result.ok) {
        const text = await result.text();
        console.error('Chub returned error', result.statusText, text);
        throw new Error('Failed to fetch lorebook metadata');
    }

    /** @type {any} */
    const metadata = await result.json();
    const projectId = metadata.node?.id;

    if (!projectId) {
        throw new Error('Project ID not found in lorebook metadata');
    }

    const downloadUrl = `https://api.chub.ai/api/v4/projects/${projectId}/repository/files/raw%252Fsillytavern_raw.json/raw`;
    const downloadResult = await fetch(downloadUrl, {
        method: 'GET',
        headers: headers,
    });

    if (!downloadResult.ok) {
        const text = await downloadResult.text();
        console.error('Chub returned error', downloadResult.statusText, text);
        throw new Error('Failed to download lorebook');
    }

    const name = projectName;
    const buffer = Buffer.from(await downloadResult.arrayBuffer());
    const fileName = `${sanitize(name)}.json`;
    const fileType = downloadResult.headers.get('content-type');

    return { buffer, fileName, fileType };
}

export async function downloadChubCharacter(id, cookie) {
    const [creatorName, projectName] = id.split('/');
    // 可选注入已配置的 Chub cookie，携带登录态访问受限角色；未传时保持匿名行为
    const headers = { 'Accept': 'application/json', 'User-Agent': USER_AGENT };
    if (cookie) {
        headers['Cookie'] = cookie;
    }
    const result = await fetch(`https://api.chub.ai/api/characters/${creatorName}/${projectName}?full=true`, {
        method: 'GET',
        headers: headers,
    });

    if (!result.ok) {
        const text = await result.text();
        console.error('Chub returned error', result.statusText, text);
        throw new Error('Failed to fetch character metadata');
    }

    /** @type {any} */
    const metadata = await result.json();
    const { definition, topics } = metadata.node;

    /** @type {TavernCardV2} */
    const characterCard = {
        data: {
            name: definition.name,
            description: definition.personality,
            personality: definition.tavern_personality,
            scenario: definition.scenario,
            first_mes: definition.first_message,
            mes_example: definition.example_dialogs,
            creator_notes: definition.description,
            system_prompt: definition.system_prompt,
            post_history_instructions: definition.post_history_instructions,
            alternate_greetings: definition.alternate_greetings,
            tags: topics,
            creator: creatorName,
            character_version: '',
            character_book: definition.embedded_lorebook,
            extensions: definition.extensions,
        },
        spec: 'chara_card_v2',
        spec_version: '2.0',
    };

    const defaultAvatarPath = path.join(serverDirectory, DEFAULT_AVATAR_PATH);
    const defaultAvatarBuffer = fs.readFileSync(defaultAvatarPath);

    let imageBuffer = defaultAvatarBuffer;

    const imageUrl = metadata.node?.max_res_url;

    if (imageUrl) {
        // 有 cookie 时同样携带登录态拉取受限图片，未传时保持原匿名请求
        const downloadResult = await fetch(imageUrl, cookie ? { headers: { 'Cookie': cookie } } : undefined);
        if (downloadResult.ok) {
            imageBuffer = Buffer.from(await downloadResult.arrayBuffer());
        }
    }

    const buffer = write(imageBuffer, JSON.stringify(characterCard));
    const fileName = `${sanitize(characterCard.data.name)}.png`;
    const fileType = 'image/png';

    return { buffer, fileName, fileType };
}

/**
 *
 * @param {String} str
 * @returns { { id: string, type: "character" | "lorebook" } | null }
 */
export function parseChubUrl(str) {
    const splitStr = str.split('/');
    const length = splitStr.length;

    if (length < 2) {
        return null;
    }

    let domainIndex = -1;

    splitStr.forEach((part, index) => {
        if (part === 'www.chub.ai' || part === 'chub.ai' || part === 'www.characterhub.org' || part === 'characterhub.org') {
            domainIndex = index;
        }
    });

    const lastTwo = domainIndex !== -1 ? splitStr.slice(domainIndex + 1) : splitStr;

    const firstPart = lastTwo[0].toLowerCase();

    if (firstPart === 'characters' || firstPart === 'lorebooks') {
        const type = firstPart === 'characters' ? 'character' : 'lorebook';
        const id = type === 'character' ? lastTwo.slice(1).join('/') : lastTwo.join('/');
        return {
            id: id,
            type: type,
        };
    } else if (length === 2) {
        return {
            id: lastTwo.join('/'),
            type: 'character',
        };
    }

    return null;
}
