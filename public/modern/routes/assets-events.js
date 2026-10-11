import { createAssetsBackgroundEvents } from './assets-background-events.js';
import { createAssetsFileEvents } from './assets-file-events.js';

export function createAssetsEvents(ctx) {
    const {
        state,
        render,
    } = ctx;
    const backgroundEvents = createAssetsBackgroundEvents(ctx);
    const fileEvents = createAssetsFileEvents(ctx);

    async function handleAssetsClick(event) {
        const assetTabButton = event.target.closest('[data-asset-tab]');
        if (assetTabButton) {
            state.assetTab = assetTabButton.dataset.assetTab === 'files' ? 'files' : 'backgrounds';
            localStorage.setItem('st-modern-asset-tab', state.assetTab);
            render();
            return true;
        }

        return await backgroundEvents.handleAssetsBackgroundClick(event) || await fileEvents.handleAssetsFileClick(event);
    }

    function handleAssetsInput(event) {
        return backgroundEvents.handleAssetsBackgroundInput(event) || fileEvents.handleAssetsFileInput(event);
    }

    async function handleAssetsChange(event) {
        return await backgroundEvents.handleAssetsBackgroundChange(event) || fileEvents.handleAssetsFileChange(event);
    }

    return {
        handleAssetsClick,
        handleAssetsInput,
        handleAssetsChange,
    };
}
