/** Browser request Adapter; stale fetch and JSON completions cannot escape their lifecycle. */
export function createHttp(scope, fetcher=globalThis.fetch.bind(globalThis)) {
  async function request(url,options={}) {
    const signal=options.signal ? AbortSignal.any([scope.signal,options.signal]) : scope.signal;
    signal.throwIfAborted();
    const response=await fetcher(url,{...options,signal});signal.throwIfAborted();
    return {ok:response.ok,status:response.status,async json(){
      signal.throwIfAborted();const value=await response.json();signal.throwIfAborted();return value;
    }};
  }
  return {request,post:(url,body,signal)=>request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal})};
}
