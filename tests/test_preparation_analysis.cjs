/** Actual analysis controller: one first-insertion job and explicit card selection. */
const assert=require('node:assert/strict');
const {environment}=require('./module_fixture.cjs');
(async()=>{
 let sequence=0;const timers=new Map();
 const env=environment({crypto:{randomUUID:()=>`key-${++sequence}`},setTimeout:(fn,delay)=>{const id=++sequence;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id)});
 const {createAnalysis}=await env.load('features/preparations/analysis.js');
 const text={field_labels:{},choice_labels:{},job_states:{succeeded:'Choose'},analysis_intro:'First public paste',analysis_unavailable:'Unavailable'};
 let workspace={id:'ws',permission:'owner',state:'active',current_input_id:null,jobs:[],input_metadata:{public_attestation:true}},dirty=true,uploads=0,draft=null;
 let requests=0;const calls=[];
 const job=n=>({job_id:`job${n}`,input_id:workspace.current_input_id,state:'succeeded',candidate_ids:{one:`id${n}a`,two:`id${n}b`},output:{candidates:[{candidate_key:'one',service:{name:'Telephone desk',delivery_mode:'telephone'},location:{kind:'none'},evidence:[]},{candidate_key:'two',service:{name:'Another desk'},location:{kind:'none'},evidence:[]}]}});
 env.get('source-text').value='Two public services';env.get('public-material').checked=true;
 const controller=createAnalysis({context:{text},workspace:()=>workspace,draft:()=>draft,canEdit:()=>true,inputDirty:()=>dirty,
  persistInput:async()=>{uploads++;dirty=false;workspace.current_input_id=`input${uploads}`;},flush:async()=>true,
  api:async(path,body)=>{calls.push({path,body});if(path.endsWith('/analisi'))return{job_id:`job${++requests}`,state:'queued'};
   if(path.includes('/lavori/'))return job(requests);
   if(path.endsWith('/schede/crea'))return{items:[{item_id:'card',version_id:'version',conflicts:[]}]};
   throw new Error(path);},reload:async()=>{},openCard:async id=>{draft={item:id,version:'v1'};},error:error=>{throw error;},caption:path=>path});
 const flush=async()=>{for(let n=0;n<20;n++)await Promise.resolve();};
 controller.load(workspace);controller.sourceChanged();controller.sourceChanged();
 assert.equal(timers.size,1,'typing replaces the first-paste debounce');
 const initial=[...timers.values()][0];timers.clear();await initial.fn();await flush();
 assert.equal(requests,1);assert.equal(uploads,1);
 assert.equal(calls.filter(call=>call.path.endsWith('/schede/crea')).length,0,'recognition creates no cards');
 assert.equal(env.get('analysis-create').disabled,true);
 const firstCandidate=env.get('analysis-candidates').children[0].children[0].children[0];
 firstCandidate.checked=true;firstCandidate.dispatch('change',{});
 env.get('analysis-create').click();await flush();
 const application=calls.find(call=>call.path.endsWith('/schede/crea'));
 assert.equal(application.body.selections.length,1);assert.equal(application.body.selections[0].candidate_id,'id1a');
 controller.cardChanged();assert.equal(requests,1,'card edits/view changes start no interpretation');
 dirty=true;controller.sourceChanged();assert.equal(timers.size,0,'later source edits await explicit Update');
 assert.equal(env.get('analysis-create').disabled,true,'stale text cannot materialize old candidates');
 env.get('analysis-update').click();await flush();
 assert.equal(requests,2);assert.equal(uploads,2);
 assert.notEqual(calls.filter(call=>call.path.endsWith('/analisi'))[0].body.request_key,calls.filter(call=>call.path.endsWith('/analisi'))[1].body.request_key);
 const priorReads=calls.filter(call=>call.path.includes('/lavori/')).length;
 workspace.jobs=[{...job(requests),task:'extract_text'},{job_id:'new-workbench',input_id:workspace.current_input_id,task:'classify_cards',state:'succeeded'}];
 controller.load(workspace);await flush();
 assert.equal(calls.filter(call=>call.path.includes('/lavori/')).length,priorReads,'workbench jobs never replace the legacy extraction panel');
 console.log('Preparation analysis: debounced first eligible request, explicit updates, selected creation and stale-result blocking passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
