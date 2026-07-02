import { createGroupsComponents } from '../components/groups.js';
import { createGroupsEvents } from './groups-events.js';

export function createGroupsRoute(ctx) {
    const { renderGroups } = createGroupsComponents(ctx);
    const { handleGroupsClick, handleGroupsInput, handleGroupsChange } = createGroupsEvents(ctx);

    async function handleClick(event) {
        return handleGroupsClick(event);
    }

    function handleInput(event) {
        return handleGroupsInput(event);
    }

    function handleChange(event) {
        return handleGroupsChange(event);
    }

    return {
        render: renderGroups,
        handleClick,
        handleInput,
        handleChange,
    };
}
