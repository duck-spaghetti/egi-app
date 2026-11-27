/** Private group review on the existing workspace/draft, without provider authority. */
import {node,button} from './fields.js';
import {equalValue} from './draft.js';
export const groupText={title:'Gruppi di categorie',intro:'Raggruppa etichette originali o interpretazioni e scegli separatamente la categoria comune. Nessuna unione di servizi o termini.',
 load:'Carica gruppi',bases:'Carica elementi delle schede selezionate',variants:'Trova varianti di scrittura',manual:'Crea gruppo dagli elementi selezionati',
 contexts:'Carica contesti',context:'Territorio e asse',chooseContext:'Scegli il contesto',contextPending:'Conferma territorio e asse nel selettore prima di accettare una categoria.',mapping:'Categoria comune da valutare',noMapping:'Nessuna categoria comune scelta',
 next:'Altri risultati',members:'elementi',original:'Etichetta originale',interpreted:'Classificazione interpretata',proof:'Passaggi originali',protected:'Valore corretto o svuotato: la decisione manuale resta protetta',
 select:'Seleziona questo elemento',accept:'Accetta gruppo e categoria',revise:'Salva revisione manuale',archive:'Archivia gruppo',split:'Crea sotto-gruppo manuale dalla selezione',combine:'Combina gruppi selezionati',
 apply:'Applica soltanto agli elementi selezionati',continue:'Continua la stessa operazione',retry:'Riprova la stessa richiesta',undo:'Annulla applicazioni riuscite',receipts:'Operazioni e ricevute',
 spelling:'Varianti di scrittura: il significato va controllato. Nessuna categoria è assegnata automaticamente.',prepare:'Prepara questo gruppo',saveProposal:'Salva proposta di gruppo',
 selected:'Selezionati',none:'Nessun risultato in questa pagina',choose:'Seleziona da 1 a 100 schede; scegli un contesto per le varianti.',
 limit:'Seleziona al massimo 100 elementi per una singola applicazione. Il gruppo può contenerne fino a 1000.',stale:'Il gruppo o le schede sono cambiati: aggiorna e confronta prima di riprovare.',
 failed:'Operazione non completata. Le scelte locali sono conservate.',uncertain:'Esito non ancora noto: riprova la stessa richiesta senza cambiare selezione.',
 noContext:'Scegli territorio, asse e una categoria prima di accettare il gruppo.',incompatible:'I gruppi hanno contesti diversi; correggili prima di combinarli.',variantsUnavailable:'Le varianti locali non sono disponibili. Puoi comunque creare e rivedere un gruppo manuale.',
 proposed:'Da valutare',accepted:'Accettato',archived:'Archiviato',pending:'In attesa',applied:'Applicata',skipped:'Esclusa',conflict:'Conflitto',
 already_selected:'Categoria già selezionata',manual_or_cleared:'Decisione manuale preservata',invalid_context:'Contesto non valido',stale_item:'Scheda modificata',ineligible_item:'Scheda non disponibile',unsupported_member:'Elemento non disponibile',invalid_card:'Scheda da correggere',openCard:'Apri scheda',
 readOnly:'Sola lettura',selection:'Selezione esplicita',saving:'Operazione in corso',refresh:'Aggiorna gruppi e ricevute',emptyProof:'Passaggio non disponibile in questa vista',
 equivalent:'Proposta di equivalenza',related:'Offerte correlate, non sinonimi',ambiguous:'Significato da chiarire',unknown_context:'Contesto non noto',mixed_context:'Contesti diversi',unsampled_occurrences:'Alcune occorrenze non sono state esaminate',incomplete_catalog:'Catalogo parziale',insufficient_context:'Contesto insufficiente',
 shown:'Mostrati',of:'di',literalCount:'Etichette originali confrontate',interpretedCount:'Interpretazioni escluse dal confronto di scrittura',contextSupport:'Contesto della fonte: aiuta a interpretare, non è una citazione del servizio',
 issues:'Aspetti da verificare',
 groupCategory:'Categoria accettata nel gruppo',categoryChange:'Per cambiare categoria, salva e accetta una revisione prima di applicarla.',categoryUnknown:'Rileggi il catalogo per vedere il nome della categoria accettata.',
 integrate:'Integra gli elementi selezionati usando le loro versioni correnti',
 confirmed:'Già confermata: la decisione viene preservata',rejected:'Rifiutata: la decisione viene preservata',staleInterpretation:'Da riesaminare dopo una modifica della scheda',
 proposalBlocked:'La proposta non dimostra equivalenza applicabile. Puoi esaminarla e preparare una revisione manuale esplicita.',
 savedRefresh:'Operazione registrata. Aggiorna la vista e confronta eventuali modifiche locali.',
 };
