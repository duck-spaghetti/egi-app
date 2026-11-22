/* Canonical availability, source attribution and unknown-day UI regressions. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
let source=fs.readFileSync(path.join(__dirname,'../app/frontend/static/js/map.js'),'utf8');
source=source.replace(/init\(\)\.catch\(\(error\) => \{[\s\S]*?\n\}\);/,'');
const element=()=>({classList:{add(){},remove(){},toggle(){}},setAttribute(){},addEventListener(){},dataset:{}});
const sandbox={document:{getElementById:element,querySelector:element,querySelectorAll:()=>[]},
 window:{EGI_MAP_CONTEXT:{canonical:true,languageCode:'it',localLayers:false}},console,URL,URLSearchParams};
vm.createContext(sandbox);
vm.runInContext(source,sandbox);
vm.runInContext(`
 const now=new Date('2026-11-23T09:00:00Z');
 const display={canonical_opening:{status:'unknown'},days:[
  {label:'Lunedì',state:'open',intervals:[{label:'09:00–12:00'}]},
  {label:'Martedì',state:'unknown',intervals:[]},
  {label:'Mercoledì',state:'closed',intervals:[]}]};
 if(sourceOpeningStatus(display,now).kind!=='unknown') throw Error('unknown canonical hours became open');
 const html=renderHoursSection({raw:{data_status:'approved_canonical_local',hours_display:display}});
 if(!html.match(/Martedì[\\s\\S]*?<\\/tr>/)[0].includes('Da verificare')) throw Error('unknown weekday became closed');
 if(!html.match(/Mercoledì[\\s\\S]*?<\\/tr>/)[0].includes('Chiuso')) throw Error('explicit closed day lost');
 if(!renderCanonicalHours({raw:{hours_display:{days:[display.days[2]]}}}).includes('Chiuso')) throw Error('closed-only week became absent hours');
 const expired={canonical_opening:{status:'open',next_transition_at:'2026-11-23T08:59:00Z'}};
 if(sourceOpeningStatus(expired,now).kind!=='unknown') throw Error('expired canonical state remained open');
 const current={canonical_opening:{status:'open',next_transition_at:'2026-11-23T10:00:00Z',closes_at:'2026-11-23T10:00:00Z',timezone:'Europe/Rome'}};
 if(sourceOpeningStatus(current,now).kind!=='closing') throw Error('canonical closing boundary lost');
 const poi=normalizePublicService({id:'canonical-id',name:'Scuola',sources:[{name:'Scuolemigranti',source_name:'Scuolemigranti'}],place:{geometry:null}});
 if(sourceName(poi)!=='Scuolemigranti' || !sourceNames(poi).includes('Scuolemigranti')) throw Error('wrong canonical publisher');
`,sandbox);
console.log('PASS: canonical hours, unknown days, boundaries and source attribution');
