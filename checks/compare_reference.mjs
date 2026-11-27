/** Capture the retained prototype using the same representative synthetic content.
 * Developer comparison only: this does not declare visual equality or native acceptance.
 */
import {chromium} from '@playwright/test';
import fs from 'node:fs';
const reference=new URL(process.argv[2]);
if(reference.hostname!=='127.0.0.1' || reference.protocol!=='http:')throw Error('Explicit loopback reference required');
const output='.local/browser/reference';fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch();
try{
  const context=await browser.newContext();
  await context.addInitScript(()=>{
    const sourceText='Sportello orientamento. Associazione Alfa gestisce il servizio; Comune Beta lo finanzia. Categoria originale: aiuto documenti. Orari da verificare.';
    localStorage.setItem('egi-community-workspace-v2',JSON.stringify({tab:'single',editorView:'card',sourceText,
      draft:{name:'Sportello corretto',cat:'Supporto sociale',org:'Associazione Alfa · Comune Beta',description:'Orari da verificare',
        hours:'Da verificare',source:'Associazione Alfa · catalogo sintetico',
        _evidence:{org:{value:'Associazione Alfa · Comune Beta',sourceText,quote:'Associazione Alfa',reason:'Nomi espliciti nel testo'}}}}));
  });
  const page=await context.newPage();await page.goto(reference.href);
  await page.locator('[data-action="go:contribute"]').click();
  const observations=[];
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    await page.screenshot({path:output+'/prototype-'+viewport.width+'.png',fullPage:true});
    observations.push(await page.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},
      source:document.querySelector('#source-text').value,title:document.querySelector('[name="name"]').value,
      organization:document.querySelector('[name="org"]').value,category:document.querySelector('[name="cat"]').value})));
  }
  fs.writeFileSync(output+'/observations.json',JSON.stringify({reference:reference.href,observations},null,2));
  console.log(JSON.stringify(observations));
}finally{await browser.close();}
