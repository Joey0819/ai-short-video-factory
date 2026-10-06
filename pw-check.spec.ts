import { test, expect } from '@playwright/test';
import path from 'node:path';

test('can click produce and get artifacts', async ({ page }) => {
  await page.goto('http://127.0.0.1:3024/', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Total episodes').fill('1');
  await page.getByLabel('Provider mode').selectOption('local');
  const produceButton = page.getByTestId('produce-button-panel');
  await expect(produceButton).toBeVisible();
  await expect(produceButton).toBeEnabled();
  const respPromise = page.waitForResponse((resp) => resp.url().includes('/api/produce') && resp.request().method() === 'POST');
  await produceButton.click();
  const response = await respPromise;
  expect(response.status()).toBe(200);
  const json = await response.json();
  expect(json.ok).toBeTruthy();
  expect(Array.isArray(json.artifacts)).toBeTruthy();
  expect(json.artifacts.length).toBeGreaterThan(0);
  await expect(page.locator('a.artifact-action').filter({ hasText: 'Image 2 handoff' })).toBeVisible();

  const attachButton = page.getByRole('button', { name: 'Attach Image 2 stills' });
  await expect(attachButton).toBeVisible();
  await expect(attachButton).toBeEnabled();
  const attachResponsePromise = page.waitForResponse((resp) => resp.url().includes('/api/image2-assets') && resp.request().method() === 'POST');
  const fileChooserPromise = page.waitForEvent('filechooser');
  await attachButton.click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(path.join(process.cwd(), 'public/assets/fruit-drama-preview.png'));
  const attachResponse = await attachResponsePromise;
  expect(attachResponse.status()).toBe(200);
  const attachJson = await attachResponse.json();
  expect(attachJson.ok).toBeTruthy();
  expect(attachJson.asset_manifest.asset_count).toBeGreaterThan(0);
  expect(attachJson.asset_manifest.uses_api_key).toBeFalsy();
  expect(attachJson.render.image2_asset_count).toBeGreaterThan(0);
  await expect(page.locator('a.artifact-action').filter({ hasText: 'Image 2 assets' })).toBeVisible();
});

test('can click topbar produce button and get artifacts', async ({ page }) => {
  await page.goto('http://127.0.0.1:3024/', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Total episodes').fill('1');
  await page.getByLabel('Provider mode').selectOption('local');
  const topbarProduceButton = page.getByTestId('produce-button-topbar');
  await expect(topbarProduceButton).toBeVisible();
  await expect(topbarProduceButton).toBeEnabled();

  const produceResponsePromise = page.waitForResponse((response) =>
    response.url().includes('/api/produce') && response.request().method() === 'POST'
  );
  await topbarProduceButton.click();
  const produceResponse = await produceResponsePromise;
  expect(produceResponse.status()).toBe(200);

  const json = await produceResponse.json();
  expect(json.ok).toBeTruthy();
  expect(Array.isArray(json.artifacts)).toBeTruthy();
  expect(json.artifacts.length).toBeGreaterThan(0);
});
