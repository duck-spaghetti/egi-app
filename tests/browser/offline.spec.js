/** Actual service worker/cache/IndexedDB desktop behavior on the narrow offline routes. */
import {test,expect} from '@playwright/test';
import {openMap,saveTo} from './helpers.js';

test('saved shell reopens offline, preserves data and never caches private/API/map material',async({page,context})=>{
  await openMap(page);await page.locator('#poi-list [data-favorite-id]').click();await saveTo(page);
  await page.goto('/preferiti');
  await expect(page.locator('.favorite-card')).toContainText('Sportello orientamento');
  const urls=await page.evaluate(async()=>{
    const keys=[];for(const name of await caches.keys())for(const request of await (await caches.open(name)).keys())keys.push(new URL(request.url).pathname);
    return keys;
  });
  expect(urls).toContain('/preferiti/liste');
  expect(urls.some(path=>path.startsWith('/api/') || path.startsWith('/moderazione') || path==='/map')).toBe(false);
  await context.setOffline(true);await page.reload();
  await expect(page.locator('.favorite-card')).toContainText('Sportello orientamento');
  await expect(page.locator('.favorite-card')).toContainText('Associazione Alfa');
  await page.goto('/preferiti/liste');
  await page.locator('#lists-create input').fill('Lista offline');
  await page.locator('#lists-create [type="submit"]').click();
  await expect(page.locator('#collection-title')).toHaveText('Lista offline');
  await page.reload();await expect(page.locator('#collection-title')).toHaveText('Lista offline');
  await page.locator('a[href="/preferiti"]').click();
  await expect(page.locator('.favorite-card')).toContainText('Sportello orientamento');
});

test('failed offline-shell preparation cannot report a successful save',async({page})=>{
  // This real network fault is seen by the service worker's allowlist install.
  await page.context().route('**/translations/fr.json',route=>route.fulfill({status:503,body:'fixture unavailable'}));
  await openMap(page);await page.locator('#poi-list [data-favorite-id]').click();
  const dialog=page.locator('dialog[open]');await dialog.locator('[type="submit"]').click();
  await expect(dialog.locator('[role="status"]')).not.toBeEmpty();
  await expect(page.locator('#poi-list [data-favorite-id]')).toHaveAttribute('aria-pressed','false');
  await dialog.locator('[data-cancel]').click();await expect(dialog).not.toBeVisible();
});
