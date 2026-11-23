/** The real entry Module owns metadata, interaction and timer cleanup per mount. */
const assert=require('node:assert/strict');const {environment}=require('./module_fixture.cjs');
(async()=>{
 const timers=new Set();let id=0;
 const env=environment({setInterval:()=>{timers.add(++id);return id;},clearInterval:value=>timers.delete(value)});
 const {Lifecycle}=await env.load('lifecycle.js'),{createEntryPage}=await env.load('pages/entry.js');
 const languages=[['it','Italiano'],['en','English'],['fr','Français'],['ar','العربية']].map(([code,name],i)=>({id:i+1,code,name_native:name,name_english:name,direction:code==='ar'?'rtl':'ltr'}));
 const http={request:async url=>({ok:true,json:async()=>url.endsWith('/languages')?languages:[{id:1,slug:'roma',name:'Roma',country_code:'IT',default_center:{type:'Point',coordinates:[12.5,41.9]},geometry_bbox:null}]})};
 const translator={setLanguage:async()=>{},translatePage(){},t:(key,_params,fallback)=>fallback||key};
 const firstScope=new Lifecycle(),first=createEntryPage({scope:firstScope,http,i18n:translator});await first.mount();
 assert.equal(env.get('lang-list').children.length,4);assert(!env.get('lang-list').children.some(button=>button.innerHTML.includes('undefined')));
 assert.equal(timers.size,1);first.dispose();assert.equal(timers.size,0);
 const secondScope=new Lifecycle(),second=createEntryPage({scope:secondScope,http,i18n:translator});await second.mount();
 assert.equal(timers.size,1);second.dispose();assert.equal(timers.size,0);
 let finishDictionary;const dictionary=new Promise(resolve=>{finishDictionary=resolve;});
 const retiredScope=new Lifecycle();
 const staleHttp={request:async url=>({ok:true,json:async()=>url.endsWith('/languages')?[{id:1,code:'it',name_native:'STALE WIZARD',name_english:'STALE',direction:'ltr'}]:[]})};
 const retired=createEntryPage({scope:retiredScope,http:staleHttp,i18n:{...translator,setLanguage:()=>dictionary}});
 const retiredMount=retired.mount();await new Promise(setImmediate);retired.dispose();
 const fresh=createEntryPage({scope:new Lifecycle(),http,i18n:translator});await fresh.mount();
 finishDictionary();await retiredMount;
 assert(!env.get('lang-list').children.some(button=>button.innerHTML.includes('STALE WIZARD')),'retired dictionary continuation cannot overwrite the fresh wizard');
 fresh.dispose();assert.equal(timers.size,0);
 console.log('PASS: actual entry metadata, remount and owned timer cleanup');
})().catch(error=>{console.error(error);process.exitCode=1;});
