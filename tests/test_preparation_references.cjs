/** Exercise actual reference controls: bounded named reads and stale async decisions. */
const assert=require('node:assert/strict'),fs=require('node:fs');
const {environment}=require('./module_fixture.cjs');
class Element {
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.listeners={};this.attributes={};this.style={};this.value='';this.disabled=false;this.isConnected=true;}
 append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
 replaceChildren(...children){this.children=[];this.append(...children);}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.isConnected=false;}
 setAttribute(key,value){this.attributes[key]=value;}
 addEventListener(name,listener){this.listeners[name]=listener;}
 querySelectorAll(tag){return this.children.flatMap(child=>[...(child.tagName===tag.toUpperCase()?[child]:[]),...child.querySelectorAll(tag)]);}
 querySelector(tag){return this.querySelectorAll(tag)[0] || null;}
 click(){return this.listeners.click?.({target:this});}
 dispatch(name){return this.listeners[name]?.({target:this});}
 focus(){}
}
(async()=>{
 const document={createElement:tag=>new Element(tag)};
 function Option(label,value){const option=new Element('option');option.textContent=label;option.value=value;return option;}
 const {load}=environment({document,Option});
 const {PreparationDraft}=await load('features/preparations/draft.js');
 const {createReferenceControls}=await load('features/preparations/references.js');
 const text=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../translations/it.json'))).community;
 const target={kind:'organization',organization_id:'org-id',expected_work:'work',expected_public:null};
 const payload={schema_version:2,service:{},location:{kind:'none'},target:{kind:'new'},outcome:'review',field_origins:{},evidence:[],
  source_facts:[{fact_id:'fact',kind:'organization_name',subject:'service',source_value:'Alfa',value:'Alfa'}],
  resolutions:[{fact_id:'fact',state:'proposed',context:{},candidates:[{target,rank:1,reason:'normalized_label'}]}]};
 const draft=new PreparationDraft('item',{id:'version',payload});let release,changed=0,redraw=0;
 const controls=createReferenceControls({text,references:{organizations:[{organization_id:'org-id',name:'Associazione Alfa'}]},
  catalog:()=>{throw Error('unexpected network');},suggest:()=>{throw Error('unexpected IA');},changed:()=>changed++,
  flush:()=>new Promise(resolve=>{release=resolve;}),fresh:current=>current===draft});
 const row=new Element();const literal=new Element('input');row.append(literal);
 controls.render(row,draft,draft.payload.source_facts[0],0,true,()=>redraw++);
 row.querySelectorAll('select').find(element=>element.attributes['aria-label']===text.ref_role).value='provider';
 const select=row.querySelectorAll('button').find(element=>element.textContent==='Associazione Alfa');
 const pending=select.click();
 draft.edit('/source_facts/0/value','Alfa corretta');literal.dispatch('input');
 row.querySelectorAll('button').find(element=>element.textContent===text.ref_reject).click();
 release(true);await pending;
 assert.equal(draft.payload.resolutions[0].state,'ignored','late confirmation cannot overwrite a correction/rejection');
 assert.equal(draft.payload.source_facts[0].value,'Alfa corretta');assert.equal(changed,1);assert.equal(redraw,1);
 const queries=[];
 const naming=createReferenceControls({text,references:{},changed:()=>{},catalog:async query=>{queries.push(query);return {entries:[{target,label:'Named entity'}],next_offset:null};}});
 await naming.loadNames(new PreparationDraft('other',{id:'v',payload}));
 assert.equal(queries.length,1);assert.equal(JSON.stringify(queries[0].organization_ids),'["org-id"]');
 assert.equal(naming.label(target),'Named entity');
 const pageRequests=[];
 const paging=createReferenceControls({text,references:{},changed:()=>{},catalog:async query=>{pageRequests.push({...query});return {entries:[],next_offset:query.offset===50?null:50};}});
 const pagerRow=new Element();pagerRow.append(new Element('input'));
 const pagerDraft=new PreparationDraft('pager',{id:'v',payload});
 paging.render(pagerRow,pagerDraft,pagerDraft.payload.source_facts[0],0,true,()=>{});
 await pagerRow.querySelectorAll('button').find(element=>element.textContent===text.ref_search).click();
 const more=pagerRow.querySelectorAll('button').find(element=>element.textContent===text.ref_more);
 await more.click();assert.equal(more.disabled,true,'completed continuation stays disabled after async cleanup');
 await more.click();assert.equal(pageRequests.length,2,'even a forced click cannot restart offset0');
 const changedRequests=[];
 const changing=createReferenceControls({text,references:{},changed:()=>{},catalog:async query=>{changedRequests.push({...query});return {entries:[],next_offset:50};}});
 const changingRow=new Element();changingRow.append(new Element('input'));
 changing.render(changingRow,pagerDraft,pagerDraft.payload.source_facts[0],0,true,()=>{});
 await changingRow.querySelectorAll('button').find(element=>element.textContent===text.ref_search).click();
 changingRow.querySelectorAll('input').find(element=>element.attributes['aria-label']===text.ref_search_org).value='Changed search';
 const staleMore=changingRow.querySelectorAll('button').find(element=>element.textContent===text.ref_more);
 await staleMore.click();assert.equal(changedRequests.length,1,'changed query cannot use a previous continuation');assert.equal(staleMore.disabled,true);
 console.log('Reference controls: named bounded lookup, no IA call and stale confirmation protection passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
