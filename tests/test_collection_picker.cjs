const assert=require('node:assert/strict');
const {environment}=require('./module_fixture.cjs');
(async()=>{
  const env=environment();const {Lifecycle}=await env.load('lifecycle.js');
  const {createCollectionPicker}=await env.load('features/favorites/collection-picker.js');
  const dialogs=[];let release;
  const saving=new Promise(resolve=>{release=resolve;});
  function dialog(){
    const events={},submit={disabled:false},cancel={addEventListener(name,fn){this[name]=fn;}};
    const form={elements:{collection:{value:'one',disabled:false,addEventListener(){}},name:{value:'Test',disabled:false}},
      querySelector:()=>submit,addEventListener:(name,fn)=>{events['form:'+name]=fn;}};
    const node={open:false,querySelector:selector=>selector==='form'?form:selector==='[data-cancel]'?cancel:{addEventListener(){}},
      addEventListener:(name,fn)=>{events[name]=fn;},showModal(){this.open=true;},
      close(){this.open=false;events.close();},remove(){},submit:()=>events['form:submit']({preventDefault(){}})};
    dialogs.push(node);return node;
  }
  const root={createElement:()=>dialog(),body:{append(){}}},scope=new Lifecycle();
  const choose=createCollectionPicker({scope,territory:'roma',root,translate:key=>key,notify(){},favorites:{list:async()=>[]},
    collectionFactory:()=>({list:async()=>[{id:'one',name:'Test'}],cards:()=>({save:()=>saving})})});
  const opener={isConnected:true,focus(){}};
  await choose(opener,'service','it');const first=dialogs[0];const submitting=first.submit();
  first.close();await choose(opener,'another','it');
  assert.equal(dialogs.length,1,'cancel while saving must not release ownership to a new picker');
  release();await submitting;await choose(opener,'another','it');
  assert.equal(dialogs.length,2);assert.equal(dialogs[1].open,true,'settled old save cannot close the new dialog');
  scope.dispose();
  console.log('PASS: pending collection save, cancel/reopen ownership and lifecycle cleanup');
})().catch(error=>{console.error(error);process.exitCode=1;});
