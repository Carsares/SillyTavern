import { createDashboardComponents } from '../components/dashboard.js';

export function createDashboardRoute(ctx) {
    const { renderDashboard } = createDashboardComponents(ctx);

    return {
        render: renderDashboard,
    };
}
