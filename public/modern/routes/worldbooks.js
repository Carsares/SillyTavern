import { createWorldbooksComponents } from '../components/worldbooks.js';
import { createWorldbooksEvents } from './worldbooks-events.js';

export function createWorldbooksRoute(ctx) {
    const { renderWorldbooks } = createWorldbooksComponents(ctx);
    const { handleWorldbooksClick, handleWorldbooksInput, handleWorldbooksChange } = createWorldbooksEvents(ctx);

    async function handleClick(event) {
        return handleWorldbooksClick(event);
    }

    function handleInput(event) {
        return handleWorldbooksInput(event);
    }

    async function handleChange(event) {
        return handleWorldbooksChange(event);
    }

    return {
        render: renderWorldbooks,
        handleClick,
        handleInput,
        handleChange,
    };
}
