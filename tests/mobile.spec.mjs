import { expect, test } from '@playwright/test';

const devices = [
    { name: 'compact phone', viewport: { width: 360, height: 740 } },
    { name: 'large phone', viewport: { width: 430, height: 932 } }
];

for (const device of devices) {
    test.describe(device.name, () => {
        test.use({ viewport: device.viewport, isMobile: true, hasTouch: true });

        test('main pages fit without horizontal overflow', async ({ page }) => {
            await page.goto('/');
            await expect(page.locator('#loadingOverlay')).toHaveClass(/hidden/);

            for (const tab of ['dashboard', 'logs', 'add', 'progress', 'catalog', 'health']) {
                await page.locator(`.tab-button[data-tab="${tab}"]`).click();
                const overflow = await page.evaluate(() =>
                    document.documentElement.scrollWidth - document.documentElement.clientWidth
                );
                expect(overflow).toBeLessThanOrEqual(1);
            }
        });

        test('bottom navigation stays fixed and content clears it', async ({ page }) => {
            await page.goto('/');
            await page.locator('.tab-button[data-tab="add"]').click();
            const layout = await page.evaluate(() => {
                const nav = document.querySelector('.tabs-container').getBoundingClientRect();
                const main = document.querySelector('.container');
                return {
                    navBottomGap: Math.abs(window.innerHeight - nav.bottom),
                    navHeight: nav.height,
                    mainPaddingBottom: Number.parseFloat(getComputedStyle(main).paddingBottom)
                };
            });
            expect(layout.navBottomGap).toBeLessThanOrEqual(1);
            expect(layout.mainPaddingBottom).toBeGreaterThan(layout.navHeight);
        });

        test('add form controls have usable touch targets', async ({ page }) => {
            await page.goto('/');
            await page.locator('.tab-button[data-tab="add"]').click();
            for (const selector of ['#searchInput', '#gramsInput', '#portionUnit', '#mealType', '#addButton']) {
                const box = await page.locator(selector).boundingBox();
                expect(box?.height || 0).toBeGreaterThanOrEqual(42);
            }
        });
    });
}
