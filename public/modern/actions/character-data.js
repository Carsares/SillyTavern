import { characterFormDefaults } from '../core/constants.js';
import {
    alternateGreetingsToInput,
    arrayToEntryInput,
    entryInputToArray,
    inputToAlternateGreetings,
    numberInput,
} from '../core/utils.js';

export function createCharacterDataHelpers() {
    function defaultCharacterForm() {
        return { ...characterFormDefaults };
    }

    function getCharacterData(character) {
        return character?.data || {};
    }

    function getCharacterTags(character) {
        const dataTags = getCharacterData(character).tags;
        return Array.isArray(dataTags) ? dataTags : Array.isArray(character?.tags) ? character.tags : [];
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
        characterCreatePayload,
        characterMergePayload,
        characterToForm,
        defaultCharacterForm,
        getCharacterTags,
    };
}
