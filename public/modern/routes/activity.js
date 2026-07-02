import { createActivityComponents } from '../components/activity.js';
import { createActivityEvents } from './activity-events.js';

export function createActivityRoute(ctx) {
    const { renderActivity } = createActivityComponents(ctx);
    const { handleActivityClick, handleActivityInput, handleActivityChange } = createActivityEvents(ctx);

    async function handleClick(event) {
        return handleActivityClick(event);
    }

    function handleInput(event) {
        return handleActivityInput(event);
    }

    function handleChange(event) {
        return handleActivityChange(event);
    }

    return {
        render: renderActivity,
        handleClick,
        handleInput,
        handleChange,
    };
}
