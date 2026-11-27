/** Inspect retained scoped results; add only explicit unconfirmed selections. */
import {node,button as makeButton} from './fields.js';
import {interpretationText} from './interpretations.js';
const PAGE=50, MAX_SELECTION=100, MAX_MEMBERS=1000;
const relations={equivalent:'Possibili equivalenti, da controllare',related:'Categorie correlate: non sono equivalenti',ambiguous:'Appartenenza ambigua, da chiarire'};
const missing={incomplete_catalog:'Il catalogo fornito è parziale.',insufficient_context:'Il contesto non basta.',unknown_context:'Il contesto non è risolto.',mixed_context:'I contesti non sono compatibili.',unsampled_occurrences:'Alcune occorrenze non sono state esaminate.'};
const memberKey=member=>[member.item_id,member.basis_kind,member.basis_id].join('|');
const unique=values=>[...new Set(values)];
function append(parent,...children){for(const child of children)parent.append(child);return parent;}
function check(label,checked,disabled,changed,focusKey){const wrapper=node('label'),input=node('input');input.type='checkbox';if(focusKey)input.dataset.proposalFocus=focusKey;input.checked=checked;input.disabled=disabled;input.addEventListener('change',()=>changed(input));append(wrapper,input,node('span',label));return wrapper;}
export function createProposals(host){
  const intents=new Map();let state,disposed=false;
  function actionButton(label,action,disabled=false,focusKey=label){const control=makeButton(label,action,disabled);control.dataset.proposalFocus=focusKey;return control;}
  function focusControl(key){if(!key)return;for(const control of host.root.querySelectorAll?.('[data-proposal-focus]') || [])if(control.dataset.proposalFocus===key && !control.disabled){control.focus();return;}host.root.tabIndex=-1;host.root.focus();}
  function materialized(s,key,kind='classification'){return s.data?.materializations?.find(row=>row.local_key===key && row.kind===kind);}
  const decisionLabel=row=>({proposed:'Già aggiunta, da controllare sulla scheda.',confirmed:'Già confermata sulla scheda: la decisione resta conservata.',rejected:'Già rifiutata sulla scheda: la decisione resta conservata.',ignored:'Già ignorata sulla scheda: la decisione resta conservata.',stale:'Già aggiunta: i passaggi devono essere ricontrollati.',unverified:'Ipotesi già aggiunta come non verificata.',verified:'Ipotesi già verificata sulla scheda.',removed:'La decisione aggiunta è stata rimossa. Per una nuova scelta usa i controlli della scheda.'}[row?.state] || 'Già presente sulla scheda; nessuna nuova aggiunta automatica.');

  const plan=()=>{const value=host.planState?.();return value?.plan || (value?.plan_id?value:null);};
  const scope=()=>[host.workspace()?.id,plan()?.plan_id,plan()?.version].join('|');
  const current=s=>!disposed && state===s && scope()===s.scope;
  const writable=s=>current(s) && host.canEdit() && !s.busy && !s.locked && !host.inputDirty();
  function initialize(){return {scope:scope(),workspace:host.workspace()?.id,plan:plan(),item:host.draft()?.item,mode:'card',sequence:0,busy:false,locked:false,message:'',jobs:[],links:[],linkNext:null,linkTotal:0,manifestOffset:0,manifestTotal:0,manifestNext:null,job:null,data:null,offset:0,proposalNext:null,hypothesisNext:null,selected:new Set(),hypotheses:new Set(),supportCache:new Map(),supportView:null,memberView:null,membersSelected:new Map(),memberDetails:new Map()};}
  function synchronize(){
    if(!state || state.scope!==scope())state=initialize();
    const item=host.draft()?.item;
    if(state.item!==item){state.item=item;if(state.mode==='card'){state.sequence++;state.busy=false;state.jobs=[];state.links=[];state.linkNext=null;clearJob(state);}}
    return state;
  }
  function clearJob(s){s.job=null;s.data=null;s.offset=0;s.selected.clear();s.hypotheses.clear();s.supportCache.clear();s.supportView=null;s.memberView=null;s.membersSelected.clear();s.memberDetails.clear();}
  function failure(s,error){if([401,403,404].includes(error.status))s.locked=true;s.message=error.status===409?'La scheda o i passaggi sono cambiati. Controlla il confronto con la versione attuale prima di una nuova selezione.':error.status===403 || error.status===404?'Questi esiti non sono più disponibili con le autorizzazioni attuali.':'Lettura o operazione non confermata. Puoi riprovare esplicitamente.';if(current(s))host.error?.(error);}
  async function guarded(action){
    const s=synchronize();if(!s.workspace || s.busy || !current(s))return;
    const sequence=s.sequence,focus=document.activeElement?.dataset?.proposalFocus;s.busy=true;render();
    try{await action(s,()=>current(s) && s.sequence===sequence);}
    catch(error){if(current(s) && s.sequence===sequence)failure(s,error);}
    finally{if(current(s) && s.sequence===sequence){s.busy=false;render(focus);}}
  }
  const base=s=>'/preparazioni/'+s.workspace;
  const jobPath=(s,job=s.job)=>base(s)+'/lavori/'+job+'/proposte';
  function pendingFor(s){return [...intents.values()].filter(intent=>intent.workspace===s.workspace && intent.item===s.item);}
  async function loadCardJobs(){return guarded(async(s,valid)=>{
    if(!s.item || !s.plan)return;s.mode='card';s.jobs=[];s.links=[];clearJob(s);
    const page=await host.recordResults(s.item,0);if(!valid())return;
    s.locked=false;s.links=page?.results || [];s.linkNext=page?.next_result_offset;s.linkTotal=page?.total_results || 0;
    s.jobs=unique(s.links.map(link=>link.job_id)).map(job_id=>({job_id}));s.message=s.jobs.length?'Scegli un’analisi: i risultati di richieste diverse restano separati.':'Nessun esito conservato per questa scheda nel piano. Controlla la copertura del piano.';
  });}
  async function moreCardJobs(){return guarded(async(s,valid)=>{
    if(s.linkNext==null)return;const page=await host.recordResults(s.item,s.linkNext);if(!valid())return;
    s.links.push(...(page.results || []));s.linkNext=page.next_result_offset;s.linkTotal=page.total_results;
    s.jobs=unique(s.links.map(link=>link.job_id)).map(job_id=>({job_id}));
  });}
  async function loadGroupJobs(offset=0){return guarded(async(s,valid)=>{
    if(!s.plan)return;if(s.mode!=='group'){s.mode='group';s.jobs=[];clearJob(s);}
    const page=await host.api(base(s)+'/piani/'+s.plan.plan_id+`?version=${s.plan.version}&offset=${offset}&limit=${PAGE}`);if(!valid())return;
    s.locked=false;s.manifestOffset=offset;s.manifestTotal=page.total_packets || 0;s.manifestNext=offset+(page.packets?.length || 0)<s.manifestTotal?offset+(page.packets?.length || 0):null;
    s.jobs=(page.packets || []).filter(packet=>packet.task==='group_labels').map(packet=>({...page.packet_jobs?.find(job=>job.packet_id===packet.packet_id),packet_id:packet.packet_id}));
    s.message=s.jobs.length?'Scegli un confronto conservato. La copertura delle schede non dimostra tutti i confronti possibili.':'Nessun confronto in questa pagina di richieste. Controlla le pagine successive o la copertura del piano.';
  });}
  async function openJob(job,offset=0){return guarded(async(s,valid)=>{
    const item=s.mode==='card'?s.item:null;
    if(s.job!==job){clearJob(s);s.job=job;}
    const data=await host.api(jobPath(s,job)+`?${item?'item='+encodeURIComponent(item)+'&':''}offset=${offset}&limit=${PAGE}`);if(!valid())return;
    if(data.task!==(s.mode==='card'?'classify_cards':'group_labels'))throw new Error('unexpected_result_profile');
    s.locked=false;s.data=data;for(const row of data.materializations || []){if(row.kind==='classification')s.selected.delete(row.local_key);else if(row.kind==='hypothesis')s.hypotheses.delete(row.local_key);}s.offset=offset;s.proposalNext=data.next_offset;s.hypothesisNext=data.next_hypothesis_offset;
    for(const support of data.supports || [])s.supportCache.set(support.support_key,support);
    s.message='';
  });}
  function renderSupport(root,support,cited=true){
    const metadata=support.origin==='source_metadata';
    const detail=node('div',undefined,metadata?'desk-notice':'');
    append(detail,node('strong',metadata?'Contesto della fonte, non prova di una categoria':cited?'Passaggio originale citato':'Altro contesto della scheda'),node('blockquote',support.quote || support.text || '', 'preparation-source-passage'));
    root.append(detail);
  }
  function referencedKeys(s,proposal){const basis=s.data?.bases?.find(item=>item.basis_key===proposal.basis_key);return unique([...(basis?.support_keys || []),...(proposal.support_keys || []),...(proposal.choices || []).flatMap(choice=>choice.support_keys || [])]);}
  async function readSupports(proposal=null,offset=0){return guarded(async(s,valid)=>{
    if(!s.job)return;const key=proposal?.proposal_key ?? null;
    const page=await host.api(jobPath(s)+'/passaggi',{item_id:s.mode==='card'?s.item:null,proposal_key:key,offset,limit:PAGE});if(!valid())return;
    for(const support of page.supports || [])s.supportCache.set(support.support_key,support);
    s.supportView={...page,offset,proposal};
  });}
  function choiceEntries(s,proposal){return (proposal.choices || []).map(choice=>({choice,entry:s.data.catalog_choices?.find(entry=>entry.candidate_key===choice.candidate_key)}));}
  function selectable(s,proposal){return !materialized(s,proposal.proposal_key) && proposal.state==='proposed' && proposal.choices?.length>0 && choiceEntries(s,proposal).every(item=>item.entry?.label && item.entry?.target) && referencedKeys(s,proposal).every(key=>s.supportCache.has(key));}
  function selectKey(s,set,key,input){if(input.checked && set.size>=MAX_SELECTION && !set.has(key)){input.checked=false;s.message='Puoi aggiungere al massimo 100 proposte per azione. Nessuna selezione è stata tagliata.';render();return;}if(input.checked)set.add(key);else set.delete(key);render();}
  function renderProposal(s,proposal,index){
    const row=node('section',undefined,'desk-card'),basis=s.data.bases?.find(item=>item.basis_key===proposal.basis_key);
    row.append(node('h4',s.mode==='group'?'Confronto '+(s.offset+index+1):basis?.kind==='category_label'?'Proposta da etichetta originale':'Interpretazione da descrizione'));
    if(s.mode==='card')row.append(node('p',interpretationText.aiProposed,'hint'));
    if(basis?.value)row.append(node('blockquote',basis.value,'preparation-source-passage'));
    if(s.mode==='card'){
      const useful=selectable(s,proposal);
      row.append(check('Aggiungi questa proposta e le sue alternative, da controllare',s.selected.has(proposal.proposal_key),!writable(s) || !useful,input=>selectKey(s,s.selected,proposal.proposal_key,input),'proposal:'+proposal.proposal_key));
      const existing=materialized(s,proposal.proposal_key);if(existing)row.append(node('p',decisionLabel(existing),'desk-notice'));
      if(proposal.state==='no_supplied_match')row.append(node('p','Nessuna corrispondenza tra i termini forniti. Questo non esclude altre categorie EGI.'));
      else if(proposal.state==='insufficient_context')row.append(node('p','Il contesto non basta per proporre una categoria.'));
      for(const code of proposal.missing_context || [])row.append(node('p',missing[code] || (String(code).includes('_')?'Informazioni aggiuntive da verificare.':code),'hint'));
    }else{
      append(row,node('p',relations[proposal.relation] || relations.ambiguous),node('p',proposal.reason || ''));
      for(const issue of proposal.membership_issues || [])row.append(node('p',missing[issue.reason] || 'Appartenenza da verificare.','desk-notice'));
    }
    const choices=node('ul');for(const {choice,entry} of choiceEntries(s,proposal)){const item=node('li');append(item,node('strong',entry?.label || 'Termine del catalogo non disponibile'),node('p',choice.reason || ''));choices.append(item);}row.append(choices);
    const refs=referencedKeys(s,proposal),quotes=node('details');quotes.append(node('summary','Passaggi citati e contesto'));
    for(const key of refs){const support=s.supportCache.get(key);if(support)renderSupport(quotes,support);}
    if(refs.some(key=>!s.supportCache.has(key)))quotes.append(node('p','Alcuni passaggi citati non sono ancora visibili. Leggi le pagine del contesto prima di selezionare la proposta.','desk-notice'));
    quotes.append(actionButton('Leggi contesto e passaggi',()=>readSupports(proposal),s.busy,'supports:'+proposal.proposal_key));row.append(quotes);
    if(s.mode==='group')row.append(actionButton('Esamina le schede di questo confronto',()=>openMembers(proposal),s.busy,'members:'+proposal.proposal_key));
    return row;
  }
  async function openMembers(proposal,offset=0){return guarded(async(s,valid)=>{
    const page=await host.api(jobPath(s)+'/elementi',{proposal_key:proposal.proposal_key,offset,limit:PAGE});if(!valid())return;
    if(s.memberView?.proposal.proposal_key!==proposal.proposal_key){s.membersSelected.clear();s.memberDetails.clear();}
    if(new Set((page.members || []).map(memberKey)).size!==page.members.length)throw new Error('duplicate_member');
    for(const detail of page.details || [])s.memberDetails.set(memberKey(detail.member),detail);
    s.memberView={...page,offset,proposal};
  });}
  function selectMemberPage(s){const page=s.memberView;if(!page)return;const additions=page.members.filter(member=>!s.membersSelected.has(memberKey(member)) && s.memberDetails.has(memberKey(member)));if(s.membersSelected.size+additions.length>MAX_MEMBERS){s.message='Un gruppo può contenere al massimo 1000 membri scelti esplicitamente. Questa pagina non è stata aggiunta.';render();return;}for(const member of additions)s.membersSelected.set(memberKey(member),member);render();}
  async function prepareGroup(){return guarded(async(s,valid)=>{
    const view=s.memberView;if(!view || !s.membersSelected.size || !host.prepareGroup || !host.canEdit() || host.inputDirty())return;
    const context=s.data.context;
    const dto={proposal_id:s.data.packet_id+':'+view.proposal.proposal_key,context:{territory_id:context.scope.territory_id,axis_id:context.scope.axis_id,catalog_digest:context.catalog_snapshot.digest,as_of:context.as_of},
      members:[...s.membersSelected.values()],details:[...s.membersSelected.keys()].map(key=>s.memberDetails.get(key)),total_members:view.total_members,
      choices:choiceEntries(s,view.proposal).filter(item=>item.entry).map(item=>item.entry),relation:view.proposal.relation,membership_issues:view.proposal.membership_issues || [],reason:view.proposal.reason};
    const accepted=await host.prepareGroup(dto);if(valid())s.message=accepted===true?'Selezione preparata nei gruppi. Non è stata salvata né applicata automaticamente.':'Il gruppo non è ancora pronto: controlla la sezione gruppi.';
  });}
  function intentKey(s,kind){return [s.workspace,s.item,s.job,kind].join('|');}
  async function writeSelection(kind,intent=null){
    const s=synchronize();if(!writable(s) || !s.item || !s.job && !intent)return;
    if(!intent && pendingFor(s).length){s.message='Prima riconcilia l’aggiunta precedente non confermata.';render();return;}
    const sequence=s.sequence;s.busy=true;render();
    try{
      if(!intent){
        const keys=[...(kind==='proposals'?s.selected:s.hypotheses)];if(!keys.length)return;
        if(await host.flush()===false || !current(s) || s.sequence!==sequence || host.inputDirty() || host.draft()?.conflicted || host.draft()?.item!==s.item)return;
        const item=host.draft();intent={workspace:s.workspace,item:item.item,job:s.job,kind,path:base(s)+'/lavori/'+s.job+'/schede/'+item.item+(kind==='proposals'?'/proposte':'/ipotesi'),
          body:{expected_version:item.version,[kind==='proposals'?'proposal_keys':'hypothesis_keys']:keys,request_key:crypto.randomUUID()}};
        intents.set(intentKey(s,kind),intent);
      }
      const receipt=await host.api(intent.path,intent.body);
      for(const [key,value]of intents)if(value===intent)intents.delete(key);
      if(current(s) && s.sequence===sequence){s.selected.clear();s.hypotheses.clear();s.message=kind==='proposals'?'Proposte aggiunte come decisioni da controllare. Nessuna categoria è stata confermata.':'Ipotesi aggiunte come non verificate. Non dimostrano una categoria.';}
      // The known write is never reclassified as uncertain if its refresh fails.
      try{await host.refreshItem(receipt,intent.workspace);if(current(s) && s.sequence===sequence && s.job===intent.job){const updated=await host.api(jobPath(s)+`?item=${encodeURIComponent(intent.item)}&offset=${s.offset}&limit=${PAGE}`);if(current(s) && s.sequence===sequence){s.data=updated;for(const support of updated.supports || [])s.supportCache.set(support.support_key,support);}}}catch(error){if(current(s)){s.message='La selezione è conservata. Aggiorna la scheda: le modifiche locali restano da riconciliare.';host.error?.(error);}}
    }catch(error){
      if(error.status>=400 && error.status<500){for(const [key,value]of intents)if(value===intent)intents.delete(key);if(current(s))failure(s,error);}
      else if(current(s))s.message='L’aggiunta non è confermata. Ripeti esplicitamente la richiesta conservata per verificarne l’esito; non viene inviata automaticamente.';
    }finally{if(current(s) && s.sequence===sequence){s.busy=false;render();}}
  }
  function render(preferredFocus){
    if(disposed)return;const s=synchronize(),root=host.root,active=document.activeElement;
    const focused=active && root.contains(active)?active.dataset?.proposalFocus:(!active || active===document.body?preferredFocus:null);root.replaceChildren();root.setAttribute('aria-busy',String(s.busy));
    if(!s.workspace)return;
    append(root,node('h2','Proposte da controllare'),node('p','Le alternative aggiunte restano da confermare sulla scheda. Le ipotesi sulle sigle restano non verificate. Nessun esito conferma automaticamente una categoria.'));
    if(!s.plan){root.append(node('p','Seleziona un piano per leggerne gli esiti conservati.'));return;}
    append(root,actionButton('Leggi le analisi della scheda',()=>loadCardJobs(),s.busy || !s.item),actionButton('Leggi i confronti del piano',()=>loadGroupJobs(),s.busy));
    const status=node('p',s.message,'desk-notice');status.setAttribute('role','status');status.setAttribute('aria-live','polite');root.append(status);
    for(const intent of pendingFor(s)){root.append(node('p','Un’aggiunta precedente a questa scheda ha esito non confermato.'));root.append(actionButton('Ripeti la richiesta conservata',()=>writeSelection(intent.kind,intent),!writable(s)));}
    if(s.mode==='card' && s.links.length)root.append(node('p',`${s.links.length} esiti letti su ${s.linkTotal}; richieste diverse sono mostrate separatamente.`));
    if(s.mode==='group')root.append(node('p',`Pagina delle richieste: ${s.manifestOffset+1}–${Math.min(s.manifestOffset+PAGE,s.manifestTotal)} su ${s.manifestTotal}. Il confronto non dimostra tutte le coppie possibili.`));
    for(const [index,job]of s.jobs.entries()){
      const links=s.links.filter(link=>link.job_id===job.job_id),partial=links.some(link=>link.unprocessed_basis_keys?.length),abstained=links.some(link=>link.state==='insufficient_context');
      const title=s.mode==='card'?`Analisi ${index+1} · ${partial?'esiti parziali':abstained?'astensione':'esiti disponibili'}`:`Confronto ${index+1} · ${['succeeded','failed'].includes(job.state)?'esiti da controllare':'non ancora disponibile'}`;
      root.append(actionButton(title,()=>openJob(job.job_id),s.busy || !job.job_id || s.mode==='group' && !['succeeded','failed'].includes(job.state)));
    }
    if(s.mode==='card' && s.linkNext!=null)root.append(actionButton('Altri esiti della scheda',()=>moreCardJobs(),s.busy));
    if(s.mode==='group' && s.manifestNext!=null)root.append(actionButton('Altre richieste del piano',()=>loadGroupJobs(s.manifestNext),s.busy));
    if(s.data){
      root.append(node('h3',s.mode==='card'?'Alternative della richiesta selezionata':'Confronti della richiesta selezionata'));
      root.append(node('p',`${s.data.proposals?.length?s.offset+1:0}–${s.offset+(s.data.proposals?.length || 0)} proposte visualizzate su ${s.data.total_proposals || 0}.`));
      for(const [index,proposal]of (s.data.proposals || []).entries())root.append(renderProposal(s,proposal,index));
      if(s.mode==='card'){
        root.append(node('p',`${s.selected.size} proposte scelte, massimo 100. Saranno aggiunte le alternative, senza confermarle.`));
        root.append(actionButton('Aggiungi le proposte scelte, da controllare',()=>writeSelection('proposals'),!writable(s) || !s.selected.size || pendingFor(s).length>0));
        root.append(node('h3','Ipotesi da verificare separatamente'));
        for(const hypothesis of s.data.hypotheses || []){const row=node('div');append(row,check('Conserva questa ipotesi come non verificata',s.hypotheses.has(hypothesis.hypothesis_key),!writable(s) || !!materialized(s,hypothesis.hypothesis_key,'hypothesis'),input=>selectKey(s,s.hypotheses,hypothesis.hypothesis_key,input),'hypothesis:'+hypothesis.hypothesis_key),node('p',interpretationText.aiUnverified,'hint'),node('p',hypothesis.statement),node('p','Il passaggio attiva l’ipotesi, ma non ne verifica il significato e non giustifica una categoria.','hint'));const existing=materialized(s,hypothesis.hypothesis_key,'hypothesis');if(existing)row.append(node('p',decisionLabel(existing),'desk-notice'));root.append(row);}
        root.append(node('p',`${s.hypotheses.size} ipotesi scelte; ${s.data.hypotheses?.length || 0} visualizzate su ${s.data.total_hypotheses || 0}.`));
        append(root,actionButton('Leggi i passaggi delle ipotesi',()=>readSupports(),s.busy),actionButton('Aggiungi le ipotesi come non verificate',()=>writeSelection('hypotheses'),!writable(s) || !s.hypotheses.size || pendingFor(s).length>0));
      }
      const next=[s.proposalNext,s.hypothesisNext].filter(value=>value!=null);if(next.length)root.append(actionButton('Proposte e ipotesi successive',()=>openJob(s.job,Math.min(...next)),s.busy));
    }
    if(s.supportView){const section=node('details');section.open=true;append(section,node('summary','Passaggi e contesto della selezione'),node('p',`${s.supportView.supports.length?s.supportView.offset+1:0}–${s.supportView.offset+s.supportView.supports.length} passaggi mostrati su ${s.supportView.total_supports}. Non vengono considerate esaminate le altre pagine.`));const refs=s.supportView.proposal?referencedKeys(s,s.supportView.proposal):[];for(const support of s.supportView.supports)renderSupport(section,support,refs.includes(support.support_key));if(s.supportView.next_offset!=null)section.append(actionButton('Altri passaggi e contesto',()=>readSupports(s.supportView.proposal,s.supportView.next_offset),s.busy));root.append(section);}
    if(s.memberView){const view=s.memberView,section=node('section');append(section,node('h3','Schede del confronto da scegliere'),node('p',`${s.membersSelected.size} membri scelti su ${view.total_members}; questa pagina ne mostra ${view.members.length}. Occorrenze non risolte: ${view.unresolved_occurrences || 0}.`));
      for(const member of view.members){const detail=s.memberDetails.get(memberKey(member)),row=node('div');row.append(check((detail?.name || 'Scheda')+' · '+(member.basis_kind==='interpreted_classification'?'Interpretazione da descrizione':'Etichetta originale'),s.membersSelected.has(memberKey(member)),!writable(s) || !detail,input=>{if(input.checked && s.membersSelected.size>=MAX_MEMBERS){input.checked=false;s.message='Massimo 1000 membri scelti: nessun membro è stato aggiunto automaticamente.';}else if(input.checked)s.membersSelected.set(memberKey(member),member);else s.membersSelected.delete(memberKey(member));render();},'member:'+memberKey(member)));if(detail?.label)row.append(node('p',detail.label));if(detail?.original?.value)row.append(node('blockquote',detail.original.value,'preparation-source-passage'));section.append(row);}
      append(section,actionButton('Seleziona i membri di questa pagina',()=>selectMemberPage(s),!writable(s)),actionButton('Prepara un gruppo proposto dai membri scelti',()=>prepareGroup(),!writable(s) || !s.membersSelected.size));
      if(view.next_offset!=null)section.append(actionButton('Altri membri del confronto',()=>openMembers(view.proposal,view.next_offset),s.busy));root.append(section);
    }
    focusControl(focused);
  }
  return {render,cardChanged:render,planChanged(){if(!state || state.scope!==scope())render();},dispose(){disposed=true;state=null;host.root.replaceChildren();}};
}