const memberKey=value=>[value.item_id,value.basis_kind,value.basis_id].join(':');
function uniqueMembers(values){const result=new Map();for(const value of values){const key=memberKey(value);if(result.has(key) && !equalValue(result.get(key),value))throw new Error('member_version_conflict');result.set(key,structuredClone(value));}return [...result.values()];}

export function createGroups(host) {
 const text={...groupText,...host.context?.text?.groups},states=new Map();let state,disposed=false;
 const scope=()=>host.workspace()?.id,base=s=>'/preparazioni/'+s.workspace+'/gruppi';
 const current=s=>!disposed && state===s && scope()===s.workspace;
 const writable=s=>current(s) && host.canEdit() && !s.busy && !s.pending;
 function focusControl(key){for(const control of host.root.querySelectorAll?.('[data-group-focus]') || [])if(control.dataset.groupFocus===key){control.focus();break;}}
 function initial(workspace){return {workspace,groups:[],operations:[],basis:[],basisSelected:new Map(),selection:new Map(),combined:new Map(),contexts:[],catalog:[],context:null,view:null,receipt:null,pending:null,busy:false,message:'',offset:null,basisOffset:null,groupOffset:0};}
 async function read(path,body){return host.api(path,body);}
 async function guarded(action){const s=state;if(!s || !current(s) || s.busy)return;s.busy=true;render();try{return await action(s);}catch(error){s.message=s.pending?text.uncertain:error.message==='reviewer_unavailable'||error.code==='reviewer_unavailable'?text.variantsUnavailable:error.status===409?text.stale:text.failed;host.error?.(error);}finally{s.busy=false;if(current(s))render();}}
 async function refresh(s=state){
  const [groups,operations]=await Promise.all([read(base(s)+'?offset=0&limit=50'),read(base(s)+'/operazioni?offset=0&limit=50')]);
  s.groups=groups.groups;s.offset=groups.next_offset;s.operations=operations.operations || [];s.operationOffset=operations.next_offset;
 }
 async function write(s,path,body,kind='group'){
  if(!current(s) || !host.canEdit())return;
  if(!s.pending){if(await host.flush()===false || !current(s))return;s.pending={path,body:structuredClone(body),kind};}
  const pending=s.pending;let result;
  try{
   result=await read(pending.path,pending.body);
  }catch(error){if(error.status>=400 && error.status<500)s.pending=null;else s.message=text.uncertain;throw error;}
  s.message='';
  if(pending.kind==='group'){s.view=result;s.selection.clear();s.combined.clear();s.pending=null;if(s.proposal){s.proposal=null;s.basisSelected.clear();}}
  else{s.receipt={...result,kind:result.kind || pending.kind};if(result.state==='complete')s.pending=null;}
  // A failed refresh cannot turn a known receipt into an uncertain write, nor
  // discard the exact continuation body of already committed pending members.
  try{
   if(pending.kind==='group')s.view=await read(base(s)+'/'+result.group.group_id+'?version='+result.group.version+'&offset=0&limit=100');
   else await host.refresh?.(result,s.workspace);
   await refresh(s);
  }catch(error){s.message=text.savedRefresh;host.error?.(error);}
  return result;
 }
 function resumeReceipt(s){
  const body=s.receipt.resume_request;
  if(s.receipt.kind==='apply')return write(s,base(s)+'/'+body.group_id+'/applica',{expected_group_version:body.expected_group_version,selection:body.selection,request_key:body.request_key},'apply');
  if(s.receipt.kind==='undo')return write(s,base(s)+'/operazioni/'+body.original_operation+'/annulla',{request_key:body.request_key},'undo');
  throw new Error('invalid_group_resume');
 }
 async function completeGroup(s,group=s.view){
  if(!group)throw new Error('no_group');
  const members=[...group.members];let offset=group.next_offset;
  while(offset!==null){const next=await read(base(s)+'/'+group.group.group_id+'?version='+group.group.version+'&offset='+offset+'&limit=100');members.push(...next.members);offset=next.next_offset;}
  if(members.length!==group.total_members || members.length>1000)throw new Error('group_member_bound');
  return {...structuredClone(group.group),members};
 }
 function revision(s,members,{parent=[],method='manual',proposal=null,id=crypto.randomUUID(),mapping=null,context=s.context || {}}={}){
  const actual=uniqueMembers(members);if(!actual.length || actual.length>1000)throw new Error('group_member_bound');
  return {group_id:id,version:crypto.randomUUID(),parent_versions:parent,preparation_id:s.workspace,context:structuredClone(context),members:actual,mapping:structuredClone(mapping),state:'proposed',method,proposal_id:proposal};
 }
 async function saveRevision(s,value,expected=null){return write(s,base(s),{expected_version:expected,revision:value,request_key:crypto.randomUUID()});}
 async function open(group,version=null){return guarded(async s=>{s.view=await read(base(s)+'/'+group+'?offset=0&limit=100'+(version?'&version='+version:''));s.selection.clear();s.proposal=null;s.context=structuredClone(s.view.group.context);s.mapping=structuredClone(s.view.group.mapping);s.contextChosen=false;if(s.view.linked_proposal?.retained)s.catalog=s.view.linked_proposal.catalog_choices;});}
 async function loadBasis(s,offset=0){
  const items=offset?s.basisItems:host.selectedItems?.() || (host.draft?.()?[host.draft().item]:[]);
  if(!items.length || items.length>100){s.message=text.choose;return;}
  const page=await read(base(s)+'/basi',{item_ids:items,offset,limit:50});s.basis=page.bases;s.basisOffset=page.next_offset;s.basisTotal=page.total;s.basisItems=[...items];
 }
 async function contexts(s,offset=0){const page=await read('/preparazioni/'+s.workspace+'/catalogo',{query:{kind:'taxonomy_context',offset,limit:50}});s.contexts=offset?[...s.contexts,...page.entries]:page.entries;s.contextOffset=page.next_offset;}
 async function chooseContext(s,value){
  s.context=await read(base(s)+'/contesto',{territory_id:value.territory_id,axis_id:value.axis_id});
  const page=await read('/preparazioni/'+s.workspace+'/catalogo',{query:{kind:'classification',territory_id:value.territory_id,axis_id:value.axis_id,offset:0,limit:50}});
  s.catalog=page.entries;s.catalogOffset=page.next_offset;s.mapping=null;
  s.contextChosen=true;
 }
 function revisedContext(s,group){
  const selected=s.context || group.context;
  if(group.context.territory_id && (group.context.territory_id!==selected.territory_id || group.context.axis_id!==selected.axis_id)){s.message=text.incompatible;return null;}
  return group.proposal_id?structuredClone(group.context):structuredClone(selected);
 }
 async function currentRevision(s){
  const group=s.view.group,context=revisedContext(s,group);if(!context)return null;
  const value=await completeGroup(s);
  value.version=crypto.randomUUID();value.parent_versions=equalValue(context,group.context)?[group.version]:[];
  value.state='proposed';value.context=context;
  return value;
 }
 async function reviseGroup(s,integrate=false){
  const expected=s.view.group.version,value=await currentRevision(s);if(!value)return;
  if(integrate){
   const members=new Map(value.members.map(member=>[memberKey(member),member]));
   for(const [key,member]of s.basisSelected)members.set(key,structuredClone(member));
   if(members.size>1000){s.message=text.limit;return;}
   value.members=[...members.values()];
  }
  value.method='manual';value.proposal_id=null;value.mapping=structuredClone(s.mapping || value.mapping);
  return saveRevision(s,value,expected);
 }
 async function acceptGroup(s){
  if(!s.contextChosen || !s.context || !s.mapping){s.message=text.noContext;return;}
  const expected=s.view.group.version,value=await currentRevision(s);if(!value)return;
  value.state='accepted';value.mapping=structuredClone(s.mapping);
  return saveRevision(s,value,expected);
 }
 async function archiveGroup(s){
  const value=await completeGroup(s),expected=value.version;
  value.version=crypto.randomUUID();value.parent_versions=[expected];value.state='archived';
  return saveRevision(s,value,expected);
 }
 async function combineGroups(s){
  const parents=[];
  for(const [id,version]of s.combined){
   const group=await read(base(s)+'/'+id+'?version='+version+'&offset=0&limit=100');
   parents.push(await completeGroup(s,group));
  }
  if(parents.length<2)return;
  if(parents.some(parent=>!equalValue(parent.context,parents[0].context))){s.message=text.incompatible;return;}
  const value=revision(s,parents.flatMap(parent=>parent.members),{
   parent:parents.map(parent=>parent.version),context:parents[0].context,
   mapping:parents.every(parent=>equalValue(parent.mapping,parents[0].mapping))?parents[0].mapping:null,
  });
  return saveRevision(s,value);
 }
 function row(parent,detail,selection,s,maximum=1000){
  const member=detail.member,key=memberKey(member),line=node('section',undefined,'preparation-group-member'),label=node('label'),check=node('input');check.type='checkbox';check.checked=selection.has(key);check.disabled=!writable(s);check.setAttribute('aria-label',text.select+' · '+(detail.name || detail.label || text.members));check.dataset.groupFocus=(selection===s.selection?'apply:':'basis:')+key;
  check.addEventListener('change',()=>{if(check.checked && selection.size>=maximum){check.checked=false;s.message=text.limit;}else if(check.checked)selection.set(key,structuredClone(member));else selection.delete(key);render();focusControl(check.dataset.groupFocus);});
  label.append(check,node('strong',detail.name || detail.label || text.members));line.append(label,node('p',detail.origin==='interpreted_classification'?text.interpreted:text.original),node('p',detail.label || text.emptyProof));
  if(detail.origin==='interpreted_classification')line.append(node('p',detail.state==='stale'?text.staleInterpretation:text[detail.state] || text.proposed,'hint'));
  if(detail.state==='corrected')line.append(node('p',text.protected,'hint'));
  if(detail.value && detail.value!==detail.label)line.append(node('p',detail.value));
  const proof=node('details');proof.append(node('summary',text.proof));for(const evidence of detail.original?.evidence || []){if(evidence.quote)proof.append(node('blockquote',evidence.quote));if(evidence.note)proof.append(node('p',evidence.note));}line.append(proof);parent.append(line);
  for(const support of detail.context_support || [])line.append(node('p',text.contextSupport,'hint'),node('p',support.quote || support.text));
 }
 function render(){
  if(!state || disposed)return;const s=state,root=host.root;root.replaceChildren();root.append(node('h2',text.title),node('p',text.intro,'hint'));
  const status=node('p',s.busy?text.saving:s.message,'hint');status.setAttribute('role','status');root.append(status);
  if(s.pending){root.append(node('p',s.pending.kind!=='group' && s.receipt?.state==='running'?text.continue:text.uncertain),button(s.receipt?.state==='running'?text.continue:text.retry,()=>guarded(async()=>{await write(s,s.pending.path,s.pending.body,s.pending.kind);}),s.busy));}
  const toolbar=node('div');toolbar.append(button(text.refresh,()=>guarded(refresh),s.busy),button(text.contexts,()=>guarded(s=>contexts(s)),s.busy),button(text.bases,()=>guarded(s=>loadBasis(s)),!writable(s)));
  root.append(toolbar);
  const picker=node('select');picker.setAttribute('aria-label',text.context);picker.disabled=!writable(s);picker.append(new Option(text.chooseContext,''));
  s.contexts.forEach((entry,index)=>picker.append(new Option([entry.territory_label,entry.axis_label,entry.release_version].filter(Boolean).join(' · '),String(index))));
  const selected=s.contexts.findIndex(entry=>entry.territory_id===s.context?.territory_id && entry.axis_id===s.context?.axis_id);picker.value=selected<0 || !s.contextChosen?'':String(selected);
  picker.addEventListener('change',()=>{if(picker.value!=='')return guarded(s=>chooseContext(s,s.contexts[Number(picker.value)]));});root.append(picker);if((s.view || s.proposal) && !s.contextChosen)root.append(node('p',text.contextPending,'hint'));
  if(s.contextOffset!==null && s.contextOffset!==undefined)root.append(button(text.next+' · '+text.contexts,()=>guarded(s=>contexts(s,s.contextOffset)),s.busy));
  const linked=s.view?.linked_proposal || s.view?.proposal;
  const mappingEntries=s.view?.group.proposal_id?s.catalog.filter(entry=>(linked?.catalog_choices || []).some(candidate=>equalValue(candidate.target,entry.target))):s.catalog;
  const mapping=node('select');mapping.setAttribute('aria-label',text.mapping);mapping.disabled=!writable(s);mapping.append(new Option(text.noMapping,''));mappingEntries.forEach((entry,index)=>mapping.append(new Option(entry.label || entry.name || text.mapping,String(index))));mapping.value=mappingEntries.findIndex(entry=>equalValue(entry.target,s.mapping));
  mapping.dataset.groupFocus='mapping';mapping.addEventListener('change',()=>{s.mapping=mapping.value===''?null:structuredClone(mappingEntries[Number(mapping.value)].target);render();focusControl('mapping');});root.append(mapping);
  if(s.catalogOffset!==null && s.catalogOffset!==undefined)root.append(button(text.next+' · '+text.mapping,()=>guarded(async s=>{const page=await read('/preparazioni/'+s.workspace+'/catalogo',{query:{kind:'classification',territory_id:s.context.territory_id,axis_id:s.context.axis_id,offset:s.catalogOffset,limit:50}});s.catalog.push(...page.entries);s.catalogOffset=page.next_offset;}),s.busy));
  root.append(button(text.variants,()=>guarded(async s=>{
   if(!s.context){s.message=text.noContext;return;}const items=host.selectedItems?.() || [];if(!items.length || items.length>100){s.message=text.choose;return;}
   s.variantQuery={item_ids:[...items],territory_id:s.context.territory_id,axis_id:s.context.axis_id,offset:0,limit:25,member_offset:0,member_limit:100};s.variants=await read(base(s)+'/varianti',s.variantQuery);
  }),!writable(s)));
  for(const variant of s.variants?.groups || []){const part=node('section');part.append(node('h3',variant.label),node('p',text.spelling),node('p',String(variant.total_members)+' '+text.members));
   part.append(button(text.prepare,()=>guarded(async s=>{
    const members=[...variant.members];let offset=variant.next_member_offset;
    while(offset!==null){const page=await read(base(s)+'/varianti',{...s.variantQuery,member_offset:offset});const same=page.groups.find(group=>group.variant_key===variant.variant_key);if(!same || same.total_members!==variant.total_members)throw new Error('variants_changed');members.push(...same.members);offset=same.next_member_offset;}
    if(members.length!==variant.total_members)throw new Error('variants_incomplete');await saveRevision(s,revision(s,members,{method:'deterministic',context:variant.context}));
   }),!writable(s)));root.append(part);}
  if(s.variants?.next_offset!==null && s.variants?.next_offset!==undefined)root.append(button(text.next+' · '+text.variants,()=>guarded(async s=>{s.variantQuery={...s.variantQuery,offset:s.variants.next_offset};s.variants=await read(base(s)+'/varianti',s.variantQuery);}),s.busy));
  if(s.variants)root.append(node('p',text.literalCount+': '+(s.variants.literal_bases ?? s.variants.total_bases ?? 0)+' · '+text.interpretedCount+': '+(s.variants.interpreted_bases || 0),'hint'));
  if(s.basis.length){const section=node('section');section.append(node('h3',text.selection+' · '+s.basisSelected.size+'/'+s.basisTotal),node('p',text.shown+' '+s.basis.length+' '+text.of+' '+s.basisTotal,'hint'));for(const detail of s.basis)row(section,detail,s.basisSelected,s);root.append(section);}
  if(s.basisOffset!==null && s.basisOffset!==undefined)root.append(button(text.next+' · '+text.members,()=>guarded(s=>loadBasis(s,s.basisOffset)),s.busy));
  root.append(button(text.manual,()=>guarded(s=>saveRevision(s,revision(s,[...s.basisSelected.values()]))),!writable(s) || !s.basisSelected.size || !!s.proposal));
  if(s.proposal)root.append(button(text.saveProposal,()=>guarded(s=>saveRevision(s,revision(s,[...s.basisSelected.values()],{method:'ai',proposal:s.proposal.proposal_id,context:s.proposal.context}))),!writable(s) || !s.basisSelected.size));
  if(s.proposal){root.append(node('p',text[s.proposal.relation] || text.ambiguous));if(s.proposal.reason)root.append(node('p',s.proposal.reason));for(const issue of s.proposal.membership_issues || [])root.append(node('p',text[issue.reason] || issue.reason,'hint'));}
  const list=node('section');list.append(node('h3',text.load));
  for(const group of s.groups){const line=node('div'),select=node('input');select.type='checkbox';select.checked=s.combined.has(group.group_id);select.disabled=!writable(s);select.dataset.groupFocus='combine:'+group.group_id;select.setAttribute('aria-label',text.combine+' · '+group.member_count+' '+text.members);select.addEventListener('change',()=>{if(select.checked)s.combined.set(group.group_id,group.version);else s.combined.delete(group.group_id);render();focusControl(select.dataset.groupFocus);});line.append(select,button((text[group.state] || text.proposed)+' · '+group.member_count+' '+text.members,()=>open(group.group_id),s.busy));list.append(line);}root.append(list);
  if(s.offset!==null && s.offset!==undefined)root.append(button(text.next+' · '+text.load,()=>guarded(async s=>{const page=await read(base(s)+'?offset='+s.offset+'&limit=50');s.groups.push(...page.groups);s.offset=page.next_offset;}),s.busy));
  root.append(button(text.combine,()=>guarded(combineGroups),!writable(s) || s.combined.size<2));
  if(s.view){const group=s.view.group,section=node('section');section.append(node('h3',(text[group.state] || text.proposed)+' · '+s.view.total_members+' '+text.members),node('p',text.selected+' '+s.selection.size+'/100'),node('p',text.shown+' '+s.view.members.length+' '+text.of+' '+s.view.total_members,'hint'));
   const category=s.catalog.find(entry=>equalValue(entry.target,group.mapping))?.label || (linked?.catalog_choices || []).find(entry=>equalValue(entry.target,group.mapping))?.label || host.context?.references?.classifications?.find(entry=>entry.adoption_id===group.mapping?.adoption_id && entry.term_id===group.mapping?.term_id)?.name;
   if(group.mapping)section.append(node('p',text.groupCategory+': '+(category || text.categoryUnknown)),node('p',text.categoryChange,'hint'));
   const applicable=!group.proposal_id || linked?.retained!==false && linked?.relation==='equivalent' && (linked.total_membership_issues ?? linked.membership_issues?.length)===0;
   if(!applicable)section.append(node('p',text.proposalBlocked,'hint'));
   if(linked){section.append(node('p',text[linked.relation] || text.ambiguous));for(const issue of linked.membership_issues || [])section.append(node('p',text[issue.reason] || issue.reason,'hint'));
    section.append(node('p',text.issues+' · '+(linked.membership_issues?.length || 0)+' '+text.of+' '+(linked.total_membership_issues || 0),'hint'));
    if(linked.next_issue_offset!==null && linked.next_issue_offset!==undefined)section.append(button(text.next+' · '+text.issues,()=>guarded(async s=>{const next=await read(base(s)+'/'+group.group_id+'?version='+group.version+'&offset='+linked.next_issue_offset+'&limit=100');s.view.linked_proposal={...next.linked_proposal,membership_issues:[...(linked.membership_issues || []),...next.linked_proposal.membership_issues]};}),s.busy));
   }
   for(const detail of s.view.details || s.view.members.map(member=>({member,origin:member.basis_kind})))row(section,detail,s.selection,s,100);
   if(s.view.next_offset!==null)section.append(button(text.next+' · '+text.members,()=>guarded(async s=>{const next=await read(base(s)+'/'+group.group_id+'?version='+group.version+'&offset='+s.view.next_offset+'&limit=100');s.view={...next,members:[...s.view.members,...next.members],details:[...(s.view.details || []),...(next.details || [])]};}),s.busy));
   section.append(button(text.revise,()=>guarded(s=>reviseGroup(s)),!writable(s)),
    button(text.integrate,()=>guarded(s=>reviseGroup(s,true)),!writable(s) || !s.basisSelected.size),
    button(text.accept,()=>guarded(acceptGroup),!writable(s) || !applicable || !s.contextChosen || !s.mapping),
    button(text.split,()=>guarded(s=>saveRevision(s,revision(s,[...s.selection.values()],{parent:[group.version],context:group.context,mapping:group.mapping}))),!writable(s) || !s.selection.size),
    button(text.archive,()=>guarded(archiveGroup),!writable(s)),
    button(text.apply,()=>guarded(s=>write(s,base(s)+'/'+group.group_id+'/applica',{expected_group_version:group.version,selection:[...s.selection.values()],request_key:crypto.randomUUID()},'apply')),!writable(s) || group.state!=='accepted' || !category || !s.selection.size));root.append(section);
  }
  const operations=node('section');operations.append(node('h3',text.receipts));
  for(const operation of s.operations)operations.append(button((operation.kind==='undo'?text.undo:text.apply)+' · '+(operation.state==='running'?text.pending:text.accepted),()=>guarded(async s=>{s.receipt=await read(base(s)+'/operazioni/'+operation.operation_id+'?offset=0&limit=100');}),s.busy));root.append(operations);
  if(s.operationOffset!==null && s.operationOffset!==undefined)root.append(button(text.next+' · '+text.receipts,()=>guarded(async s=>{const page=await read(base(s)+'/operazioni?offset='+s.operationOffset+'&limit=50');s.operations.push(...page.operations);s.operationOffset=page.next_offset;}),s.busy));
  if(s.receipt){const part=node('section');part.append(node('h3',s.receipt.kind==='undo'?text.undo:text.apply),node('p',Object.entries(s.receipt.summary || {}).map(([key,count])=>(text[key] || key)+': '+count).join(' · ')),node('p',text.shown+' '+s.receipt.items.length+' '+text.of+' '+s.receipt.total_items,'hint'));
   for(const item of s.receipt.items){part.append(node('p',(item.name?item.name+' · ':'')+(text[item.status] || text.pending)+(item.reason?' · '+(text[item.reason] || text.failed):'')));
    if(host.openCard)part.append(button(text.openCard+' · '+(item.name || text.members),()=>guarded(async s=>{if(host.canEdit() && await host.flush()===false)return;if(current(s))await host.openCard(item.item_id);}),s.busy));
   }
   if(s.receipt.next_offset!==null)part.append(button(text.next+' · '+text.receipts,()=>guarded(async s=>{s.receipt=await read(base(s)+'/operazioni/'+s.receipt.operation_id+'?offset='+s.receipt.next_offset+'&limit=100');}),s.busy));
   if(s.receipt.state==='running' && s.receipt.resume_request && !s.pending)part.append(button(text.continue,()=>guarded(resumeReceipt),!writable(s)));
   if(s.receipt.state==='complete' && s.receipt.kind==='apply')part.append(button(text.undo,()=>guarded(s=>write(s,base(s)+'/operazioni/'+s.receipt.operation_id+'/annulla',{request_key:crypto.randomUUID()},'undo')),!writable(s)));root.append(part);
  }
 }
 return {
  async load(workspace){if(disposed)return;if(!states.has(workspace.id))states.set(workspace.id,initial(workspace.id));state=states.get(workspace.id);render();await guarded(refresh);},
  open,refresh:()=>guarded(refresh),render,
  async prepareProposal(proposal){if(state?.pending)return;return guarded(async s=>{if(!proposal.proposal_id || !Array.isArray(proposal.members) || !proposal.members.length || proposal.members.length>1000 || proposal.total_members<proposal.members.length || uniqueMembers(proposal.members).length!==proposal.members.length)throw new Error('invalid_retained_proposal');s.view=null;s.selection.clear();s.contextChosen=false;s.basisOffset=null;s.proposal=structuredClone(proposal);s.context=proposal.context;s.basis=proposal.details || proposal.members.map(member=>({member,origin:member.basis_kind}));s.basisTotal=proposal.total_members;s.basisSelected=new Map(proposal.members.map(member=>[memberKey(member),member]));s.catalog=proposal.choices || [];return true;});},
  async saveProposal(){return guarded(s=>saveRevision(s,revision(s,[...s.basisSelected.values()],{method:'ai',proposal:s.proposal.proposal_id,context:s.proposal.context})));},
  current:()=>state,dispose(){disposed=true;states.clear();host.root.replaceChildren();},
 };
}
