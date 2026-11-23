/** Keep visitor data in request bodies and cancel page-owned requests. */
import {runtime,context} from "./map-state.js";
export async function managedFetch(url,options={}){
  const signals=[runtime.lifecycle?.signal,options.signal].filter(Boolean);
  const signal=signals.length>1 ? AbortSignal.any(signals) : signals[0];
  const response=await fetch(url,{...options,signal});
  if(signal?.aborted) throw new DOMException("Cancelled","AbortError");
  return response;
}
export function post(url,body,signal){
  return managedFetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal});
}
