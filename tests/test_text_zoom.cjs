/** Verify accessible text sizing, reset visibility, local persistence and blocked storage. */
const assert=require('node:assert/strict');
const {environment}=require('./module_fixture.cjs');
function fixture(stored='100', denied=false) {
  const values=new Map([['egi-text-zoom',stored]]),listeners={},events={};
  const root={activeElement:null,querySelector:()=>null,documentElement:{style:{setProperty:(key,value)=>{root[key]=value;}}},
    addEventListener:(name,fn)=>{listeners[name]=fn;},removeEventListener:name=>{delete listeners[name];}};
  const controls={};
  for(const action of ['reset','decrease','increase'])controls[action]={dataset:{zoomAction:action},disabled:false,hidden:false,
    focus(){root.activeElement=this;},closest:selector=>selector==='[data-text-zoom]'?row:null};
  const output={textContent:''};
  const row={querySelector:selector=>selector==='[data-zoom-value]'?output:controls[selector.match(/"(.*?)"/)[1]]};
  root.querySelectorAll=()=>[row];
  const storage={getItem:key=>{if(denied)throw Error('denied');return values.get(key);},
    setItem:(key,value)=>{if(denied)throw Error('denied');values.set(key,value);},removeItem:key=>values.delete(key)};
  const host={addEventListener:(name,fn)=>{events[name]=fn;},removeEventListener:name=>{delete events[name];}};
  const click=action=>{const button=controls[action];if(button.disabled)return;root.activeElement=button;listeners.click({target:{closest:()=>button}});};
  return {root,host,storage,values,controls,output,events,listeners,click};
}
(async()=>{
  const {createTextZoom,textZoomValue}=await environment().load('text-zoom.js');
  for(const invalid of [null,undefined,'garbage','110px',90,201,115,Infinity,{},''])assert.equal(textZoomValue(invalid),100);
  const view=fixture();const zoom=createTextZoom(view);
  assert.equal(view.root['--egi-text-scale'],'1');assert(view.controls.reset.hidden && view.controls.decrease.disabled);
  view.click('increase');assert.equal(view.output.textContent,'110%');assert(!view.controls.reset.hidden);
  assert.equal(view.values.get('egi-text-zoom'),'110');
  for(let n=0;n<20;n++)view.click('increase');
  assert.equal(view.root['--egi-text-scale'],'2');assert(view.controls.increase.disabled);
  assert.equal(view.root.activeElement,view.controls.decrease,'focus follows an enabled control at the upper boundary');
  view.click('reset');assert.equal(view.output.textContent,'100%');assert(view.controls.reset.hidden);
  assert.equal(view.root.activeElement,view.controls.increase,'reset does not leave focus on a hidden button');
  assert(!view.values.has('egi-text-zoom'));
  view.events.storage({key:'egi-text-zoom',newValue:'140',storageArea:view.storage});
  assert.equal(view.output.textContent,'140%');
  view.events.storage({key:null,newValue:null,storageArea:view.storage});assert.equal(view.output.textContent,'100%');
  zoom.dispose();assert(!view.listeners.click && !view.events.storage);
  const restored=fixture('170');createTextZoom(restored);assert.equal(restored.output.textContent,'170%');
  const blocked=fixture('200',true);createTextZoom(blocked);blocked.click('increase');
  assert.equal(blocked.output.textContent,'110%','storage denial must not stop larger text');
  console.log('PASS: text zoom bounds, reset visibility/focus, persisted preference, cross-tab changes, denied storage and cleanup');
})().catch(error=>{console.error(error);process.exitCode=1;});
