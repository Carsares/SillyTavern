import { createPresetsComponents } from '../components/presets.js';
import { createPresetsEvents } from './presets-events.js';

export function createPresetsRoute(ctx) {
    const { renderPresets } = createPresetsComponents(ctx);
    const { handlePresetsClick, handlePresetsInput, handlePresetsChange } = createPresetsEvents(ctx);

    async function handleClick(event) {
        return handlePresetsClick(event);
    }

    function handleInput(event) {
        return handlePresetsInput(event);
    }

    async function handleChange(event) {
        return handlePresetsChange(event);
    }

    return {
        render: renderPresets,
        handleClick,
        handleInput,
        handleChange,
    };
}
