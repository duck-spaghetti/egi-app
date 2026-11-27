/** Visible app journeys, controlled navigation faults and unchanged synthetic snapshots. */
import {test,expect} from '@playwright/test';
import {openMap,openSaved,saveTo,SERVICE} from './helpers.js';

test('empty library stays in the shell with a visible operable exit',async({page})=>{
  await openMap(page);const original=page.url();
  await openSaved(page);expect(page.url()).toBe(original);
  await expect(page.locator('#saved-groups')).toContainText('Non hai ancora salvato preferiti');
  const exit=page.locator('#sheet-saved [data-close]');await expect(exit).toBeVisible();
  await exit.click();await expect(page.locator('#sheet-saved')).not.toHaveClass(/shown/);
  await expect(page.locator('[data-sheet="settings"]')).toBeFocused();
});

test('list/detail bookmarks, independent memberships and map/catalog round trip',async({page})=>{
  await openMap(page);
  const listBookmark=page.locator('#poi-list [data-favorite-id]').first();
  await listBookmark.click();await saveTo(page);
  await expect(listBookmark).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#sheet-detail')).not.toHaveClass(/shown/);
  await page.locator('#poi-list .poi-item').first().click();
  await expect(page.locator('#sheet-detail')).toHaveClass(/shown/);
  await page.locator('#sheet-detail [data-favorite-id]').click();await saveTo(page,'new','Operatori');
  await page.locator('#sheet-detail .service-close').click();
  await openSaved(page);
  await expect(page.locator('#saved-groups .service-list-item')).toHaveCount(2);
  await expect(page.locator('#saved-groups')).toContainText('Via Esempio');
  await expect(page.locator('#saved-groups')).toContainText('Associazione Alfa');
  await page.locator('[data-saved-group="favorites"] [data-favorite-id]').click();
  await page.locator('dialog[open] [data-remove]').click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('#saved-groups .service-list-item')).toHaveCount(1);
  await page.locator('[data-saved-map]:not([disabled])').click();
  await expect(page.locator('#saved-map-name')).toHaveText('Operatori');
  await expect(page.locator('#saved-map-back')).toBeVisible();await page.locator('#saved-map-back').click();
  await expect(page.locator('#sheet-saved')).toHaveClass(/shown/);
  await page.locator('[data-saved-map]:not([disabled])').click();
  await page.locator('#saved-map-exit').click();
  await expect(page.locator('#saved-map-nav')).not.toBeVisible();
  await page.locator('#view-toggle').click();
  await expect(page.locator('#poi-list [data-favorite-id]')).toHaveAttribute('data-favorite-id',SERVICE);
});

test('storage denial keeps navigation usable without a false saved state',async({page})=>{
  await page.addInitScript(()=>{Object.defineProperty(indexedDB,'open',{value:()=>{throw new DOMException('Denied','SecurityError');}});});
  await openMap(page);await expect(page.locator('#poi-list [data-favorite-id]')).toBeDisabled();
  await openSaved(page);await expect(page.locator('#saved-status')).not.toBeEmpty();
  await page.locator('#sheet-saved [data-close]').click();
  await expect(page.locator('#view-toggle')).toBeVisible();
});

test('network failure reports failed save and leaves the dialog dismissible',async({page})=>{
  await openMap(page);
  await page.route('**/api/public/services/'+SERVICE+'?**',route=>route.abort());
  await page.locator('#poi-list [data-favorite-id]').click();
  const dialog=page.locator('dialog[open]');await dialog.locator('[type="submit"]').click();
  await expect(dialog.locator('[role="status"]')).not.toBeEmpty();
  await expect(page.locator('#poi-list [data-favorite-id]')).toHaveAttribute('aria-pressed','false');
  await dialog.locator('[data-cancel]').click();await expect(dialog).not.toBeVisible();
});

test('visible-return assertion rejects an equivalent missing-control fault',async({page})=>{
  await openMap(page);await openSaved(page);
  const exit=page.locator('#sheet-saved [data-close]');
  await exit.evaluate(node=>node.style.display='none');
  let rejected=false;try{await expect(exit).toBeVisible({timeout:250});}catch{rejected=true;}
  expect(rejected).toBe(true);
  await exit.evaluate(node=>node.style.removeProperty('display'));
  await exit.click();await expect(page.locator('#sheet-saved')).not.toHaveClass(/shown/);
});

