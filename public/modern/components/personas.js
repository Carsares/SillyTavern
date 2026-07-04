import { createPersonaCardComponents } from './persona-cards.js';

export function createPersonasComponents(ctx) {
    const {
        state,
        pageHead,
        renderEmptyState,
        renderRouteFilter,
        matchesQuery,
        getPersonas,
    } = ctx;
    const {
        renderPersonaCard,
        renderPersonaCreatePanel,
    } = createPersonaCardComponents(ctx);

    function renderPersonas() {
        const selectedPersonaId = state.selected.persona;
        const personas = getPersonas()
            .filter(persona => matchesQuery(persona.name, persona.title, persona.description, persona.avatarId))
            .sort((a, b) => Number(b.avatarId === selectedPersonaId) - Number(a.avatarId === selectedPersonaId));

        return `
        ${pageHead('用户人设', '头像、标题和默认身份。', `
            <button class="primary-button" type="button" data-create-persona>
                <i class="fa-solid fa-plus"></i>
                新建人设
            </button>
        `)}
        ${state.personaCreating.active ? renderPersonaCreatePanel() : ''}
        <div class="route-filter-strip">
            ${renderRouteFilter('筛选人设', '名称、标题、描述或头像 ID')}
        </div>
        <div class="grid-list">
            ${personas.map(persona => renderPersonaCard(persona, selectedPersonaId)).join('') || renderEmptyState('fa-user-gear', '暂无用户人设', '当前目录没有用户人设。')}
        </div>
    `;
    }

    return {
        renderPersonas,
    };
}
