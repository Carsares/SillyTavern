import { createApiComponents } from '../components/api.js';
import { createApiEvents } from './api-events.js';

export function createApiRoute(ctx) {
    const { renderApi } = createApiComponents(ctx);
    const { handleApiClick, handleApiChange, handleApiSubmit } = createApiEvents(ctx);

    async function handleClick(event) {
        return handleApiClick(event);
    }

    function handleChange(event) {
        return handleApiChange(event);
    }

    async function handleSubmit(event) {
        return handleApiSubmit(event);
    }

    return {
        render: renderApi,
        handleClick,
        handleChange,
        handleSubmit,
    };
}
