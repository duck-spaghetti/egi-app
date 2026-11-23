
/** createLoader owns its behavior; dependencies and snapshots are explicit. */
export function createLoader({context,http,scope,debug=false}) {


const managedFetch=http.request;
async function readJson(response){if(!response.ok)throw Error('unavailable');return response.json();}
async function services(language) {
 const params=new URLSearchParams({area_id:String(context.cityId),language,limit:'5000'});
 if(debug)params.set('include_unplaced','true');
 return readJson(await managedFetch(`${context.apiBase||'/api/preview'}/services?${params}`));
}
async function load(language) {
 const base=context.apiBase||'/api/preview';
 const read=path=>managedFetch(`${base}/${path}`).then(readJson);
 const [categories,rows,languages,areas,categoryTranslations,taxonomy]=await Promise.all([
  read('categories?sort_by=sort_order&sort_order=asc&limit=1000'),services(language),
  read('languages'),read('areas'),
  read('category-translations?limit=1000'),
  managedFetch(`${base}/taxonomy`).then(readJson).catch(error=>{scope.check();return {needs:[],offers:[],audiences:[],access:[],meal_times:[],paths:[],course_levels:[]};})
 ]);
 scope.check();
 return {categories,rows,languages,areas,categoryTranslations,taxonomy};
}

return {load,services};
}
