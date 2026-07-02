import { test, expect } from '@playwright/test';

const modernRoutes = [
    ['dashboard', '工作台'],
    ['chat', '聊天工作区'],
    ['characters', '角色库'],
    ['groups', '群组管理'],
    ['worldbooks', '世界书'],
    ['presets', '预设管理'],
    ['personas', '用户人设'],
    ['assets', '素材库'],
    ['api', 'API 连接管理'],
    ['extensions', '扩展'],
    ['activity', '活动与统计'],
    ['settings', '设置中心'],
];

test.describe('Modern workspace', () => {
    for (const [route, title] of modernRoutes) {
        test(`renders ${route}`, async ({ page }) => {
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            page.on('console', message => {
                if (message.type() === 'error') {
                    errors.push(message.text());
                }
            });

            await page.goto(`/modern/?view=${route}`);

            await expect(page.locator('.brand-title')).toHaveText('SillyTavern');
            await expect(page.locator('.page-title')).toHaveText(title);
            await expect(page.locator('.nav-button.active')).toBeVisible();
            expect(errors).toEqual([]);
        });
    }
});
