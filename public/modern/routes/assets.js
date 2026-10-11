import { createAssetsComponents } from '../components/assets.js';
import { createAssetsEvents } from './assets-events.js';

export function createAssetsRoute(ctx) {
    const { renderAssets } = createAssetsComponents(ctx);
    const { handleAssetsClick, handleAssetsInput, handleAssetsChange } = createAssetsEvents(ctx);

    async function handleClick(event) {
        return handleAssetsClick(event);
    }

    function handleInput(event) {
        return handleAssetsInput(event);
    }

    async function handleChange(event) {
        return handleAssetsChange(event);
    }

    return {
        render: renderAssets,
        handleClick,
        handleInput,
        handleChange,
    };
}
