const assert=require('node:assert/strict');
const {strictEnvironment}=require('./module_fixture.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 const fixture={nodes:['sheet-saved','saved-groups','saved-create','saved-new','saved-status']};
 const env=strictEnvironment(fixture,{window:{addEventListener(){}}});
 assert.throws(()=>env.document.getElementById('missing-return'),/Missing required DOM node/);
 assert.throws(()=>env.get('saved-groups').querySelector('unsupported'),/Unsupported DOM operation/);
 assert.equal(strictEnvironment({nodes:[],optional:['absent-banner']}).document.getElementById('absent-banner'),null);
 const {Lifecycle}=await env.load('lifecycle.js');const scope=new Lifecycle();
 const {createSavedPanel}=await env.load('features/favorites/panel.js');
 const entry={id:'00000000-0000-0000-0000-000000000001',status:'saved',card:{name:'Shared POI',place:{address:'Roma'}}};
 let members=[entry],quick=[entry],changes=0;const emitted=[];
 const panel=createSavedPanel({scope,translate:key=>key,emit:(...args)=>emitted.push(args),changed:()=>{changes++;},renderEntry:entry=>`<div class="service-list-item"><button class="poi-item" data-saved-select="${entry.id}">${entry.card.name}</button></div>`,
  favorites:{list:async()=>quick},collections:{list:async()=>[{id:'one',name:'Operatori'}],cards:()=>({list:async()=>members,remove:async()=>{members=[];}})}});
 await panel.open();assert.equal(emitted[0][1].id,'sheet-saved');
 assert.equal((env.get('saved-groups').innerHTML.match(/Shared POI/g)||[]).length,2,'same POI renders independently in two groups using the shared row');
 const click=(attribute,dataset={})=>{
  const button={disabled:false,dataset,isConnected:true,hasAttribute:name=>name===attribute,closest:()=>({dataset:{savedGroup:'one'}})};
  env.get('saved-groups').dispatch('click',{target:{closest:()=>button}});
 };
 click('data-saved-map');assert.equal(emitted.at(-1)[0],'savedMap');assert.equal(emitted.at(-1)[1].id,'one');
 const before=emitted.length;click('data-favorite-id',{favoriteId:entry.id});
 assert.equal(emitted.length,before,'bookmark bubbles to the shared destination picker rather than selecting a row');
 assert.equal(members.length,1);assert.equal(quick.length,1);
 members=[];await panel.render();assert(env.get('saved-groups').innerHTML.includes('lists.emptyCollection'));
 scope.dispose();
 console.log('PASS: in-app sheet opening, grouped multi-membership, shared rows, per-list map action and bookmark delegation');
})().catch(error=>{console.error(error);process.exitCode=1;});
