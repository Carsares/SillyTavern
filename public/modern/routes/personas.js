import { createPersonasComponents } from '../components/personas.js';
import { createPersonasEvents } from './personas-events.js';

export function createPersonasRoute(ctx) {
    const { renderPersonas } = createPersonasComponents(ctx);
    const { handlePersonasClick, handlePersonasInput, handlePersonasChange } = createPersonasEvents(ctx);

    async function handleClick(event) {
        return handlePersonasClick(event);
    }

    function handleInput(event) {
        return handlePersonasInput(event);
    }

    async function handleChange(event) {
        return handlePersonasChange(event);
    }

    return {
        render: renderPersonas,
        handleClick,
        handleInput,
        handleChange,
    };
}
