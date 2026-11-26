/** Real service presentation: territory-local calendar emphasis and the directions choice. */
const assert=require('node:assert/strict');const {environment}=require('./module_fixture.cjs');
(async()=>{
 class FrozenDate extends Date{constructor(...args){super(...(args.length?args:['2026-11-26T23:30:00Z']));}}
 const {createPresentation}=await environment({Date:FrozenDate}).load('features/services/presentation.js');
 const days=['lun','mar','mer','gio','ven','sab','dom'].map(day=>({day,label:day,intervals:[],state:'closed'}));
 const poi={id:'test',latitude:41.9,longitude:12.5,contacts:[],raw:{data_status:'approved_canonical_local',hours_display:{days}}};
 const model=createPresentation({snapshot:()=>({categories:[]}),context:{view:{mode:'3d',available:true},profile:{timezone:'Europe/Rome'}},translate:(k,p,f)=>f||k});
 const html=model.renderHoursSection(poi);assert.equal((html.match(/aria-current="date"/g)||[]).length,1);assert(html.includes('<th scope="row" data-calendar-day="ven" aria-current="date">ven</th>'),'Rome Friday highlighted while UTC is still Thursday');
 const bar=model.renderServiceBar(poi);assert(bar.includes('Ottieni indicazioni'));assert(bar.includes('Apri Google Maps'));assert(bar.includes('data-walk-in-app'));assert(bar.includes('target="_blank" rel="noopener noreferrer"'));assert(!bar.includes('data-walk-in-app disabled'));
 const addressOnly=model.renderServiceBar({...poi,address:'Via Roma 1',latitude:null,longitude:null});assert(addressOnly.includes('Apri Google Maps'));assert(addressOnly.includes('data-walk-in-app disabled'),'address-only Google fallback must not enable in-app routing');
 const unavailable=createPresentation({snapshot:()=>({categories:[]}),context:{view:{mode:'2d',available:false}},translate:(k,p,f)=>f||k});assert(unavailable.renderServiceBar(poi).includes('data-walk-in-app disabled'),'no dead route action without 3D');
 console.log('PASS: local calendar day, integrated Google/in-app choice and unavailable route state');
})().catch(e=>{console.error(e);process.exitCode=1;});
