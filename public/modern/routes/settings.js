import { createSettingsComponents } from '../components/settings.js';
import { createSettingsEvents } from './settings-events.js';

export function createSettingsRoute(ctx) {
    const { renderSettings } = createSettingsComponents(ctx);
    const {
        handleSettingsChange,
        handleSettingsClick,
        handleSettingsInput,
        handleSettingsKeydown,
    } = createSettingsEvents(ctx);

    async function handleClick(event) {
        return handleSettingsClick(event);
    }

    function handleInput(event) {
        return handleSettingsInput(event);
    }

    async function handleChange(event) {
        return handleSettingsChange(event);
    }

    function handleKeydown(event) {
        return handleSettingsKeydown(event);
    }

    return {
        render: renderSettings,
        handleClick,
        handleInput,
        handleChange,
        handleKeydown,
    };
}
