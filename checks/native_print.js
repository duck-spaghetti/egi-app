/** Seed a named synthetic collection on the dedicated milestone preview only. */
import {createCollections} from '/static/js/features/favorites/collections.js';
const collections=createCollections({territory:'roma',token:()=> '00000000-0000-0000-0000-000000000137'});
const title='Verifica stampa EGI-137';
let list=(await collections.list()).find(item=>item.id==='00000000-0000-0000-0000-000000000137');
if(!list){
  const id=await collections.create(title);
  const card=await (await fetch('/api/public/services/00000000-0000-0000-0000-000000000001?language=it')).json();
  for(let i=1;i<=1;i++){
    const service=card.id;
    await collections.cards(id).saveCopy({id:service,language:'it',status:'saved',savedAt:'2026-11-20T10:00:00Z',updatedAt:'2026-11-27T10:00:00Z',
      card:{...card,id:service,name:card.name,service_title:card.service_title}});
  }
  list={id};
}
location.replace('/preferiti/liste?lang=it#'+list.id);
