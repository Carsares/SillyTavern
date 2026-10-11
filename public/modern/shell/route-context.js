import {
    createActivityRouteContext,
    createApiRouteContext,
    createAssetRouteContext,
    createCharacterRouteContext,
    createChatContextRouteContext,
    createChatFileRouteContext,
    createChatGenerationRouteContext,
    createChatMessageRouteContext,
    createComponentRouteContext,
    createExtensionRouteContext,
    createFeatureSlotRouteContext,
    createGroupRouteContext,
    createPersonaRouteContext,
    createPresetRouteContext,
    createRemoteResourceRouteContext,
    createSettingsRouteContext,
    createWorldbookRouteContext,
} from './route-context-parts.js';

export function createRouteContext({
    state,
    activity,
    api,
    assets,
    characters,
    chatContext,
    chatFiles,
    chatGeneration,
    chatMessages,
    components,
    constants,
    extensions,
    featureSlots = {},
    groups,
    personas,
    presets,
    remoteResources,
    settings,
    shell,
    utils,
    worldbooks,
}) {
    const context = {
        state,
        ...utils,
        ...createComponentRouteContext(components),
        ...shell,
        ...createActivityRouteContext(activity),
        ...constants,
        ...createApiRouteContext(api),
        ...createAssetRouteContext(assets),
        ...createCharacterRouteContext(characters),
        ...createChatContextRouteContext(chatContext),
        ...createChatFileRouteContext(chatFiles),
        ...createChatGenerationRouteContext(chatGeneration),
        ...createChatMessageRouteContext(chatMessages),
        ...createExtensionRouteContext(extensions),
        ...createGroupRouteContext(groups),
        ...createPersonaRouteContext(personas),
        ...createPresetRouteContext(presets),
        ...createRemoteResourceRouteContext(remoteResources),
        ...createSettingsRouteContext(settings),
        ...createWorldbookRouteContext(worldbooks),
    };

    // 界面插槽的动作最后并入，并保证不覆盖上面已有的任何名字
    const slotContext = createFeatureSlotRouteContext(featureSlots);
    for (const name of Object.keys(slotContext)) {
        if (Object.hasOwn(context, name)) {
            throw new Error(`Feature slot action "${name}" collides with an existing route context entry.`);
        }
    }

    return { ...context, ...slotContext };
}
