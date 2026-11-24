/** Own cancellation, timers and cleanup for exactly one mounted page. */
export class Lifecycle {
  constructor() { this.controller=new AbortController(); this.cleanups=[]; }
  get signal() { return this.controller.signal; }
  check() { this.signal.throwIfAborted(); }
  every(callback,delay) { const id=setInterval(callback,delay);this.own(()=>clearInterval(id));return id; }
  later(callback,delay) { const id=setTimeout(()=>{if(!this.signal.aborted)callback();},delay);this.own(()=>clearTimeout(id));return id; }
  own(cleanup) { if(this.signal.aborted)cleanup();else this.cleanups.push(cleanup); }
  dispose() { if(this.signal.aborted)return;this.controller.abort();for(const clean of this.cleanups.splice(0).reverse())clean(); }
}

/** Own actual page startup, BFCache recreation and final listener removal. */
export function startPage(create, host=window) {
  let page;
  const mount=()=>{page=create();void page.mount();};
  const hide=()=>page.dispose();
  const show=event=>{if(event.persisted){page.dispose();mount();}};
  host.addEventListener('pagehide',hide);
  host.addEventListener('pageshow',show);
  mount();
  return {dispose(){page.dispose();host.removeEventListener('pagehide',hide);host.removeEventListener('pageshow',show);}};
}
