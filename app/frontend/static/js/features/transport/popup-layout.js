/** Keep an asynchronously growing timetable inside the map's usable viewport. */
export function popupShift(box,viewport){
 const narrow=viewport.width<=600;
 const left=viewport.left+12,right=viewport.right-12,top=narrow?Math.min(viewport.top+270,viewport.bottom-200):viewport.top+12,bottom=viewport.bottom-120;
 const x=narrow?box.left-left:box.left<left?box.left-left:box.right>right?box.right-right:0;
 const y=box.top<top?box.top-top:box.bottom>bottom?box.bottom-bottom:0;
 return [x,y];
}

/** Refit after initial render, timetable replacement or map resize; no fixed geographic offsets. */
export function fitTransportPopup(map,popup){
 const box=popup?.getElement?.()?.getBoundingClientRect?.(),viewport=map.getContainer?.()?.getBoundingClientRect?.();
 if(!box||!viewport||!box.width||!viewport.width)return false;
 const shift=popupShift(box,viewport);
 if(!shift.some(n=>Math.abs(n)>1))return false;
 map.panBy?.(shift,{duration:0});return Boolean(map.panBy);
}

/** Recheck after projection frames: inclined maps do not translate off-centre points by panBy's full offset. */
export function createPopupFitter(map){
 const frame=globalThis.requestAnimationFrame?.bind(globalThis),cancel=globalThis.cancelAnimationFrame?.bind(globalThis);
 let current=null,pending=null,attempts=0,disposed=false;
 function clear(){cancel?.(pending);pending=null;current=null;}
 function run(){
  pending=null;if(disposed||!current||current.isOpen?.()===false)return;
  const moved=fitTransportPopup(map,current);
  if(moved&&++attempts<12&&frame)pending=frame(run);
 }
 return {fit(popup){if(disposed)return;clear();current=popup;attempts=0;run();},clear,dispose(){disposed=true;clear();}};
}
