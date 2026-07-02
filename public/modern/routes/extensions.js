import { createExtensionsComponents } from '../components/extensions.js';
import { createExtensionsEvents } from './extensions-events.js';

export function createExtensionsRoute(ctx) {
    const { renderExtensions } = createExtensionsComponents(ctx);
    const { handleExtensionsClick, handleExtensionsInput, handleExtensionsChange } = createExtensionsEvents(ctx);

    async function handleClick(event) {
        return handleExtensionsClick(event);
    }

    function handleInput(event) {
        return handleExtensionsInput(event);
    }

    function handleChange(event) {
        return handleExtensionsChange(event);
    }

    return {
        render: renderExtensions,
        handleClick,
        handleInput,
        handleChange,
    };
}
