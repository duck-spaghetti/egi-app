/** Inspect actual Chromium print artifacts independently from native dialog acceptance. */
import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {seedCollection} from './helpers.js';

function inspect(path, expected){
  if(!fs.existsSync(path) || fs.statSync(path).size<1000)throw Error('Missing/empty PDF artifact');
  const metadata=execFileSync('pdfinfo',[path],{encoding:'utf8'});
  const text=execFileSync('pdftotext',['-layout',path,'-'],{encoding:'utf8'});
  const normalized=text.replace(/[\u202a-\u202e\u2066-\u2069]/g,'').normalize('NFKC');
  for(const value of expected)if(!normalized.includes(value) && !normalized.includes([...value].reverse().join('')))throw Error('Missing PDF text: '+value);
  if(text.includes('\ufffd'))throw Error('Unreadable Unicode replacement in artifact');
  return {pages:Number(metadata.match(/^Pages:\s+(\d+)/m)?.[1]),text,metadata};
}

for(const language of ['it','ar'])test('selected-list Unicode, sources, dates and pagination: '+language,async({page},info)=>{
  await page.goto('/preferiti/liste?lang='+language);
  const id=await seedCollection(page,language,8);
  // Block automatic refresh so the fixed dated print input stays unchanged.
  await page.route('**/api/public/services/**',route=>route.abort());
  await page.goto('/preferiti/liste?lang='+language+'#'+id);
  await page.reload();
  await expect(page.locator('#collection-cards article')).toHaveCount(8);
  await expect(page.locator('#collection-title')).toHaveText(language==='ar'?'قائمة اختبار':'Lista di verifica');
  await page.evaluate(()=>{window.print=()=>{};});
  await page.locator('#lists-print').click();
  await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
  const path=info.outputPath('selected-'+language+'.pdf');
  await page.pdf({path,format:'A4',printBackground:true});
  const observed=inspect(path,[language==='ar'?'مكتب المساعدة':'Sportello orientamento', 'Associazione Alfa','2026','Via Esempio']);
  expect(observed.pages).toBeGreaterThan(1);
  expect(observed.text.split('\f').filter(page=>page.trim()).length).toBe(observed.pages);
  const compact=observed.text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\s]/g,'').replace(/[٠-٩]/g,n=>String(n.charCodeAt(0)-1632));
  expect(compact).toContain('2026-11-20');expect(compact).toContain(language==='ar'?'2026/11/27':'27/11/2026');
  expect((observed.text.match(/Associazione Alfa/g)||[]).length).toBeGreaterThanOrEqual(8);
  fs.writeFileSync(info.outputPath('extracted-'+language+'.txt'),observed.text);
  fs.writeFileSync(info.outputPath('metadata-'+language+'.txt'),observed.metadata);
  await page.emulateMedia({media:'print'});
  await page.screenshot({path:info.outputPath('print-layout-'+language+'.png'),fullPage:true});
  if(language==='ar')await expect(page.locator('html')).toHaveAttribute('dir','rtl');
  expect(()=>inspect(path,['WRONG_COLLECTION_CONTENT'])).toThrow('Missing PDF text');
  expect(()=>inspect(info.outputPath('missing.pdf'),[])).toThrow('Missing/empty');
});
