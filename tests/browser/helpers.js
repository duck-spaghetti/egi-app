/** Drive visible production controls; imports below seed only synthetic public data. */
import {expect} from '@playwright/test';
export const SERVICE='00000000-0000-0000-0000-000000000001';
export async function openMap(page, language='it') {
  await page.route('https://**/*', route=>route.abort());
  await page.goto('/map?lang='+language);
  await expect(page.locator('#poi-list .poi-item').first()).toBeAttached();
  await page.locator('#view-toggle').click();
  await expect(page.locator('#poi-list .poi-item').first()).toBeVisible();
}
export async function openSaved(page) {
  await page.locator('[data-sheet="settings"]').click();
  await page.locator('#open-favorites').click();
  await expect(page.locator('#sheet-saved')).toHaveClass(/shown/);
}
export async function saveTo(page, collection='favorites', name) {
  const dialog=page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  await dialog.locator('select').selectOption(collection);
  if(collection==='new')await dialog.locator('input[name="name"]').fill(name);
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).not.toBeVisible();
}
export async function seedCollection(page, language='it', count=1) {
  return page.evaluate(async ({language,count})=>{
    const {createCollections}=await import('/static/js/features/favorites/collections.js');
    const collections=createCollections({territory:'roma',now:()=> '2026-11-27T10:00:00Z'});
    const id=await collections.create(language==='ar'?'قائمة اختبار':'Lista di verifica');
    const response=await fetch('/api/public/services/00000000-0000-0000-0000-000000000001?language='+language);
    const card=await response.json();
    for(let i=0;i<count;i++){const item=crypto.randomUUID();await collections.cards(id).saveCopy({id:item,status:'saved',card:{...card,id:item,name:card.name+' '+(i+1),service_title:card.name+' '+(i+1)},
      language,savedAt:'2026-11-20T10:00:00Z',updatedAt:'2026-11-27T10:00:00Z'});}
    return id;
  },{language,count});
}
