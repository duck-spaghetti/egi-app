/** Refresh-local presentation and exact sibling indexes preserve semantics across context/clock/data changes. */
const assert=require('node:assert/strict');const {environment}=require('./module_fixture.cjs');
(async()=>{const env=environment(),{createPresentation}=await env.load('features/services/presentation.js'),{createServices}=await env.load('features/services/index.js'),{createSites}=await env.load('features/map/sites.js');
 const context={canonical:true,cityId:1,profile:{timezone:'Europe/Rome'}},translate=(k,p,f)=>f||k;
 const state={pois:[],categories:[{id:1,slug:'istruzione',label:'Istruzione',color:'#123456'}],lang:'it',filters:{cats:new Set(),offersOff:new Set()},taxonomy:{},matchedIds:new Set()};
 const model=createPresentation({snapshot:()=>state,context,translate});state.pois=['a','b'].map(id=>({id,title:id,category_id:1,latitude:41.9,longitude:12.5,raw:{hours_display:{canonical_opening:{status:'open',next_transition_at:'2026-11-27T12:00:00Z'}},placement:{section:'services'}}}));
 const sites=createSites({context,snapshot:()=>state}),services=createServices({context,scope:{signal:new AbortController().signal},loader:{},sites,transit:{},translate,emit(){}}),before=new Date('2026-11-27T11:59:00Z'),after=new Date('2026-11-27T12:01:00Z');
 for(const lang of ['it','fr','ar'])for(const userLoc of [null,{lat:41.8,lng:12.4}])for(const now of [before,after,new Date('2026-11-27T22:59:00Z'),new Date('2026-11-27T23:01:00Z'),new Date('2026-10-25T00:59:00Z'),new Date('2026-10-25T01:01:00Z')]){
  state.lang=lang;state.userLoc=userLoc;services.beginRefresh(state,now);sites.reset();for(const row of state.pois){assert.equal(JSON.stringify(services.describe(row)),JSON.stringify(model.describe(row,now)));assert.equal(services.describe(row),services.describe({...row}),'stable service identity shares one description per refresh');}
  assert.equal(sites.siblings(state.pois[0]).length,2);const a={title:'first',category:{slug:'a',label:'A'},raw:{}},b={title:'second',category:{slug:'b',label:'B'},raw:{}};assert.notEqual(services.describe(a).title,services.describe(b).title,'ID-less display objects keep object identity');
 }
 services.beginRefresh(state,before);assert.notEqual(services.describe(state.pois[0],after).status.kind,services.describe(state.pois[0],before).status.kind,'explicit clock boundary bypasses an older memo');
 const old=services.describe(state.pois[0]);state.pois[0]={...state.pois[0],title:'fresh data'};services.beginRefresh(state,before);assert.notEqual(services.describe(state.pois[0]),old);assert.equal(services.describe(state.pois[0]).title,'fresh data');
 state.pois.push({id:'c',latitude:41.9,longitude:12.5,raw:{}});sites.reset();assert.equal(sites.siblings(state.pois[0]).length,3,'same-array mutation invalidates via owning refresh');
 state.pois[2].longitude+=.000001;sites.reset();assert.equal(sites.siblings(state.pois[0]).length,2,'nearby coordinates never merge');
 const other=createSites({context:{canonical:false},snapshot:()=>({pois:[{id:1,latitude:1,longitude:1,raw:{source_group:{external_key:'g'}}},{id:2,latitude:2,longitude:2,raw:{source_group:{external_key:'g'}}}]})});assert.equal(other.siblings({raw:{source_group:{external_key:'g'}}}).length,2,'noncanonical sibling grouping retains original source identity');other.dispose();sites.dispose();services.dispose();
 console.log('PASS: refresh-local stable/ID-less identity, languages/reference/clock/data invalidation, exact source indexes and disposal');
})().catch(e=>{console.error(e);process.exitCode=1});
