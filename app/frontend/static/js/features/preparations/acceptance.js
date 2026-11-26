/** Build exact-head decisions from a complete baseline; omit all canonical proof. */
export function withoutEvidence(value) {
  if(Array.isArray(value))return value.map(withoutEvidence);
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='evidence').map(([key,child])=>[key,withoutEvidence(child)]));
  return value;
}
export function decisionFor(context,payload,reason,observation) {
  const baseline=withoutEvidence(context.baseline), body=withoutEvidence(payload.service);
  const evidence_ids=context.snapshot.evidence.filter(item=>['stated','interpreted'].includes(item.kind) && item.span && typeof item.quote==='string').map(item=>item.id);
  const operations=[];
  for(const key of new Set([...Object.keys(baseline),...Object.keys(body)])) {
    if(JSON.stringify(baseline[key])===JSON.stringify(body[key]))continue;
    const operation={op:key in body?(key in baseline?'replace':'add'):'remove',path:'/'+key.replace(/~/g,'~0').replace(/\//g,'~1'),evidence_ids};
    if(key in body)operation.value=body[key];operations.push(operation);
  }
  return {schema_version:1,expected_service_work:context.working,expected_service_public:context.public,
    service_operations:operations,location:withoutEvidence(payload.location),reason,
    observations:observation?[{paths:['/service','/location/body'],method:observation.method,note:observation.note}]:[]};
}
