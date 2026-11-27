/** Save one immutable attempt and reconcile authoritative values without dropping newer edits. */
function visibleDecisions(payload) {
  return JSON.stringify({classifications:payload.service?.classifications || [],
    interpretations:(payload.interpreted_classifications || []).map(row=>[row.interpretation_id,row.state,row.selected?.target || null]),
    hypotheses:(payload.interpretation_hypotheses || []).map(row=>[row.hypothesis_id,row.state])});
}
export async function saveDraft(draft,api,workspace,key) {
  const path='/preparazioni/'+encodeURIComponent(workspace),attempt=draft.attempt(key);
  const receipt=await api(path+'/schede',attempt);
  const after=receipt.items.find(item=>item.item_id===draft.item)?.after;
  if(!after)throw new Error('invalid_save_receipt');
  if((attempt.changes[0].payload.schema_version || 1)<2) {
    draft.acknowledge(receipt);
    return {receipt,conflicts:[],refreshView:false};
  }
  // A failed read must keep the original request/key: its write already committed.
  draft.pending.committedVersion=after;
  const result=await api(path+'/schede/'+encodeURIComponent(draft.item)+'?version='+encodeURIComponent(after));
  if(result.version?.id!==after)throw new Error('invalid_normalized_version');
  const refreshView=visibleDecisions(attempt.changes[0].payload)!==visibleDecisions(result.version.payload);
  return {receipt,conflicts:draft.reconcileSaved(result.version),refreshView};
}
