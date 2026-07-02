import { createDashboardRoute } from '../routes/dashboard.js';
import { createChatRoute } from '../routes/chat.js';
import { createCharactersRoute } from '../routes/characters.js';
import { createGroupsRoute } from '../routes/groups.js';
import { createWorldbooksRoute } from '../routes/worldbooks.js';
import { createPresetsRoute } from '../routes/presets.js';
import { createPersonasRoute } from '../routes/personas.js';
import { createAssetsRoute } from '../routes/assets.js';
import { createApiRoute } from '../routes/api.js';
import { createExtensionsRoute } from '../routes/extensions.js';
import { createActivityRoute } from '../routes/activity.js';
import { createSettingsRoute } from '../routes/settings.js';

export function createRouteModules(routeContext) {
    return {
        dashboard: createDashboardRoute(routeContext),
        chat: createChatRoute(routeContext),
        characters: createCharactersRoute(routeContext),
        groups: createGroupsRoute(routeContext),
        worldbooks: createWorldbooksRoute(routeContext),
        presets: createPresetsRoute(routeContext),
        personas: createPersonasRoute(routeContext),
        assets: createAssetsRoute(routeContext),
        api: createApiRoute(routeContext),
        extensions: createExtensionsRoute(routeContext),
        activity: createActivityRoute(routeContext),
        settings: createSettingsRoute(routeContext),
    };
}