test('authenticated Community views retain organizations, roles and selective submitted content',async({page,context},info)=>{
  await context.addCookies([{name:'egi_fixture',value:'moderator',url:'http://127.0.0.1:4341'}]);
  const fixture=await (await page.request.get('/__fixtures/preparation')).json();
  let current=structuredClone(fixture.payload),version=fixture.version,submitted;
  const workspace=()=>({id:fixture.id,title:'Preparazione sintetica',source_id:fixture.source,state:'active',permission:'owner',
    owner_actor_id:'synthetic-author',current_input_id:fixture.input,input_metadata:{public_attestation:false},metadata_revision:1,
    items:[{item_id:fixture.item,outcome:current.outcome,display_name:current.service.name},
      {item_id:'private-sibling',outcome:'review',display_name:'NON_INVIATO_PRIVATO'}],grants:[]});
  await page.route('**/moderazione/contribuisci/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname,body=request.postDataJSON();
    let value;
    if(path.endsWith('/persone'))value={items:[]};
    else if(path.endsWith('/preparazioni'))value={items:[{id:fixture.id,title:'Preparazione sintetica'}]};
    else if(path.endsWith('/input/'+fixture.input))return route.fulfill({contentType:'text/plain',body:fixture.original});
    else if(path.endsWith('/cronologia'))value={versions:[],after:0,has_more:false};
    else if(path.endsWith('/schede/'+fixture.item))value={version:{id:version,payload:current}};
    else if(path.endsWith('/schede') && request.method()==='POST'){
      current=structuredClone(body.changes[0].payload);version=String(Number(version.slice(-2)) + 1);
      value={operation_id:'fixture-operation',items:[{item_id:fixture.item,after:version}]};
    }else if(path.endsWith('/invii')){
      expect(body.items).toEqual([{item_id:fixture.item,expected_version:version}]);
      submitted=structuredClone(current);value={items:[{item_id:fixture.item,outcome:'submitted',receipt:{contribution_id:'fixture'}}]};
    }else if(path.endsWith('/catalogo'))value={entries:[],has_more:false};
    else if(path.endsWith('/preparazioni/'+fixture.id))value=workspace();
    else return route.fulfill({status:404,json:{code:'unexpected-fixture-request'}});
    await route.fulfill({json:value});
  });
  await page.goto('/moderazione/contribuisci?id='+fixture.id);
  await page.locator('#card-list [data-item="'+fixture.item+'"]').click();
  await expect(page.locator('#editable-fields')).toContainText('Associazione Alfa');
  await expect(page.locator('#editable-fields')).toContainText('Comune Beta');
  await expect(page.locator('#editable-fields')).toContainText('aiuto documenti');
  await expect(page.locator('#editable-fields')).toContainText('Supporto sociale');
  await expect(page.locator('#editable-fields')).toContainText('finanziatore');
  const name=page.locator('[data-path="/service/name"]');await name.fill('Sportello corretto');
  await page.locator('#view-fields').click();await expect(name).toHaveValue('Sportello corretto');
  await expect(page.locator('#editable-fields')).toContainText('Comune Beta');
  await page.locator('#view-card').click();await expect(name).toHaveValue('Sportello corretto');
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
    await page.setViewportSize(viewport);await page.screenshot({path:info.outputPath('preparation-'+viewport.width+'.png'),fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#card-outcome').selectOption('confirmed');
  await page.locator('#submit-card').click();await expect(page.locator('#submission-link')).toBeVisible();
  expect(submitted.resolutions).toEqual(fixture.payload.resolutions);
  expect(submitted.source_facts).toEqual(fixture.payload.source_facts);
  await page.route('**/moderazione/contributo/fixture',async route=>{
    const response=await route.fetch();let html=await response.text();
    html=html.replace(/(<script id="community-review-context" type="application\/json">)(.*?)(<\/script>)/s,(_all,start,data,end)=>{
      const context=JSON.parse(data);context.snapshot.values=submitted;context.snapshot.evidence=submitted.evidence;
      return start+JSON.stringify(context).replaceAll('<','\\u003c')+end;
    });
    await route.fulfill({response,body:html});
  });
  await page.locator('#submission-link').click();
  await expect(page.locator('#review-editor [data-path="/service/name"]')).toHaveValue('Sportello corretto');
  await expect(page.locator('#review-editor')).toContainText('Associazione Alfa');
  await expect(page.locator('#review-editor')).toContainText('Comune Beta');
  await expect(page.locator('#review-editor')).toContainText('Supporto sociale');
  await expect(page.locator('#review-editor')).toContainText('finanziatore');
  await expect(page.locator('body')).not.toContainText('NON_INVIATO_PRIVATO');
  await page.locator('#review-fields').click();
  await expect(page.locator('#review-editor')).toContainText('aiuto documenti');
  const copied=await page.locator('#community-review-context').textContent();
  expect(JSON.parse(copied).snapshot.evidence).toEqual(submitted.evidence);
  await page.screenshot({path:info.outputPath('moderation-1440.png'),fullPage:true});
});
