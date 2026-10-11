import { test, expect } from '@playwright/test';
import { createModernResourceFixture, gotoModern, mockModernWorkspace } from './modern-test-utils.js';

// Group creation writes the first chat file before registering it; record the order of both requests.
async function mockGroupChatFiles(page, fixture) {
    fixture.requests.groupChatSave = [];
    fixture.requests.groupChatDelete = [];
    fixture.requests.order = [];
    await page.route('**/api/chats/group/save', route => {
        const payload = route.request().postDataJSON();
        fixture.requests.groupChatSave.push(payload);
        fixture.requests.order.push('chat-save');
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, integrity: 'e2e-integrity' }) });
    });
    await page.route('**/api/chats/group/delete', route => {
        fixture.requests.groupChatDelete.push(route.request().postDataJSON());
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await page.route('**/api/groups/create', route => {
        fixture.requests.order.push('group-create');
        return route.fallback();
    });
}

test.describe('Modern group resources', () => {
    test('opens group creation from the empty state call to action', async ({ page }) => {
        const fixture = createModernResourceFixture({ groups: [] });
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'groups', '群组管理');

        await expect(page.locator('.empty-state', { hasText: '暂无群组' })).toBeVisible();
        await page.locator('.empty-state [data-create-group]').click();

        await expect(page.locator('.settings-form', { hasText: '新建群组' })).toBeVisible();
        expect(fixture.requests.groupCreate).toHaveLength(0);
    });

    test('creates and edits a group in the modern workspace', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);
        await mockGroupChatFiles(page, fixture);

        await gotoModern(page, 'groups', '群组管理');

        await page.locator('[data-create-group]').click();
        await expect(page.locator('.settings-form', { hasText: '新建群组' })).toBeVisible();
        await expect(page.locator('[data-group-field="activation_strategy"][data-group-scope="create"] option')).toHaveText([
            '自然顺序',
            '列表顺序',
            '手动',
            '随机轮流顺序',
        ]);
        await page.locator('[data-group-field="name"][data-group-scope="create"]').fill('Modern Test Group');
        await page.locator('[data-group-field="activation_strategy"][data-group-scope="create"]').selectOption('3');
        await page.locator('[data-group-member="alice.png"][data-group-scope="create"]').check();
        await page.locator('[data-group-member="bruno.png"][data-group-scope="create"]').check();
        await page.locator('[data-save-group-create]').click();

        await expect(page.locator('.detail-title')).toHaveText('Modern Test Group');
        await expect(page.locator('[data-select-group="modern-test-group"]')).toBeVisible();
        expect(fixture.requests.groupCreate[0]).toMatchObject({
            name: 'Modern Test Group',
            members: ['alice.png', 'bruno.png'],
            activation_strategy: 3,
        });
        // The first chat file is written before the group registers it, so the registered chat always has a file.
        expect(fixture.requests.order).toEqual(['chat-save', 'group-create']);
        const initialChatId = fixture.requests.groupChatSave[0].id;
        expect(initialChatId).toMatch(/^Modern \d{4}-\d{2}-\d{2}T/);
        // Like a new group chat from the chat page and the legacy UI, the first chat starts with each member's greeting.
        const initialChat = fixture.requests.groupChatSave[0].chat;
        expect(initialChat[0]).toEqual({ chat_metadata: {}, user_name: 'unused', character_name: 'unused' });
        expect(initialChat.slice(1)).toEqual([
            expect.objectContaining({ name: 'Alice Fixture', is_user: false, mes: 'Hello from Alice.', original_avatar: 'alice.png' }),
            expect.objectContaining({ name: 'Bruno Fixture', is_user: false, mes: 'Hello from Bruno.', original_avatar: 'bruno.png' }),
        ]);
        expect(fixture.requests.groupCreate[0]).toMatchObject({ chat_id: initialChatId, chats: [initialChatId] });
        await expect(page.locator('[data-select-group="modern-test-group"]')).toContainText('1 个会话');

        await page.locator('[data-edit-group="modern-test-group"]').click();
        await expect(page.locator('.settings-form', { hasText: '编辑群组' })).toBeVisible();
        await expect(page.locator('[data-group-field="activation_strategy"][data-group-scope="edit"]')).toHaveValue('3');
        await page.locator('[data-group-field="name"][data-group-scope="edit"]').fill('Edited Modern Group');
        await page.locator('[data-group-field="allow_self_responses"][data-group-scope="edit"]').check();
        await page.locator('[data-group-field="generation_mode"][data-group-scope="edit"]').selectOption('1');
        await page.locator('[data-group-member="bruno.png"][data-group-scope="edit"]').uncheck();
        await page.locator('[data-save-group-edit]').click();

        await expect(page.locator('.detail-title')).toHaveText('Edited Modern Group');
        await expect(page.locator('.detail-tags')).toContainText('允许自回复');
        await expect(page.locator('.panel-subtitle').filter({ hasText: 'modern-test-group' })).toContainText('1 个成员');
        await expect(page.locator('.resource-row', { hasText: 'Bruno Fixture' })).toHaveCount(0);
        expect(fixture.requests.groupEdit[0]).toMatchObject({
            id: 'modern-test-group',
            name: 'Edited Modern Group',
            members: ['alice.png'],
            allow_self_responses: true,
            generation_mode: 1,
        });
    });

    test('requires confirmation before deleting a group', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'groups', '群组管理');

        const deleteGroupButton = page.locator('[data-delete-group="group-alpha"]');
        await expect(deleteGroupButton).toHaveText('删除');
        await expect(deleteGroupButton).toHaveClass(/danger-action/);
        await expect(deleteGroupButton.locator('.fa-trash-can')).toHaveCount(1);
        await deleteGroupButton.click();
        await expect(page.locator('.danger-panel', { hasText: '删除群组' })).toBeVisible();
        await page.locator('[data-cancel-group-delete]').click();

        await expect(page.locator('.danger-panel', { hasText: '删除群组' })).toHaveCount(0);
        expect(fixture.requests.groupDelete).toHaveLength(0);

        await page.locator('[data-delete-group="group-alpha"]').click();
        await page.locator('[data-confirm-group-delete]').click();

        await expect(page.locator('[data-select-group="group-alpha"]')).toHaveCount(0);
        await expect(page.locator('[data-select-group="group-beta"]')).toBeVisible();
        expect(fixture.requests.groupDelete[0]).toMatchObject({ id: 'group-alpha' });
        const deleteToast = page.locator('.toast', { hasText: '群组已删除' });
        await expect(deleteToast).toContainText('Alpha Group');
        await expect(deleteToast).not.toContainText('group-alpha');
    });

    test('aligns the empty state create button icon with its label', async ({ page }) => {
        const fixture = createModernResourceFixture({ groups: [] });
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'groups', '群组管理');

        const button = page.locator('.empty-state [data-create-group]');
        const icon = button.locator('.fa-plus');
        await expect(icon).toBeVisible();
        const style = await icon.evaluate(element => {
            const view = element.ownerDocument.defaultView;
            const computed = view.getComputedStyle(element);
            const buttonStyle = view.getComputedStyle(element.closest('button'));
            return { marginBottom: computed.marginBottom, fontSize: computed.fontSize, color: computed.color, buttonFontSize: buttonStyle.fontSize, buttonColor: buttonStyle.color };
        });
        // The empty state's large decorative icon style (28px, muted, 12px bottom margin) must not reach the button icon.
        expect(style.marginBottom).toBe('0px');
        expect(style.fontSize).toBe(style.buttonFontSize);
        expect(style.color).toBe(style.buttonColor);

        const buttonBox = await button.boundingBox();
        const iconBox = await icon.boundingBox();
        const buttonCenter = buttonBox.y + buttonBox.height / 2;
        const iconCenter = iconBox.y + iconBox.height / 2;
        expect(Math.abs(buttonCenter - iconCenter)).toBeLessThan(3);
    });

    test('shows the missing member error next to the member picker', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);
        await mockGroupChatFiles(page, fixture);

        await gotoModern(page, 'groups', '群组管理');

        await page.locator('.page-head [data-create-group]').click();
        await page.locator('[data-save-group-create]').click();

        const error = page.locator('[data-group-members-error="create"]');
        await expect(error).toHaveText('请至少选择一个角色成员。');
        await expect(page.locator('[data-group-members-section="create"] .checkbox-grid')).toHaveAttribute('aria-invalid', 'true');
        await expect(page.locator('[data-group-member="alice.png"][data-group-scope="create"]')).toBeFocused();
        expect(fixture.requests.groupCreate).toHaveLength(0);
        expect(fixture.requests.groupChatSave).toHaveLength(0);

        await page.locator('[data-group-member="alice.png"][data-group-scope="create"]').check();
        await expect(error).toHaveCount(0);
        await expect(page.locator('[data-group-members-section="create"] .checkbox-grid')).not.toHaveAttribute('aria-invalid', 'true');

        await page.locator('[data-edit-group="group-alpha"]').click();
        await page.locator('[data-group-member="alice.png"][data-group-scope="edit"]').uncheck();
        await page.locator('[data-group-member="bruno.png"][data-group-scope="edit"]').uncheck();
        await page.locator('[data-save-group-edit]').click();

        await expect(page.locator('[data-group-members-error="edit"]')).toHaveText('请至少选择一个角色成员。');
        expect(fixture.requests.groupEdit).toHaveLength(0);
    });

    test('counts only group chats that have a chat file', async ({ page }) => {
        const fixture = createModernResourceFixture({
            groups: [{
                id: '1791642338506',
                name: 'Counted Group',
                avatar_url: '',
                members: ['alice.png'],
                chats: ['1791642338506', 'Modern 2026-10-11T00-00-00-000Z', 'Second chat'],
                chat_count: 2,
                chat_size: 4096,
                allow_self_responses: false,
                activation_strategy: 0,
                generation_mode: 0,
                auto_mode_delay: 5,
                fav: false,
            }],
        });
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'groups', '群组管理');

        await expect(page.locator('[data-select-group="1791642338506"]')).toContainText('2 个会话');
        await expect(page.locator('.detail-hero .panel-subtitle')).toContainText('2 个会话');
        const chatMetric = page.locator('.metric-card', { hasText: '聊天文件' });
        await expect(chatMetric.locator('.metric-value')).toHaveText('2');
        await expect(chatMetric).toContainText('1 个登记的会话没有文件');
    });
});
