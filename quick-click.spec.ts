import { expect, test } from '@playwright/test';

test('probe produce button', async ({ page }) => {
  await page.goto('http://127.0.0.1:3024/');
  const btn = page.getByTestId('produce-button-panel');
  await btn.waitFor({ state: 'visible' });
  const enabled = await btn.isEnabled();
  console.log('enabled', enabled);
  const id = await btn.getAttribute('id');
  console.log('id', id);
  await page.getByRole('button', { name: 'Advanced options' }).click();
  await expect(page.getByTestId('public-mcp-origin-input')).toBeVisible();
  await expect(page.getByTestId('save-launch-config')).toBeVisible();
  const smokeButton = page.getByTestId('run-launch-smoke-test');
  await expect(smokeButton).toBeVisible();
  await expect(smokeButton).toBeEnabled();
  const smokeResponsePromise = page.waitForResponse((resp) => resp.url().includes('/api/launch-smoke-test') && resp.request().method() === 'GET');
  await smokeButton.click();
  const smokeResponse = await smokeResponsePromise;
  expect(smokeResponse.status()).toBe(200);
  const smokeJson = await smokeResponse.json();
  expect(smokeJson.local_contract_ready).toBeTruthy();
  expect(smokeJson.uses_image_api_key).toBeFalsy();
  await expect(page.locator('.launch-smoke-status')).toContainText('Local MCP');
});
