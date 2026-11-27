/** Surviving keyed controls and lazy rows retain ownership across catalogue refreshes. */
const assert=require('node:assert/strict');const {environment}=require('./module_fixture.cjs');
(async()=>{const env=environment(),{reconcileMarkup}=await env.load('reconcile.js');
 const host=env.get('host');reconcileMarkup(host,'<button data-id="a">A</button><button data-id="b">B</button>');const [a,b]=host.children;
 host.scrollTop=90;reconcileMarkup(host,'<button data-id="b">Fresh B</button><button data-id="a">A</button>');assert.equal(host.children[0],b);assert.equal(host.children[1],a);assert.equal(b.textContent,'Fresh B');assert.equal(host.scrollTop,90);
 const {createServices}=await env.load('features/services/index.js');const services=createServices({context:{canonical:true},scope:{signal:new AbortController().signal},loader:{},sites:{siblings:()=>[]},transit:{badge:()=>''},translate:(k,p,f)=>f||k,emit(){}});
 const state={view:'map',pois:[],categories:[],filters:{},matchedIds:new Set()};const rows=[{id:'1',title:'One',raw:{}},{id:'2',title:'Two',raw:{}}];state.pois=rows;
 services.beginRefresh(state);services.update(state,rows);assert.equal(env.get('poi-list').children.length,0);
 state.view='list';services.beginRefresh(state);services.update(state,rows);assert.equal(env.get('poi-list').children.length,2);const first=env.get('poi-list').children[0];
 services.beginRefresh(state);services.update(state,rows);assert.equal(env.get('poi-list').children[0],first);
 const copyA={id:'saved-copy',title:'Saved A',raw:{service_title:'Saved A'}},copyB={id:'saved-copy',title:'Saved B',raw:{service_title:'Saved B'}};
 assert.equal(services.describe(copyA).title,'Saved A');assert.equal(services.describe(copyB).title,'Saved B','independent saved copies retain their own title despite a shared service ID');
 state.view='map';services.update(state,rows);assert.equal(env.get('poi-list').children.length,0);services.dispose();
 console.log('PASS: keyed node reuse/reordering/text/scroll and list lazy creation/release');
})().catch(e=>{console.error(e);process.exitCode=1});
