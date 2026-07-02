import { createActivityComponents } from '../components/activity.js';

export function createActivityRoute(ctx) {
    const {
        state,
        render,
        showToast,
        recreateStats,
    } = ctx;
    const { renderActivity } = createActivityComponents(ctx);

    async function handleClick(event) {
        if (event.target.closest('[data-recreate-stats]')) {
            try {
                await recreateStats();
            } catch (error) {
                state.errors.push({ key: 'stats-recreate', message: error.message });
                showToast('统计重建失败', error.message);
                render();
            }
            return;
        }


        return false;
    }

    function handleInput(event) {
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-activity-filter]')) {
            state.activityFilter = event.target.value;
            render();
            return true;
        }

        return false;
    }

    function handleChange(event) {
        if (event.target instanceof HTMLSelectElement && event.target.matches('[data-activity-sort]')) {
            state.activitySort = event.target.value;
            localStorage.setItem('st-modern-activity-sort', state.activitySort);
            render();
            return true;
        }

        return false;
    }

    return {
        render: renderActivity,
        handleClick,
        handleInput,
        handleChange,
    };
}
