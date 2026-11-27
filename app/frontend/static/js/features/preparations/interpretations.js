/** Separate original support, interpreted categories and optional unverified hypotheses. */
import {equalValue} from './draft.js';
export const interpretationText={
  classifications:'Categorie interpretate',hypotheses:'Ipotesi sulle sigle',original:'Passaggio originale',context:'Contesto della fonte',
  aiProposed:'Interpretazione IA — da verificare',aiUnverified:'Ipotesi IA non verificata — da confermare',aiOrigin:'Proposta IA',manualOrigin:'Inserita manualmente',
  proposed:'Interpretazione da confermare',confirmed:'Categoria confermata',rejected:'Proposta rifiutata',stale:'Da riesaminare: il dato di partenza è cambiato',
  unverified:'Ipotesi non verificata',verified:'Ipotesi verificata separatamente',confirm:'Conferma questa categoria',reject:'Rifiuta questa proposta',
  verify:'Verifica solo questa ipotesi',verificationNote:'Come e presso quale fonte indipendente hai verificato questa ipotesi?',
  interpretationNote:'Motiva la tua interpretazione e la scelta di questa categoria',required:'Indica una verifica indipendente; il passaggio che contiene la sigla non basta.',
  choiceRequired:'Motiva esplicitamente questa scelta.',separate:'La verifica della sigla non conferma una categoria né l’intera scheda.',
  manual:'Verifica manuale attribuita',sourceOnly:'Il contesto aiuta a interpretare, non è una citazione del servizio.',
  noSupport:'Supporto originale non disponibile in questa vista.',choose:'Categoria proposta',selected:'Scelta per questa revisione',
  clearSelection:'Annulla questa scelta',
  authorConfirmed:'Confermata nella preparazione: scegli separatamente se accettarla',
};
const same=equalValue;

export function interpretationEvidence(record,payload,support=[]) {
  const ids=new Set([...(record.basis?.evidence_ids || []),...(record.candidates || []).flatMap(candidate=>candidate.support_evidence_ids || []),...(record.verification?.evidence_ids || [])]);
  const frozen=support.filter(entry=>same(entry.basis,record.basis));
  const evidence=new Map([...(payload.evidence || []),...frozen.flatMap(entry=>entry.evidence || [])].filter(entry=>ids.has(entry.id)).map(entry=>[entry.id,entry]));
  return {evidence:[...evidence.values()],context:frozen.flatMap(entry=>entry.context_support || [])};
}

export function reviewPayload(context) {
  const proposed=context.snapshot.values,writable=!context.resolution && !context.closed,original=!context.service_id || !writable;
  const payload={schema_version:proposed.schema_version || 1,service:structuredClone(original?proposed.service:context.baseline),
    location:structuredClone(original?proposed.location:{kind:'none'}),target:structuredClone(proposed.target),
    field_origins:structuredClone(original?proposed.field_origins || {}:{}),evidence:structuredClone(context.snapshot.evidence),outcome:'review'};
  if(payload.schema_version>=2){
    payload.source_facts=structuredClone(proposed.source_facts || []);payload.resolutions=structuredClone(proposed.resolutions || []);
    Object.assign(payload.field_origins,structuredClone(Object.fromEntries(Object.entries(proposed.field_origins || {}).filter(([path])=>path.startsWith('/source_facts/')))));
  }
  if(payload.schema_version>=3){payload.interpreted_classifications=structuredClone(proposed.interpreted_classifications || []);payload.interpretation_hypotheses=structuredClone(proposed.interpretation_hypotheses || []);}
  if(payload.schema_version>=3 && writable && !context.service_id){
    const interpreted=payload.interpreted_classifications.flatMap(record=>[record.selected?.target,...record.candidates.map(candidate=>candidate.target)]).filter(Boolean);
    if(payload.service.classifications)payload.service.classifications=payload.service.classifications.filter(value=>!interpreted.some(target=>target.adoption_id===value.adoption_id && target.term_id===value.term_id));
  }
  if(context.resolution){payload.service=structuredClone(context.accepted_service);payload.location=structuredClone(context.accepted_location || {kind:'none'});payload.field_origins={};payload.evidence=[];
    if(payload.schema_version>=2){payload.source_facts=[];payload.resolutions=[];}
    if(payload.schema_version>=3){payload.interpreted_classifications=[];payload.interpretation_hypotheses=[];}
  }
  return payload;
}

export function selectReviewInterpretation(payload,selections,record,target,note,baseline={}) {
  if(!note.trim() || record.state==='stale' || !record.candidates.some(candidate=>same(candidate.target,target)))throw new Error('explicit_interpretation_required');
  const previous=selections[record.interpretation_id];
  selections[record.interpretation_id]={target:structuredClone(target),note:note.trim()};
  const values=payload.service.classifications || [];
  if(previous && !Object.values(selections).some(value=>same(value.target,previous.target)) && !(baseline.classifications || []).some(value=>value.adoption_id===previous.target.adoption_id && value.term_id===previous.target.term_id)){
    payload.service.classifications=values.filter(value=>value.adoption_id!==previous.target.adoption_id || value.term_id!==previous.target.term_id);
  }
  payload.service.classifications??=[];
  if(!payload.service.classifications.some(value=>value.adoption_id===target.adoption_id && value.term_id===target.term_id))payload.service.classifications.push({adoption_id:target.adoption_id,term_id:target.term_id});
}

export function clearReviewInterpretation(payload,selections,id,baseline={}) {
  const previous=selections[id];delete selections[id];
  if(previous && !Object.values(selections).some(value=>same(value.target,previous.target)) && !(baseline.classifications || []).some(value=>value.adoption_id===previous.target.adoption_id && value.term_id===previous.target.term_id)){
    payload.service.classifications=(payload.service.classifications || []).filter(value=>value.adoption_id!==previous.target.adoption_id || value.term_id!==previous.target.term_id);
  }
}

