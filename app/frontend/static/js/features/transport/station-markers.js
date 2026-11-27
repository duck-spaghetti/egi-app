/** Summarise metro platforms without changing native sign coordinates or source evidence. */
const RADIUS_M=150;
const ids=f=>f.properties.stop_ids||[f.properties.stop_id];
const stationName=name=>String(name||'').trim().toLocaleLowerCase().replace(/^s\.\s+/,'san ');

/** One overlay per nearby station; combine line chips and retain every platform ID for departures. */
export function stationMarkers(features){
 const output=[],groups=new Map();
 for(const feature of features){
  const p=feature.properties;
  if(feature.geometry.type!=='Point'||p.transport_type!=='metro'){output.push(feature);continue;}
  const key=stationName(p.name),candidates=groups.get(key)||[];
  const [lng,lat]=feature.geometry.coordinates;
  let group=candidates.find(g=>Math.hypot((lng-g.origin[0])*111320*Math.cos(lat*Math.PI/180),(lat-g.origin[1])*110540)<=RADIUS_M);
  if(!group){group={origin:[lng,lat],features:[]};candidates.push(group);groups.set(key,candidates);}
  group.features.push(feature);
 }
 for(const candidates of groups.values())for(const group of candidates){
  const first=group.features[0],p=first.properties;
  if(group.features.length===1){output.push({...first,id:`metro:${[...ids(first)].sort().join(',')}`});continue;}
  const stopIds=[...new Set(group.features.flatMap(ids))].sort();
  const routes=[...new Map(group.features.flatMap(f=>f.properties.routes||[]).map(r=>[r.route_id,r])).values()];
  const weight=group.features.reduce((sum,f)=>sum+ids(f).length,0);
  const coordinates=[0,1].map(axis=>group.features.reduce((sum,f)=>sum+f.geometry.coordinates[axis]*ids(f).length,0)/weight);
  const accessibility=new Set(group.features.map(f=>f.properties.wheelchair_boarding||'unknown'));
  output.push({type:'Feature',id:`metro:${stopIds.join(',')}`,geometry:{type:'Point',coordinates},
   properties:{...p,kind:'station',name:group.features.find(f=>!/^s\.\s/i.test(f.properties.name))?.properties.name||p.name,
    stop_id:undefined,code:undefined,stop_ids:stopIds,routes,
    wheelchair_boarding:accessibility.size===1?[...accessibility][0]:'unknown'}});
 }
 return output;
}
