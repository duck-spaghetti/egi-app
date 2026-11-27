/** Actual group controller: explicit manual choices, bounded pages and frozen retries. */
const assert=require('node:assert/strict');const {environment}=require('./module_fixture.cjs');
function element(tag='div',text=''){
 return {tagName:tag.toUpperCase(),textContent:text,children:[],dataset:{},attributes:{},listeners:{},value:'',disabled:false,checked:false,
  append(...values){this.children.push(...values);},replaceChildren(...values){this.children=[...values];},setAttribute(key,value){this.attributes[key]=value;},addEventListener(key,value){this.listeners[key]=value;},
  click(){if(!this.disabled)return this.listeners.click?.();},dispatch(type){return this.listeners[type]?.();}};
}
const all=node=>[node,...node.children.flatMap(all)],clone=value=>structuredClone(value);
(async()=>{
 let sequence=0;const {load}=environment({document:{createElement:tag=>element(tag)},Option:function(text,value){return {...element('option',text),value};},crypto:{randomUUID:()=> 'uuid-'+(++sequence)}});
 const {createGroups,groupText}=await load('features/preparations/groups.js');
 const members=Array.from({length:100},(_,n)=>({item_id:'item-'+n,expected_version:'version-'+n,basis_kind:'source_fact',basis_id:'basis-'+n}));
 const details=members.map((member,n)=>({member,name:'Service '+n,label:'Same label',value:'Same label',origin:'source_fact',state:'original',context:null,original:{value:'Same label',path:'/source_facts/0/source_value',evidence:[{quote:'Same label'}]}}));
 const context={territory_id:'territory',axis_id:'axis',catalog_digest:'digest',as_of:'2026-11-27'},target={kind:'classification',adoption_id:'adoption',release_id:'release',term_id:'term',axis_id:'axis'};
 let group={group_id:'large',version:'large-v1',parent_versions:[],preparation_id:'workspace',context,members:clone(members),mapping:target,state:'accepted',method:'manual',proposal_id:null};
 const saved=new Map([['large',group]]),calls=[],refreshes=[],errors=[],operations=[];let flushes=0,failApply=true,failVariants=false,failRefresh=false,applyCalls=0,workspace={id:'workspace'};
 function envelope(group,offset=0,limit=100){const page=group.members.slice(offset,offset+limit);return {group:Object.fromEntries(Object.entries(group).filter(([key])=>key!=='members')),members:clone(page),details:page.map(member=>clone(details.find(row=>row.member.item_id===member.item_id) || {member,name:'Service',label:'Original',origin:member.basis_kind})),total_members:group.members.length,next_offset:offset+limit<group.members.length?offset+limit:null};}
 const receipt={operation_id:'apply-op',kind:'apply',state:'running',items:[{item_id:'item-0',name:'Service 0',status:'applied',reason:null},{item_id:'item-1',name:'Service 1',status:'skipped',reason:'manual_or_cleared'}],total_items:100,next_offset:50,summary:{pending:50,applied:49,skipped:1,conflict:0}};
 async function api(path,body){calls.push({path,body:body===undefined?undefined:clone(body)});
  if(path.includes('/catalogo'))return body.query.kind==='taxonomy_context'?{entries:[{...context,territory_label:'Territory',axis_label:'Axis',release_version:'1'}],next_offset:null}:{entries:[{label:'Named category',target}],next_offset:null};
  if(path.endsWith('/gruppi/contesto'))return clone(context);
  if(path.includes('/gruppi/basi')){const offset=body.offset || 0;return {bases:clone(details.slice(offset,offset+50)),total:100,next_offset:offset+50<100?offset+50:null};}
  if(path.includes('/gruppi/varianti')){if(failVariants)throw Object.assign(new Error('reviewer_unavailable'),{status:503});return {groups:[{variant_key:'spelling',label:'Same label',context,members:clone(members),details:clone(details),total_members:100,next_member_offset:null}],total:1,next_offset:null};}
  if(path.includes('/gruppi/operazioni?'))return {operations:clone(operations),total_operations:operations.length,next_offset:null};
  if(path.endsWith('/operazioni/apply-op/annulla'))return {...clone(receipt),operation_id:'undo-op',kind:'undo',state:'complete',summary:{pending:0,applied:98,skipped:0,conflict:1},next_offset:null};
  if(path.includes('/operazioni/apply-op?'))return clone(receipt);
  if(path.includes('/applica')){
   applyCalls++;if(failApply){failApply=false;throw Object.assign(new Error(),{status:503});}
   receipt.resume_request={group_id:'large',...clone(body)};operations.splice(0,operations.length,{operation_id:'apply-op',kind:'apply',state:'running'});
   if(applyCalls>=3){receipt.state='complete';receipt.summary={pending:0,applied:98,skipped:1,conflict:1};receipt.next_offset=null;operations[0].state='complete';}
   return clone(receipt);
  }
  if(path.endsWith('/gruppi') && body){const value=clone(body.revision);saved.set(value.group_id,value);return envelope(value);}
  if(path.includes('/gruppi?'))return {groups:[...saved.values()].map(value=>({...value,members:undefined,member_count:value.members.length})),next_offset:null};
  const match=path.match(/\/gruppi\/([^/?]+)\?/);if(match)return envelope(saved.get(match[1]),Number(new URL('http://local'+path).searchParams.get('offset') || 0));
  throw new Error('unexpected fixed route '+path);
 }
 const root=element(),host={root,context:{text:{}},workspace:()=>workspace,selectedItems:()=>members.map(member=>member.item_id),canEdit:()=>true,
  flush:async()=>{flushes++;return true;},refresh:async(receipt,id)=>{refreshes.push([receipt.operation_id,id]);if(failRefresh){failRefresh=false;throw Object.assign(new Error(),{status:409});}},api,error:error=>errors.push(error)};
 const controller=createGroups(host),button=text=>all(root).find(node=>node.tagName==='BUTTON' && node.textContent===text);
 await controller.load(workspace);assert.equal(flushes,0);assert.equal(calls.some(call=>call.path.includes('analisi')),false,'manual groups never request IA');
 await button(groupText.bases).click();assert.equal(controller.current().basis.length,50);assert.equal(controller.current().basisOffset,50);
 const check=all(root).find(node=>node.tagName==='INPUT' && node.attributes['aria-label']?.startsWith(groupText.select));check.checked=true;check.dispatch('change');
 await button(groupText.manual).click();const manual=calls.find(call=>call.body?.revision);assert.equal(manual.body.revision.method,'manual');assert.equal(manual.body.revision.state,'proposed');assert.equal(manual.body.revision.mapping,null);assert.equal(flushes,1);
 await button(groupText.contexts).click();const picker=all(root).find(node=>node.attributes['aria-label']===groupText.context);assert.equal(picker.value,'','loaded context is not silently presented as human-confirmed');picker.value='0';await picker.dispatch('change');
 const mapping=all(root).find(node=>node.attributes['aria-label']===groupText.mapping);mapping.value='0';mapping.dispatch('change');await button(groupText.accept).click();
 assert.equal(calls.filter(call=>call.body?.revision).at(-1).body.revision.state,'accepted','acceptance is explicit and separate from creation');
 await controller.open('large');for(const member of members)controller.current().selection.set([member.item_id,member.basis_kind,member.basis_id].join(':'),clone(member));controller.render();
 const before=flushes;await button(groupText.apply).click();assert.ok(controller.current().pending);assert.equal(flushes,before+1);const frozen=clone(controller.current().pending.body);
 assert.equal(await controller.prepareProposal({proposal_id:'new-proposal'}),undefined,'an uncertain frozen write cannot be replaced by another proposal');assert.deepEqual(clone(controller.current().pending.body),frozen);
 controller.current().selection.clear();failRefresh=true;await button(groupText.retry).click();assert.equal(flushes,before+1,'uncertain retry never resnapshots or reflushed edited selections');
 assert.equal(controller.current().message,groupText.savedRefresh);assert.ok(controller.current().pending,'post-commit refresh conflict cannot discard running frozen selection/key');
 assert.equal(JSON.stringify(calls.filter(call=>call.path.endsWith('/large/applica'))[1].body),JSON.stringify(frozen));assert.equal(controller.current().receipt.state,'running');
 await button(groupText.continue).click();assert.equal(controller.current().pending,null);assert.equal(controller.current().receipt.summary.conflict,1);assert.ok(refreshes.every(([,id])=>id==='workspace'));
 await button(groupText.undo).click();assert.equal(controller.current().receipt.kind,'undo');assert.equal(controller.current().receipt.summary.conflict,1);assert.equal(button(groupText.undo),undefined,'undo receipts cannot recursively undo themselves');
 // Reload recovers a pending operation through the server-owned original request.
 receipt.state='running';receipt.summary.pending=1;operations[0].state='running';controller.dispose();const reloaded=createGroups(host);await reloaded.load(workspace);
 const operationButton=all(root).find(node=>node.tagName==='BUTTON' && node.textContent.startsWith(groupText.apply+' · '));await operationButton.click();assert.equal(reloaded.current().receipt.resume_request.request_key,frozen.request_key);
 await button(groupText.continue).click();assert.equal(JSON.stringify(calls.filter(call=>call.path.endsWith('/large/applica')).at(-1).body),JSON.stringify(frozen));
 assert.equal(calls.some(call=>call.path.includes('/input/')),false);assert.equal(errors.length,2,'only the controlled ambiguous failure and post-commit refresh conflict occur');
 const combining=()=>all(root).filter(node=>node.tagName==='INPUT' && node.attributes['aria-label']?.startsWith(groupText.combine));
 assert.equal(button(groupText.combine).disabled,true);let firstBox=combining()[0];firstBox.checked=true;firstBox.dispatch('change');assert.equal(button(groupText.combine).disabled,true);
 let secondBox=combining()[1];secondBox.checked=true;secondBox.dispatch('change');assert.equal(button(groupText.combine).disabled,false,'actual checkbox selection updates the combine action');
 await button(groupText.combine).click();const combined=calls.filter(call=>call.body?.revision).at(-1).body.revision;
 assert.equal(combined.parent_versions.length,2);assert.equal(combined.members.length,100,'combine keeps the full union without duplicate identity inflation');assert.equal(combined.state,'proposed');
 reloaded.current().selection.set([members[0].item_id,members[0].basis_kind,members[0].basis_id].join(':'),clone(members[0]));reloaded.render();await button(groupText.split).click();
 const split=calls.filter(call=>call.body?.revision).at(-1).body.revision;assert.equal(split.parent_versions[0],combined.version);assert.equal(split.members.length,1);assert.equal(split.state,'proposed');
 reloaded.current().context=clone(context);failVariants=true;reloaded.render();await button(groupText.variants).click();assert.equal(reloaded.current().message,groupText.variantsUnavailable);assert.ok(button(groupText.manual),'manual grouping remains offered when local variants are unavailable');
 const firstState=reloaded.current();workspace={id:'another'};await reloaded.load(workspace);assert.notEqual(reloaded.current(),firstState);assert.equal(reloaded.current().basisSelected.size,0,'workspace-local choices never cross preparations');
 console.log('Workbench groups: manual/no-IA creation, bounded basis/member state, explicit acceptance, frozen apply/undo retries and reload receipts passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
