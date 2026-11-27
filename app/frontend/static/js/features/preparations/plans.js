/** One explicit bounded category plan over the existing private preparation/draft. */
import {node,button} from './fields.js';
const PAGE=50, MAX_SELECTION=100;
const states={planned:'Anteprima da avviare',running:'Analisi in corso',queued:'In attesa',leased:'Richiesta assegnata',succeeded:'Esito ricevuto',failed:'Esito incompleto o non valido',pending:'Da analizzare',validated:'Analisi disponibile',insufficient_context:'Astensione: contesto insufficiente',partial:'Analisi parziale',ineligible:'Dati non utilizzabili',invalid_result:'Risposta non valida',refused:'Richiesta rifiutata',uncertain:'Esito incerto',cancelled:'Annullata',stale:'Da aggiornare',waiting_budget:'In attesa del budget',waiting_retry:'Verifica un esito incerto',finished:'Analisi conclusa',finished_with_gaps:'Conclusa con elementi da controllare',awaiting_materialization:'Proposte da scegliere e aggiungere alla scheda prima del confronto',abstained:'Nessuna proposta confrontabile',complete:'Esiti del confronto disponibili',completed:'Esiti del confronto disponibili',not_declared:'Nessun confronto dichiarato',compared:'Esito del confronto disponibile',awaiting_comparison:'Confronto da eseguire',awaiting_new_preview:'Proposte aggiunte alla scheda: crea una nuova anteprima',awaiting_analysis:'Confronto in attesa dell’analisi'};
const tasks={classify_cards:'Analisi delle schede',group_labels:'Confronto delle categorie'};
const limitations={insufficient_context:'Alcuni confronti si sono astenuti: il contesto non basta per una proposta.',incomplete_units:'Restano unità da confrontare o proposte da scegliere e aggiungere alle schede.',incomplete_catalog:'Il catalogo fornito è parziale: possono esistere altri termini EGI.',unsampled_occurrences:'Sono state fornite solo alcune occorrenze: il confronto non vale per quelle non esaminate.',omitted_scope:'Alcuni ambiti sono rimasti fuori dal confronto.',omitted_units:'Alcune unità non sono state confrontate.',mixed_context:'Alcuni contesti non sono compatibili: controlla appartenenza e ambito.',unknown_context:'Il contesto di alcune unità non è ancora risolto.'};
const waitReasons={waiting_budget:'Budget disponibile insufficiente. Riprendi esplicitamente quando disponibile, entro i limiti del piano.',budget_exceeded:'Budget disponibile insufficiente. Riprendi esplicitamente quando disponibile, entro i limiti del piano.',configuration_changed:'La configurazione autorizzata è cambiata: crea una nuova anteprima.',configuration_unavailable:'La configurazione autorizzata non è disponibile: attendi una configurazione verificata e crea una nuova anteprima.',configuration_disabled:'La configurazione autorizzata non è attiva.',ai_not_configured:'Non è disponibile una configurazione verificata.',access_or_input_changed:'La fonte o le autorizzazioni sono cambiate: controlla la selezione prima di proseguire.',stale_item:'La scheda è cambiata: crea una nuova anteprima.',invalid_or_incomplete_output:'La risposta non copre tutti i passaggi richiesti.'};

