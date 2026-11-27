/** Timetable growth and viewport-edge fitting without geographic offsets. */
const assert=require('node:assert/strict'),{environment}=require('./module_fixture.cjs');
(async()=>{
 const {popupShift,fitTransportPopup}=await environment().load('features/transport/popup-layout.js');
 const view={left:0,right:390,top:0,bottom:844,width:390,height:844};
 const shift=popupShift({left:300,right:580,top:-40,bottom:300},view);assert.equal(shift[0],288);assert.equal(shift[1],-310);
 const bottom=popupShift({left:50,right:330,top:500,bottom:830},view);assert.equal(bottom[1],106);
 let pan;const map={getContainer:()=>({getBoundingClientRect:()=>view}),panBy:(s,o)=>pan={s,o}};
 fitTransportPopup(map,{getElement:()=>({getBoundingClientRect:()=>({left:300,right:580,top:-40,bottom:300,width:280})})});assert.equal(pan.s[0],288);assert.equal(pan.o.duration,0);
 let queued,panCount=0;const deferred=environment({requestAnimationFrame:fn=>{queued=fn;return 1;},cancelAnimationFrame(){queued=null;}});
 const {createPopupFitter}=await deferred.load('features/transport/popup-layout.js');let top=-100;
 const moving={getContainer:()=>({getBoundingClientRect:()=>view}),panBy:()=>{top+=60;panCount++;}};
 const fitter=createPopupFitter(moving);fitter.fit({getElement:()=>({getBoundingClientRect:()=>({left:20,right:300,top,bottom:top+300,width:280})})});
 while(queued){const next=queued;queued=null;next();}assert(panCount>1,'pitched projection needs multiple post-frame checks');assert(top>=270);
 fitter.fit({getElement:()=>({getBoundingClientRect:()=>({left:20,right:300,top:-100,bottom:200,width:280})})});assert(queued);fitter.dispose();assert.equal(queued,null,'disposal cancels pending popup work');
 console.log('PASS: popup fitting at top/right/bottom viewport edges');
})().catch(e=>{console.error(e);process.exitCode=1;});
