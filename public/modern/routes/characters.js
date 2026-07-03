import { createCharactersComponents } from '../components/characters.js';
import { createCharactersEvents } from './characters-events.js';

export function createCharactersRoute(ctx) {
    const { renderCharacters, renderCharacterSelection } = createCharactersComponents(ctx);
    const { handleCharactersClick, handleCharactersInput, handleCharactersChange } = createCharactersEvents(ctx);

    async function handleClick(event) {
        return handleCharactersClick(event);
    }

    function handleInput(event) {
        return handleCharactersInput(event);
    }

    async function handleChange(event) {
        return handleCharactersChange(event);
    }

    return {
        render: renderCharacters,
        renderSelection: renderCharacterSelection,
        handleClick,
        handleInput,
        handleChange,
    };
}
