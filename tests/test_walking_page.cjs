/** Walking action crosses the same page seam as service selection and reference picking. */
const assert=require('node:assert/strict');const {environment}=require('./module_fixture.cjs');
(async()=>{
 const env=environment({setInterval:()=>1,clearInterval(){}});const {createMapPage}=await env.load('pages/map.js');
 async function fixture(mode){
  let emit,chosen=0,walks=[],mounted=0,labels=0,selected;
  const bar=env.get('detail-bar');bar.children=[];
  const feature={update(){},mount(){},dispose(){},summaries(){},detail(){},origin(){},referenceChanged(){},choose(){chosen++;},set(){}};
  const services={load:async()=>({pois:[]}),update(){},show(){},choose(){},refreshHours(){},describe:()=>({}),dispose(){}};
  const shell={bind(){},layout(){},translate(){},close(){},toggle(){},update(){},languages(){},cities(){},toast(){}};
  const map={mount(){},update(view){selected=view.selectedId;},dispose(){},attach(){},center(){},contains:()=>true,invalidate(){},lookAt(){}};
  const page=createMapPage({languageCode:'it',localLayers:true,view:{mode}},
   {i18n:{setLanguage:async()=>{},t:(k,p,f)=>f||k},http:{},browser:{location:{search:''}},
    factories:{map:()=>map,services:args=>{emit=args.emit;return services;},search:()=>({select:()=>[],update(){}}),origin:()=>feature,transport:()=>feature,cycleways:()=>feature,shell:()=>shell,
    buses:()=>({mount(){},dispose(){},refreshLabels(){labels++;}}),
    walking:()=>({mount(){mounted++;},clear(){},dispose(){},walk:(a,b)=>walks.push([a,b])})}});
  await page.mount();emit('detailReady',{poi:{latitude:41.91,longitude:12.51}});
  return {page,emit,bar,walks,get selected(){return selected;},get chosen(){return chosen;},get mounted(){return mounted;},get labels(){return labels;}};
 }
 const three=await fixture('3d');assert.equal(three.mounted,1);three.emit('select',{id:'selected-site'});assert.equal(three.selected,'selected-site','map receives current selection immediately');
 const button=three.bar.children.find(b=>b.className==='btn walk3d');assert(button);button.click();assert.equal(three.chosen,1);assert.equal(three.walks.length,0);
 three.emit('reference',{lat:41.9,lng:12.5});button.click();assert.equal(JSON.stringify(three.walks),JSON.stringify([[[12.5,41.9],[12.51,41.91]]]));three.emit('language',{language:'fr'});await new Promise(setImmediate);assert.equal(three.labels,1);three.page.dispose();
 const two=await fixture('2d');assert.equal(two.mounted,0);assert(!two.bar.children.some(b=>b.className==='btn walk3d'));two.page.dispose();
 console.log('PASS: walking action only in 3D; existing origin choice; selected reference and site');
})().catch(e=>{console.error(e);process.exitCode=1;});
