const assert=require('node:assert/strict');
const {environment}=require('./module_fixture.cjs');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const memory=()=>{const data=new Map();return {all:async()=>structuredClone([...data.values()]),mutate:async(key,update)=>{
  const next=update(structuredClone(data.get(key)));if(next===null)data.delete(key);else if(next!==undefined)data.set(key,structuredClone(next));return next;}};};
(async()=>{
  const env=environment();const {createCollections}=await env.load('features/favorites/collections.js');
  const {createFavorites}=await env.load('features/favorites/store.js');
  const store=memory();let serial=10,mode='ok',pending;
  const request=async()=>{
    if(pending)await pending;
    if(mode==='offline')throw Error('offline');
    return {headers:{get:()=> 'approved-canonical-local'},status:mode==='withdraw'?404:200,ok:true,
      json:async()=>({id:id(1),data_status:'approved_canonical_local',name:'Public <service>',description:'Public details',place:{address:'Roma'},secret:'discard'})};
  };
  const collections=createCollections({territory:'roma',store,request,token:()=>id(serial++),now:()=> '2026-11-27T10:00:00Z'});
  const a=await collections.create(' Percorso salute '),b=await collections.create('Accoglienza');
  await collections.cards(a).save(id(1));await collections.cards(a).save(id(1));
  assert.equal((await collections.cards(a).list()).length,1);
  assert.equal((await collections.list())[0].name,'Percorso salute');
  assert(!JSON.stringify(await collections.list()).includes('discard'));
  assert.equal((await createCollections({territory:'altro',store}).list()).length,0);
  const favorites=createFavorites({territory:'roma',store,request,token:()=>id(serial++)});
  await favorites.save(id(1));const copy=(await favorites.list())[0];mode='offline';
  await collections.cards(b).saveCopy(copy);await favorites.remove(id(1));
  assert.equal((await collections.cards(b).list()).length,1,'favorite removal cannot erase collection');
  assert.equal((await collections.cards(b).list())[0].updatedAt,copy.updatedAt,'offline copy keeps source timestamp');
  assert.equal((await collections.cards(b).refresh()).failures,1);
  await collections.rename(a,'Salute');assert.equal((await collections.list())[0].name,'Salute');
  assert.throws(()=>collections.rename(a,'   '));await assert.rejects(collections.create('x'.repeat(81)));
  mode='withdraw';await collections.cards(b).refresh();
  assert.equal((await collections.cards(b).list())[0].status,'unavailable');
  assert.equal((await collections.cards(b).list())[0].card,undefined);
  await collections.cards(b).saveCopy(copy);
  assert.equal((await collections.cards(b).list())[0].status,'unavailable','re-adding stale favorite cannot undo a confirmed withdrawal');
  mode='ok';let release;pending=new Promise(resolve=>{release=resolve;});
  const refresh=collections.cards(a).refresh();await new Promise(setImmediate);
  await collections.cards(a).remove(id(1));release();await refresh;pending=null;
  assert.equal((await collections.cards(a).list()).length,0,'late refresh cannot revive removed membership');
  await collections.remove(a);assert.equal((await collections.list()).length,1);
  await assert.rejects(collections.cards(a).save(id(1)),'deleted collection cannot be recreated by late save');
  assert.equal((await collections.cards(b).list()).length,1,'other collections survive deletion');
  console.log('PASS: local collection CRUD, independent membership, deduplication, offline copy, withdrawal and refresh/delete races');
})().catch(error=>{console.error(error);process.exitCode=1;});
