import { createRemoteResourceComponents } from '../components/remote-resources.js';
import { createRemoteResourceEvents } from './remote-resources-events.js';

export function createRemoteResourcesRoute(ctx) {
    const { renderRemoteResources } = createRemoteResourceComponents(ctx);
    const { handleRemoteResourcesClick, handleRemoteResourcesInput, handleRemoteResourcesChange, handleRemoteResourcesKeydown } = createRemoteResourceEvents(ctx);

    async function handleClick(event) {
        return handleRemoteResourcesClick(event);
    }

    function handleInput(event) {
        return handleRemoteResourcesInput(event);
    }

    function handleChange(event) {
        return handleRemoteResourcesChange(event);
    }

    function handleKeydown(event) {
        return handleRemoteResourcesKeydown(event);
    }

    return {
        render: renderRemoteResources,
        handleClick,
        handleInput,
        handleChange,
        handleKeydown,
    };
}
