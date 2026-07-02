export function createActivityEvents(ctx) {
    const {
        state,
        render,
        showToast,
        recreateStats,
    } = ctx;

    async function handleActivityClick(event) {
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

    function handleActivityInput(event) {
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-activity-filter]')) {
            state.activityFilter = event.target.value;
            render();
            return true;
        }

        return false;
    }

    function handleActivityChange(event) {
        if (event.target instanceof HTMLSelectElement && event.target.matches('[data-activity-sort]')) {
            state.activitySort = event.target.value;
            localStorage.setItem('st-modern-activity-sort', state.activitySort);
            render();
            return true;
        }

        return false;
    }

    return {
        handleActivityClick,
        handleActivityInput,
        handleActivityChange,
    };
}
