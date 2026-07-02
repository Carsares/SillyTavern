import { createSettingsComponents } from '../components/settings.js';
import { createSettingsEvents } from './settings-events.js';

export function createSettingsRoute(ctx) {
    const { renderSettings } = createSettingsComponents(ctx);
    const { handleSettingsClick } = createSettingsEvents(ctx);

    async function handleClick(event) {
        return handleSettingsClick(event);
    }

    return {
        render: renderSettings,
        handleClick,
    };
}
