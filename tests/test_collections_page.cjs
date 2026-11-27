const assert=require('node:assert/strict'),fs=require('node:fs');
const {environment}=require('./module_fixture.cjs');
const dictionary=JSON.parse(fs.readFileSync('translations/it.json','utf8'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  const events={};let printed=0,renamed='',removed=false;
  const env=environment({fetch:async()=>({ok:true,json:async()=>dictionary}),
    location:{search:'?lang=it',hash:'#one',pathname:'/preferiti/liste'},history:{replaceState(){}},
    navigator:{onLine:false},window:{addEventListener:(name,fn)=>{events[name]=fn;},print:()=>{printed++;},confirm:()=>true}});
  env.get('lists-create').elements={name:{value:''}};env.get('lists-rename').elements={name:{value:''}};
  const details=[{open:false},{open:true}],cards=env.get('collection-cards');
  cards.querySelectorAll=selector=>selector==='details'?details:[];
  cards.querySelector=()=>cards.children.length?{}:null;
  const entry={id:'00000000-0000-0000-0000-000000000001',status:'saved',language:'it',updatedAt:'2026-11-27T10:00:00Z',
    card:{id:'00000000-0000-0000-0000-000000000001',name:'Public service',data_status:'approved_canonical_local',place:{address:'Roma'},contacts:[],sources:[]}};
  const collections={list:async()=>removed?[]:[{id:'one',name:renamed || 'Salute',entries:[entry]}],
    rename:async(id,name)=>{assert.equal(id,'one');renamed=name;},remove:async()=>{removed=true;},
    cards:()=>({list:async()=>[entry],refresh:async()=>({failures:0})})};
  const {startLists}=await env.load('pages/lists.js');
  await startLists({canonical:true,territory:'roma'},{collectionFactory:()=>collections});
  assert.equal(env.get('collection-title').textContent,'Salute');
  assert.equal(env.get('lists-print').disabled,false);
  env.get('lists-print').click();assert.equal(printed,1,'print command reaches the native print API');
  events.beforeprint();assert(details.every(node=>node.open),'all sources/descriptions expanded for print');
  events.afterprint();assert.equal(details[0].open,false);assert.equal(details[1].open,true);
  const form=env.get('lists-rename');form.elements.name.value='Accoglienza';
  form.dispatch('submit',{preventDefault(){},currentTarget:form});await tick();
  assert.equal(env.get('collection-title').textContent,'Accoglienza');
  env.get('lists-delete').click();await tick();
  assert.equal(env.get('collection-document').hidden,true);
  assert.equal(env.get('lists-print').disabled,true,'empty library cannot print a stale collection');
  assert.equal(env.get('lists-status').textContent,dictionary.lists.empty);
  console.log('PASS: collection page restoration, rename/delete, empty exit, native print dispatch and source expansion');
})().catch(error=>{console.error(error);process.exitCode=1;});