export function createInterpretationControls({node,button}) {
  function render(root,draft,context,canEdit,changed,redraw) {
    const text={...interpretationText,...context.text?.interpretations},support=context.interpretationSupport || [];
    draft.interpretationNotes??={};
    const label=target=>context.referenceLabel?.(target) || context.references?.classifications?.find(entry=>entry.adoption_id===target.adoption_id && entry.term_id===target.term_id)?.name || text.choose;
    function evidence(row,record){
      const original=interpretationEvidence(record,draft.payload,support);
      for(const item of original.evidence){const part=node('div');part.append(node('strong',item.kind==='manual'?text.manual:text.original));if(item.quote)part.append(node('blockquote',item.quote));if(item.note)part.append(node('p',item.note));row.append(part);}
      for(const item of original.context){const part=node('div');part.append(node('strong',text.context),node('p',item.quote || item.text),node('p',text.sourceOnly,'hint'));row.append(part);}
      if(!original.evidence.length)row.append(node('p',text.noSupport,'hint'));
      return original.evidence;
    }
    const classifications=node('section',undefined,'preparation-interpretations');classifications.dataset.kind='interpreted_classifications';classifications.append(node('h3',text.classifications));
    for(const record of draft.payload.interpreted_classifications || []){
      const row=node('section',undefined,'preparation-interpretation');row.dataset.interpretationId=record.interpretation_id;
      row.append(node('strong',context.interpretationReview && record.state==='confirmed'?text.authorConfirmed:record.method==='ai' && record.state==='proposed'?text.aiProposed:text[record.state] || text.proposed));row.append(node('p',record.method==='ai'?text.aiOrigin:text.manualOrigin,'hint'));evidence(row,record);
      if(record.selected?.target)row.append(node('p',label(record.selected.target)));
      const note=node('textarea');note.maxLength=4000;note.setAttribute('aria-label',text.interpretationNote);
      note.value=draft.interpretationNotes[record.interpretation_id] || '';note.addEventListener('input',()=>{draft.interpretationNotes[record.interpretation_id]=note.value;});
      const status=node('p',undefined,'hint');status.setAttribute('role','status');
      if(context.interpretationReview && canEdit){const wrap=node('label');wrap.append(node('span',text.interpretationNote),note);row.append(wrap);}
      for(const candidate of record.candidates || []){
        const choice=node('div');choice.append(node('p',label(candidate.target)),node('p',candidate.reason));
        if(canEdit && record.state!=='stale')choice.append(button(text.confirm,()=>{
          if(context.interpretationReview){
            if(!note.value.trim()){status.textContent=text.choiceRequired;return;}
            context.selectInterpretation?.(record,candidate.target,note.value.trim());
          }else draft.chooseInterpretation(record.interpretation_id,candidate.target,context.actor_id);
          changed();redraw();
        },!context.interpretationReview && !context.actor_id));
        row.append(choice);
      }
      if(context.interpretationSelections?.[record.interpretation_id]){row.append(node('p',text.selected));if(canEdit)row.append(button(text.clearSelection,()=>{context.clearInterpretation?.(record);changed();redraw();}));}
      if(canEdit && !context.interpretationReview)row.append(button(text.reject,()=>{draft.rejectInterpretation(record.interpretation_id);changed();redraw();}));
      row.append(status);classifications.append(row);
    }
    classifications.hidden=!(draft.payload.interpreted_classifications || []).length;
    const hypotheses=node('section',undefined,'preparation-hypotheses');hypotheses.dataset.kind='interpretation_hypotheses';hypotheses.append(node('h3',text.hypotheses));
    for(const record of draft.payload.interpretation_hypotheses || []){
      const row=node('section');row.dataset.hypothesisId=record.hypothesis_id;row.append(node('strong',!!record.job_id && record.state==='unverified'?text.aiUnverified:text[record.state] || text.unverified),node('p',!!record.job_id?text.aiOrigin:text.manualOrigin,'hint'),node('p',record.statement),node('p',text.separate,'hint'));
      const originals=evidence(row,record);
      if(canEdit && !context.interpretationReview && record.state!=='stale'){
        const wrap=node('label'),note=node('textarea'),status=node('p',undefined,'hint');note.maxLength=4000;note.setAttribute('aria-label',text.verificationNote);status.setAttribute('role','status');wrap.append(node('span',text.verificationNote),note);row.append(wrap);
        note.value=draft.interpretationNotes[record.hypothesis_id] || '';note.addEventListener('input',()=>{draft.interpretationNotes[record.hypothesis_id]=note.value;});
        row.append(button(text.verify,()=>{
          if(!note.value.trim()){status.textContent=text.required;return;}
          const original=originals.find(item=>item.input_id && item.input_hash);if(!original){status.textContent=text.noSupport;return;}
          const decision=crypto.randomUUID(),manual={id:crypto.randomUUID(),path:record.basis.field_path,input_id:original.input_id,input_hash:original.input_hash,kind:'manual',note:note.value.trim()};
          draft.verifyHypothesis(record.hypothesis_id,manual,context.actor_id,decision);changed();redraw();
        },!context.actor_id),button(text.reject,()=>{draft.rejectHypothesis(record.hypothesis_id);changed();redraw();}),status);
      }
      hypotheses.append(row);
    }
    hypotheses.hidden=!(draft.payload.interpretation_hypotheses || []).length;root.append(classifications,hypotheses);
  }
  return {render};
}
