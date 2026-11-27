/** Build exact-head decisions from a complete baseline; omit all canonical proof. */
import {equalValue} from './draft.js';
export function withoutEvidence(value) {
  if(Array.isArray(value))return value.map(withoutEvidence);
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='evidence').map(([key,child])=>[key,withoutEvidence(child)]));
  return value;
}
export function decisionFor(context,payload,reason,observation,reconciliations={},interpretationSelections={}) {
  const baseline=withoutEvidence(context.baseline), body=withoutEvidence(payload.service);
  const evidence_ids=context.snapshot.evidence.filter(item=>['stated','interpreted'].includes(item.kind) && item.span && typeof item.quote==='string').map(item=>item.id);
  const operations=[];
  for(const key of new Set([...Object.keys(baseline),...Object.keys(body)])) {
    if(JSON.stringify(baseline[key])===JSON.stringify(body[key]))continue;
    const operation={op:key in body?(key in baseline?'replace':'add'):'remove',path:'/'+key.replace(/~/g,'~0').replace(/\//g,'~1'),evidence_ids};
    if(key in body)operation.value=body[key];operations.push(operation);
  }
  const decision={schema_version:1,expected_service_work:context.working,expected_service_public:context.public,
    service_operations:operations,location:withoutEvidence(payload.location),reason,
    observations:observation?[{paths:['/service','/location/body'],method:observation.method,note:observation.note}]:[]};
  if(payload.schema_version>=2){
    decision.schema_version=2;
    decision.fact_actions=payload.source_facts.map(fact=>{
      const resolution=payload.resolutions.find(item=>item.fact_id===fact.fact_id);
      if(resolution?.state!=='confirmed')return {fact_id:fact.fact_id,action:'keep'};
      return {fact_id:fact.fact_id,action:resolution.selected.target.kind==='new_organization'?'create':'select',
        context:structuredClone(resolution.context),selected:structuredClone(resolution.selected),note:reason,reconcile:reconciliations[fact.fact_id] || 'retain'};
    });
  }
  for(const [id,choice]of Object.entries(interpretationSelections)){
    const original=context.snapshot.values?.interpreted_classifications?.find(record=>record.interpretation_id===id);
    if(!original || original.state==='stale' || !choice.note?.trim() || !original.candidates.some(candidate=>equalValue(candidate.target,choice.target)))throw new Error('invalid_interpretation_selection');
    if((payload.service.classifications || []).some(value=>value.adoption_id===choice.target.adoption_id && value.term_id===choice.target.term_id)){
      decision.observations.push({paths:['/service/classifications'],method:'other',note:choice.note.trim()});
      for(const operation of operations)if(operation.path==='/classifications')operation.evidence_ids=[];
    }
  }
  return decision;
}

/** Preserve one immutable canonical decision while a transport outcome is unknown. */
export function createAcceptanceAttempt({request,key,onState,onAccepted,onError}) {
  let pending,inFlight=false,complete=false;
  function notify() {onState({locked:!!pending || complete,inFlight,complete,uncertain:!!pending && !inFlight && !complete});}
  return {
    get locked(){return !!pending || complete;},
    get inFlight(){return inFlight;},
    async send(build) {
      if(inFlight || complete)return;
      pending ??= {request_key:key(),decision:structuredClone(build())};
      inFlight=true;notify();
      try{const result=await request(structuredClone(pending));complete=true;onAccepted(result);}
      catch(error){if(error.status>=400 && error.status<500)pending=undefined;onError(error);}
      finally{inFlight=false;notify();}
    }
  };
}
