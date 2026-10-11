import { createCharactersComponents } from '../components/characters.js';
import { createCharactersEvents } from './characters-events.js';

export function createCharactersRoute(ctx) {
    const { renderCharacters, renderCharacterSelection, refreshCharacterFormActions } = createCharactersComponents(ctx);
    const { handleCharactersClick, handleCharactersInput, handleCharactersChange } = createCharactersEvents(ctx);

    function refreshFormActionsFor(event) {
        const scope = event.target instanceof HTMLElement ? event.target.dataset.characterScope : '';
        if (scope) {
            refreshCharacterFormActions(scope);
        }
    }

    async function handleClick(event) {
        return handleCharactersClick(event);
    }

    function handleInput(event) {
        const result = handleCharactersInput(event);
        refreshFormActionsFor(event);
        return result;
    }

    async function handleChange(event) {
        const result = await handleCharactersChange(event);
        refreshFormActionsFor(event);
        return result;
    }

    return {
        render: renderCharacters,
        renderSelection: renderCharacterSelection,
        handleClick,
        handleInput,
        handleChange,
    };
}