const money=value=>new Intl.NumberFormat('it-IT',{style:'currency',currency:'USD',maximumFractionDigits:6}).format(Number(value || 0)/1000000);
const labelState=value=>states[value] || 'Da controllare';
export function createPlans(host) {
  const $=id=>document.getElementById(id), listeners=new Set(), selected=new Set(), checkboxes=new Map(), attempts=new Map();
  let workspaceId, generation=0,readSequence=0,selectionRevision=0, plan=null, coverage=null, busy=false, locked=false, timer;
  let packetOffset=0,recordOffset=0,eventAfter=0,nextEvent=null,events=[],restoring=false,latestPlan=null,previousPlan=null;
  const writable=()=>!locked && host.canEdit();
  const localDirty=()=>host.inputDirty() || !!host.draft()?.dirty || !!host.draft()?.conflicted;
  const sameSelection=()=>!!plan && selected.size===plan.selection?.length && plan.selection.every(item=>selected.has(item.record_key));
  const localStale=()=>!!plan && (host.workspace()?.current_input_id!==plan.input_id || plan.selection?.some(item=>item.record_key===host.draft()?.item && item.item_version!==host.draft()?.version));
  const sameLimits=()=>!plan || Number($('plan-max-requests').value)===plan.followup_limits?.max_total_packets && Number($('plan-max-followups').value)===plan.followup_limits?.max_followup_packets && Math.round(Number($('plan-max-cost').value)*1000000)===plan.followup_limits?.max_reserved_micro_usd;
  function restoreLimits(){if(!plan)return;$('plan-max-requests').value=plan.followup_limits.max_total_packets;$('plan-max-followups').value=plan.followup_limits.max_followup_packets;$('plan-max-cost').value=Number(plan.followup_limits.max_reserved_micro_usd)/1000000;}
  const path=()=>'/preparazioni/'+workspaceId+'/piani/'+plan.plan_id;
  const current=ticket=>ticket===generation && workspaceId===host.workspace()?.id;
  function notify() {for(const listener of listeners)listener({plan,coverage,workspaceId});}
  function message(value) {$('plan-feedback').textContent=value;}
  function fail(error) {
    clearTimeout(timer);
    if([401,403,404].includes(error.status))locked=true;
    message(error.status===401?'Sessione scaduta. Accedi nuovamente; le modifiche locali sono conservate.':error.status===403?'Accesso al piano non più disponibile. Le modifiche locali sono conservate.':error.status===409?'Il piano o le schede sono cambiati. Crea una nuova anteprima prima di proseguire.':error.message?.includes('decomposition')?'Questi dati superano i limiti di una richiesta: riduci o separa esplicitamente la selezione.':error.message?.includes('bounds') || error.message?.includes('limit')?'La selezione supera i limiti dichiarati. Rivedi selezione, richieste o costo massimo.':error.status===503?'Analisi non disponibile. Nessuna nuova autorizzazione è stata aggiunta.':'Operazione non confermata. Aggiorna lo stato o ripeti esplicitamente la stessa azione.');
    if([401,403,404].includes(error.status))host.error(error);
  }
  function syncCheckboxes() {for(const [id,input] of checkboxes){input.checked=selected.has(id);input.disabled=busy || !writable();}}
  function renderControls() {
    $('plan-panel').hidden=!host.workspace();$('plan-panel').setAttribute('aria-busy',String(busy));
    $('plan-selection-count').textContent=`${selected.size} schede selezionate · massimo ${MAX_SELECTION}`;
    const hasPlan=!!plan, dirty=localDirty(), stale=localStale() || (coverage?.record_coverage?.stale_records || 0)>0;
    $('plan-preview').disabled=!writable() || busy || !selected.size || host.inputDirty();
    $('plan-amend').hidden=!hasPlan; $('plan-amend').disabled=$('plan-preview').disabled;
    $('plan-start').hidden=!hasPlan || !!plan.events?.some(event=>event.kind==='started') || coverage?.progress && coverage.progress!=='planned';
    $('plan-start').disabled=!coverage || !writable() || busy || dirty || stale || !sameSelection() || !sameLimits();
    $('plan-continue').hidden=!hasPlan || !['finished_with_gaps','waiting_budget','waiting_retry'].includes(coverage?.progress);
    $('plan-continue').disabled=!writable() || busy || dirty || stale || coverage?.progress==='waiting_retry';
    $('plan-cancel').hidden=!hasPlan || !coverage || ['finished','cancelled'].includes(coverage?.progress) || coverage?.progress==='planned';
    $('plan-cancel').disabled=!writable() || busy;
    $('plan-refresh').disabled=!hasPlan || busy;
    $('plan-clear-selection').disabled=!selected.size || busy;
    const items=host.workspace()?.items || [];
    $('plan-select-all').disabled=!writable() || busy || !items.length || items.length>MAX_SELECTION;
    $('plan-selection-note').textContent=host.inputDirty()?'Salva o ripristina il materiale originale prima di creare o avviare un piano.':dirty?'Le modifiche locali sono conservate: prima di procedere devono essere salvate.':stale?'La selezione congelata è diventata obsoleta: crea una nuova anteprima.':hasPlan && (!sameSelection() || !sameLimits())?'La selezione o i limiti sono cambiati. La vecchia anteprima resta conservata: creane una nuova.':items.length>MAX_SELECTION?'Seleziona esplicitamente fino a 100 schede. Non viene esclusa automaticamente nessuna scheda.':'';
    for(const id of ['plan-max-requests','plan-max-followups','plan-max-cost'])$(id).disabled=busy || !writable();
    syncCheckboxes();
  }
  function termContext() {
    const scope=plan.shared_context?.scope || {}, refs=host.context.references || {};
    const territory=refs.territories?.find(item=>item.territory_id===scope.territory_id);
    const term=refs.classifications?.find(item=>item.axis_id===scope.axis_id && (!item.territory_id || item.territory_id===scope.territory_id));
    return [territory?.name || territory?.label || 'Territorio del catalogo selezionato',term?.axis_label || term?.axis_name || 'Asse del catalogo selezionato'].join(' · ');
  }
  function renderPlan() {
    const root=$('plan-summary');root.replaceChildren();
    if(!plan){root.append(node('p','Seleziona le schede e controlla un’anteprima. Nessuna richiesta parte automaticamente.'));return;}
    root.append(node('h3',labelState(coverage?.progress || 'planned')));
    root.append(node('p',`${plan.selection?.length || 0} schede nella selezione congelata · ${termContext()}`));
    root.append(node('p',(plan.shared_context?.source_metadata || []).map(source=>source.name).filter(Boolean).join(' · ')));
    const config=plan.configuration || {}, limits=plan.followup_limits || {};
    root.append(node('p',`Modello: ${config.model || 'configurazione verificata sul server'}. Richieste previste: ${plan.planned_request_count ?? plan.total_packets}; iniziali: ${plan.initial_packet_ids?.length || 0}; massimo dichiarato: ${limits.max_total_packets}.`));
    root.append(node('p',`Costo massimo delle richieste previste: ${money(plan.ceiling_micro_usd)}. Limite autorizzato del piano: ${money(limits.max_reserved_micro_usd)}. Ulteriori richieste ammesse: ${limits.max_followup_packets || 0}.`));
    root.append(node('p',(plan.stage_policy?.tasks || []).map(task=>tasks[task] || 'Analisi dichiarata').join(' → ')+'; il confronto attende gli esiti delle schede.'));
    const catalog=plan.catalog_coverage;
    if(catalog?.complete===true)root.append(node('p',`Catalogo EGI completo per questo contesto: ${catalog.supplied_terms} termini forniti.`));
    else if(catalog?.complete===false)root.append(node('p',`Catalogo EGI parziale: ${catalog.supplied_terms} termini forniti; il totale e il numero di omissioni non sono determinati.`,'desk-notice'));
    else root.append(node('p','La copertura del catalogo EGI non è disponibile: non viene considerata completa.','hint'));
    const inventory=plan.shared_context?.inventory_coverage;
    if(inventory)root.append(node('p',`Inventario contestuale: ${inventory.supplied_labels} etichette o descrizioni fornite su ${inventory.total_labels}; ${inventory.omitted_labels} omesse.`));
    const blocked=(plan.events || []).filter(event=>event.kind==='blocked');
    if(blocked.length)root.append(node('p',`${blocked.length} segnalazioni di controllo negli eventi mostrati. Controlla separatamente gli esiti delle schede e dei confronti.`,'desk-notice'));
    const details=node('details'),summary=node('summary','Selezione congelata e condizioni');details.append(summary);
    const list=node('ul');for(const member of plan.selection || []){const card=host.workspace()?.items?.find(item=>item.item_id===member.record_key);list.append(node('li',card?.display_name || 'Scheda della selezione'));}details.append(list);
    details.append(node('p','Sono forniti passaggi originali delle schede, metadati della fonte e termini EGI del contesto. I metadati aiutano l’interpretazione, senza provare una categoria.'));
    details.append(node('p',`Limite per richiesta: ${config.max_input_tokens || '—'} token in ingresso e ${config.max_output_tokens || '—'} in uscita.`));
    if(config.price_reference)details.append(node('p',`Riferimento prezzi: ${config.price_reference}`));
    details.append(node('p','L’annullamento interrompe il lavoro rimanente: non cancella eventuali costi già maturati o incerti.'));
    details.append(node('p','Le proposte restano da controllare. L’anteprima non autorizza chiamate aggiuntive né modifica le schede.'));
    const prior=previousPlan || (plan.events || []).concat(events).map(event=>event.body).find(body=>body?.operation==='amended_from');
    if(prior)details.append(button('Mostra il piano precedente',()=>viewPlan(prior.plan_id,prior.plan_version || prior.version)));
    if(latestPlan && latestPlan.plan_id!==plan.plan_id)details.append(button('Torna al piano più recente',()=>viewPlan(latestPlan.plan_id,latestPlan.version)));
    root.append(details);
  }
  function renderCoverage() {
    const root=$('plan-coverage');root.replaceChildren();
    if(!coverage){$('plan-records').replaceChildren();$('plan-record-page').textContent='';$('plan-record-prev').disabled=true;$('plan-record-next').disabled=true;return;}
    const records=coverage.record_coverage || {}, comparison=coverage.comparison_coverage || {};
    root.append(node('h3','Analisi delle schede'));
    root.append(node('p',`${records.validated_records || 0} analisi disponibili; ${records.insufficient_context_records || 0} astensioni; ${records.partial_records || 0} parziali; ${records.pending_records || 0} in attesa; ${records.blocked_records || 0} bloccate; ${records.stale_records || 0} da aggiornare. Totale selezionato: ${records.selected_records || 0}.`));
    root.append(node('h3','Confronto delle categorie'));
    root.append(node('p',labelState(comparison.state || coverage.comparison_state || (coverage.awaiting_materialization_records?'awaiting_materialization':comparison.pending_scope_keys?.length?'pending':comparison.completed_scope_keys?.length?'complete':comparison.selected_unit_keys?.length?'awaiting_comparison':'not_declared'))));
    root.append(node('p',`${comparison.selected_unit_keys?.length || 0} etichette o interpretazioni incluse; ${comparison.completed_scope_keys?.length || 0} ambiti di confronto completati; ${comparison.pending_scope_keys?.length || 0} ancora da confrontare; ${comparison.omitted_unit_keys?.length || 0} unità omesse; ${comparison.reference_unit_keys?.length || 0} solo di riferimento.`));
    if(coverage.awaiting_materialization_records)root.append(node('p',`${coverage.awaiting_materialization_records} schede attendono la scelta esplicita delle proposte prima di una nuova anteprima.`));
    if(coverage.comparison_abstained_records)root.append(node('p',`${coverage.comparison_abstained_records} schede senza una proposta confrontabile: nessuna categoria è stata inventata.`));
    if(coverage.progress==='waiting_retry')root.append(node('p','Verifica le richieste con esito incerto nella sezione Richieste e dipendenze. Ogni nuovo tentativo richiede una scelta esplicita.','desk-notice'));
    if(coverage.progress==='waiting_budget')root.append(node('p','Il budget disponibile non basta. Puoi controllarlo e continuare esplicitamente entro i limiti già dichiarati.','desk-notice'));
    if(comparison.limitations?.length){const notes=node('ul',undefined,'desk-notice');notes.setAttribute('aria-label','Limiti dei confronti');for(const code of comparison.limitations)notes.append(node('li',limitations[code] || 'Alcuni ambiti richiedono un controllo prima di usare le proposte.'));root.append(notes);}
    const abstainedScopes=comparison.abstained_scope_count ?? coverage.comparison_abstained_scopes;
    if(Number.isInteger(abstainedScopes))root.append(node('p',`${abstainedScopes} ambiti di confronto si sono astenuti: non indicano gruppi equivalenti trovati.`));
    root.append(node('p','La copertura delle schede non dimostra che tutti i confronti siano conclusi. I riferimenti di contesto non contano come schede analizzate.','hint'));
    const list=$('plan-records');list.replaceChildren();
    for(const record of coverage.records || []){
      const row=node('li'), card=host.workspace()?.items?.find(item=>item.item_id===record.record_key);
      row.append(button(card?.display_name || 'Apri scheda',()=>host.openCard(record.record_key).catch(host.error)));
      row.append(node('p',`${labelState(record.state)} · ${record.processed_basis_keys?.length || 0} passaggi esaminati, ${record.unprocessed_basis_keys?.length || 0} ancora da verificare.`));
      if(record.reason)row.append(node('p',waitReasons[record.reason] || 'Controlla le condizioni di questa scheda prima di proseguire.','hint'));
      if(record.comparison_state)row.append(node('p','Confronto: '+labelState(record.comparison_state),'hint'));
      list.append(row);
    }
    $('plan-record-page').textContent=`Schede ${coverage.records?.length?recordOffset+1:0}–${recordOffset+(coverage.records?.length || 0)} di ${coverage.total_records || 0}`;
    $('plan-record-prev').disabled=busy || recordOffset===0; $('plan-record-next').disabled=busy || coverage.next_record_offset==null;
  }
  function renderPackets() {
    const root=$('plan-packets');root.replaceChildren();
    for(const manifest of plan?.packets || []){
      const row=node('li'),job=plan.packet_jobs?.find(item=>item.packet_id===manifest.packet_id);
      row.append(node('p',`${tasks[manifest.task] || 'Richiesta dichiarata'} · ${manifest.required_record_ids?.length || 0} schede principali, ${manifest.reference_record_ids?.length || 0} solo come contesto · ${job?.state?labelState(job.state):'Non ancora avviata'}`));
      row.append(node('p',`${manifest.required_unit_keys?.length || 0} unità richieste; ${manifest.predecessor_packet_ids?.length || 0} richieste precedenti necessarie.`,'hint'));
      if(job?.state==='uncertain'){
        const label=node('label'),check=node('input');check.type='checkbox';
        label.append(check);label.append(node('span','Ho verificato l’esito precedente. Un nuovo tentativo può avere un costo aggiuntivo; la vecchia riserva resta impegnata.'));
        const retry=button('Nuovo tentativo a pagamento',()=>retryUncertain(manifest.packet_id),true);
        check.addEventListener('change',()=>{retry.disabled=!check.checked || !writable() || busy || localDirty();});
        row.append(label);row.append(retry);
      }
      root.append(row);
    }
    $('plan-packet-page').textContent=`Richieste ${plan?.packets?.length?packetOffset+1:0}–${packetOffset+(plan?.packets?.length || 0)} di ${plan?.total_packets || 0}`;
    $('plan-packet-prev').disabled=busy || packetOffset===0; $('plan-packet-next').disabled=busy || !plan || packetOffset+(plan.packets?.length || 0)>=plan.total_packets;
  }
  function renderEvents() {
    const root=$('plan-events');root.replaceChildren();
    const labels={previewed:'Anteprima conservata',started:'Piano avviato esplicitamente',packet_queued:'Richiesta in coda',completed:'Esito conservato',blocked:'Elemento da controllare'};
    const reasons={awaiting_materialization:'Scegli e aggiungi le proposte alla scheda prima del confronto',waiting_budget:'Budget non disponibile',plan_cancelled:'Piano annullato',record_without_eligible_source_basis:'Manca un passaggio pubblico utilizzabile'};
    for(const event of events){root.append(node('li',`${labels[event.kind] || 'Aggiornamento del piano'}${event.body?.code?' · '+(reasons[event.body.code] || 'Controllo richiesto'):''}`));}
    $('plan-events-more').disabled=busy || !plan || nextEvent==null;
  }
  function render(){renderControls();renderPlan();renderCoverage();renderPackets();renderEvents();}
  function requestBody(kind,value) {
    const stable=JSON.stringify(value),previous=attempts.get(kind);
    if(previous?.stable===stable)return previous.body;
    const body={...value,request_key:crypto.randomUUID()};attempts.set(kind,{stable,body});return body;
  }
  async function barrier() {
    if(host.inputDirty()){message('Salva o ripristina il materiale originale prima di procedere.');return false;}
    try {if(!await host.flush() || host.draft()?.conflicted){message('Risolvi le modifiche della scheda prima di procedere.');return false;}
    return true;}catch(error){fail(error);renderControls();return false;}
  }
  async function refresh() {
    clearTimeout(timer);if(!plan || !workspaceId || locked)return;
    const ticket=generation,sequence=++readSequence,id=plan.plan_id,version=plan.version;
    try {
      const [next,outcomes]=await Promise.all([host.api(path()+`?version=${version}&offset=${packetOffset}&limit=${PAGE}`),host.api(path()+`/copertura?version=${version}&offset=${recordOffset}&limit=${PAGE}`)]);
      if(!current(ticket) || sequence!==readSequence || plan?.plan_id!==id)return;
      plan=next;coverage=outcomes;if(!eventAfter){events=plan.events || [];nextEvent=plan.next_event_id;}render();notify();
      if(['running','queued'].includes(coverage.progress) || plan.packet_jobs?.some(job=>['queued','leased','running'].includes(job.state)))timer=setTimeout(refresh,1500);
    } catch(error){if(current(ticket) && sequence===readSequence){fail(error);renderControls();}}
  }
  async function mutate(kind,url,value) {
    if(busy || !writable())return;
    const ticket=generation;readSequence++;busy=true;clearTimeout(timer);renderControls();
    try {
      const result=await host.api(url,requestBody(kind,value));
      if(!current(ticket))return;
      attempts.delete(kind);message('');
      if(kind==='preview' || kind==='amend'){previousPlan=kind==='amend'?{plan_id:plan.plan_id,plan_version:plan.version}:null;latestPlan={plan_id:result.plan_id,version:result.version};plan=result;coverage=null;packetOffset=0;recordOffset=0;eventAfter=0;nextEvent=plan.next_event_id;events=plan.events || [];restoreLimits();}
      await refresh();
    }catch(error){if(current(ticket)){if(error.status && error.status<500)attempts.delete(kind);fail(error);}}
    finally{if(current(ticket)){busy=false;render();notify();}}
  }
  async function preview(amend=false) {
    const ticket=generation;
    if(busy || !writable() || !selected.size || selected.size>MAX_SELECTION || !await barrier() || !current(ticket))return;
    const total=Number($('plan-max-requests').value),followups=Number($('plan-max-followups').value),cost=Number($('plan-max-cost').value);
    if(!Number.isInteger(total) || total<1 || total>1000 || !Number.isInteger(followups) || followups<0 || followups>=total || !Number.isFinite(cost) || cost<0.01 || cost>10){message('Indica limiti validi: richieste, richieste successive e costo massimo tra 0,01 e 10 USD.');return;}
    const body={item_ids:[...selected],configuration_version:null,limits:{max_total_packets:total,max_followup_packets:followups,max_reserved_micro_usd:Math.round(cost*1000000),allowed_followup_kinds:['remaining_record_analysis','cross_packet_comparison']}};
    if(amend && plan)body.version=plan.version;
    await mutate(amend?'amend':'preview',amend && plan?path()+'/modifica':'/preparazioni/'+workspaceId+'/piani/anteprima',body);
  }
  async function action(name) {
    const ticket=generation;
    if(!plan || busy || !writable())return;
    if(name!=='annulla' && (!await barrier() || !current(ticket) || localStale())){renderControls();return;}
    if(name==='avvia' && (!sameSelection() || !sameLimits())){message('La selezione o i limiti sono cambiati: crea una nuova anteprima.');return;}
    await mutate(name,path()+'/'+name,{version:plan.version});
  }
  async function retryUncertain(packet) {
    const ticket=generation;
    if(!plan || busy || !writable() || !await barrier() || !current(ticket))return;
    await mutate('retry:'+packet,'/preparazioni/'+workspaceId+'/pacchetti/'+packet+'/ripeti',{});
  }
  async function viewPlan(id,version) {
    if(busy || !workspaceId)return;
    const ticket=generation,sequence=++readSequence;busy=true;clearTimeout(timer);renderControls();
    try {const value=await host.api('/preparazioni/'+workspaceId+'/piani/'+id+`?version=${version}&offset=0&limit=${PAGE}`);
      if(!current(ticket) || sequence!==readSequence)return;
      plan=value;coverage=null;packetOffset=0;recordOffset=0;eventAfter=0;nextEvent=plan.next_event_id;events=plan.events || [];previousPlan=null;restoreLimits();await refresh();
    }catch(error){if(current(ticket))fail(error);}finally{if(current(ticket)){busy=false;render();}}
  }
  async function changePage(kind,offset) {
    if(busy || !plan)return;
    if(kind==='packet')packetOffset=offset;else recordOffset=offset;
    await refresh();
  }
  async function moreEvents() {
    if(!plan || busy)return;
    const ticket=generation,after=nextEvent;
    if(after==null)return;
    try {const result=await host.api(path()+`/eventi?version=${plan.version}&after=${after}&limit=${PAGE}`);if(!current(ticket))return;events=result.events || [];eventAfter=after;nextEvent=result.next_event_id;renderEvents();renderPlan();}
    catch(error){if(current(ticket)){fail(error);renderControls();}}
  }
  for(const id of ['plan-max-requests','plan-max-followups','plan-max-cost'])$(id).addEventListener('input',renderControls);
  $('plan-preview').addEventListener('click',()=>preview());$('plan-amend').addEventListener('click',()=>preview(true));
  $('plan-start').addEventListener('click',()=>action('avvia'));$('plan-continue').addEventListener('click',()=>action('continua'));$('plan-cancel').addEventListener('click',()=>action('annulla'));
  $('plan-refresh').addEventListener('click',()=>refresh());
  $('plan-clear-selection').addEventListener('click',()=>{selectionRevision++;selected.clear();renderControls();});
  $('plan-select-all').addEventListener('click',()=>{const items=host.workspace()?.items || [];if(items.length>MAX_SELECTION || !writable() || busy)return;selectionRevision++;for(const item of items)selected.add(item.item_id);renderControls();});
  $('plan-packet-prev').addEventListener('click',()=>changePage('packet',Math.max(0,packetOffset-PAGE)));$('plan-packet-next').addEventListener('click',()=>changePage('packet',packetOffset+PAGE));
  $('plan-record-prev').addEventListener('click',()=>changePage('record',Math.max(0,recordOffset-PAGE)));$('plan-record-next').addEventListener('click',()=>changePage('record',coverage?.next_record_offset ?? recordOffset));
  $('plan-events-more').addEventListener('click',()=>moreEvents());
  return {
    load(workspace) {
      if(workspace.id!==workspaceId){clearTimeout(timer);generation++;workspaceId=workspace.id;plan=null;coverage=null;busy=false;locked=false;selectionRevision=0;selected.clear();attempts.clear();events=[];eventAfter=0;nextEvent=null;restoring=false;latestPlan=null;previousPlan=null;}
      locked=false;checkboxes.clear();render();
      const latest=workspace.latest_analysis_plan;
      if(latest)latestPlan=latest;
      if(!plan && latest && !restoring){restoring=true;const ticket=generation,sequence=++readSequence,selectionTicket=selectionRevision;host.api('/preparazioni/'+workspaceId+'/piani/'+latest.plan_id+`?version=${latest.version}&offset=0&limit=${PAGE}`).then(value=>{if(!current(ticket) || sequence!==readSequence)return;plan=value;restoreLimits();if(selectionTicket===selectionRevision){selected.clear();for(const member of plan.selection || [])selected.add(member.record_key);}restoring=false;render();notify();refresh();}).catch(error=>{if(current(ticket) && sequence===readSequence){restoring=false;fail(error);renderControls();}});}
    },
    selectionControl(item) {
      const input=node('input');input.type='checkbox';input.className='preparation-plan-checkbox';input.checked=selected.has(item.item_id);input.disabled=!writable() || busy;
      input.setAttribute('aria-label','Incluse nel piano: '+(item.display_name || 'scheda'));
      input.addEventListener('change',()=>{if(input.checked && selected.size>=MAX_SELECTION && !selected.has(item.item_id)){input.checked=false;message('Puoi selezionare al massimo 100 schede. Nessuna selezione è stata tagliata automaticamente.');return;}selectionRevision++;if(input.checked)selected.add(item.item_id);else selected.delete(item.item_id);renderControls();});
      checkboxes.set(item.item_id,input);return input;
    },
    sourceChanged:renderControls,cardChanged:renderControls,refresh,
    current:()=>({plan,coverage,workspaceId}),selectedItems:()=>[...selected],
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    recordResults(item,offset=0){if(!plan)return Promise.resolve(null);return host.api(path()+`/schede/${item}/risultati?version=${plan.version}&offset=${offset}&limit=${PAGE}`);},
    pause(){clearTimeout(timer);},
    dispose(){clearTimeout(timer);generation++;listeners.clear();}
  };
}
