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

    test('shows text completion API as read-only in the modern editor', async ({ page }) => {
        await page.goto('/modern/?view=api');

        await expect(page.locator('.page-title')).toHaveText('API 连接管理');
        await page.locator('[data-api-main]').selectOption('textgenerationwebui');

        await expect(page.locator('.form-section-title', { hasText: '文本补全档案' })).toBeVisible();
        await expect(page.locator('[data-save-api-connection]')).toHaveCount(0);
    });

    test('hides irrelevant API fields for SiliconFlow', async ({ page }) => {
        await page.goto('/modern/?view=api');

        await expect(page.locator('.page-title')).toHaveText('API 连接管理');
        await page.locator('[data-api-main]').selectOption('openai');
        await page.locator('[data-api-source]').selectOption('siliconflow');

        await expect(page.locator('[data-api-field="siliconflow-endpoint"]')).toBeVisible();
        await expect(page.locator('[data-api-field="custom-url"]')).toBeHidden();
    });

    test('does not show refresh toast on initial load', async ({ page }) => {
        await page.goto('/modern/?view=dashboard');

        await expect(page.locator('.page-title')).toHaveText('工作台');
        await expect(page.locator('.toast', { hasText: '刷新完成' })).toHaveCount(0);
    });

    test('shows generation engine controls on chat page', async ({ page }) => {
        await page.goto('/modern/?view=chat');

        await expect(page.locator('.page-title')).toHaveText('聊天工作区');
        await expect(page.locator('.engine-panel')).toBeVisible();
        await expect(page.locator('[data-check-generation-engine]')).toBeVisible();
    });

    test('prioritizes the chat thread on mobile', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/modern/?view=chat');

        await expect(page.locator('.page-title')).toHaveText('聊天工作区');
        await expect(page.locator('.chat-thread')).toBeVisible();
        await expect(page.locator('.chat-browser')).toHaveCount(0);
        await expect(page.locator('[data-toggle-chat-sidebar]', { hasText: '展开列表' })).toBeVisible();
    });

    test('loads more backgrounds instead of hard truncating asset grid', async ({ page }) => {
        const images = Array.from({ length: 30 }, (_, index) => ({
            filename: `mock-background-${index + 1}.jpg`,
            isAnimated: false,
        }));
        await page.route('**/api/backgrounds/all', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ images }),
        }));

        await page.goto('/modern/?view=assets');

        await expect(page.locator('.page-title')).toHaveText('素材库');
        await expect(page.locator('.background-card')).toHaveCount(24);
        await expect(page.locator('[data-load-more-backgrounds]')).toBeVisible();

        await page.locator('[data-load-more-backgrounds]').click();

        await expect(page.locator('.background-card')).toHaveCount(30);
        await expect(page.locator('[data-load-more-backgrounds]')).toHaveCount(0);
    });
});
