/** Associate the bundled OSM surface entrances with GTFS station summaries, never with nearest-name guesses. */
const normal=name=>String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/^s\.\s+/,'san ').replace(/[^a-z0-9]/g,'');
const distance=(a,b)=>Math.hypot((a[0]-b[0])*111320*Math.cos(a[1]*Math.PI/180),(a[1]-b[1])*110540);

/** Explicit stop-area membership plus exact station name and a 500 m sanity bound; ambiguous matches stay absent. */
export function entranceSigns(stations,snapshot){
 if(snapshot?.format!=='egi-metro-entrances/1'||!Array.isArray(snapshot.features))return [];
 const metro=stations.filter(f=>f.geometry.type==='Point'&&f.properties.transport_type==='metro');
 const result=[];
 for(const entrance of snapshot.features){
  const coordinates=entrance.geometry?.coordinates;
  if(entrance.geometry?.type!=='Point'||!Array.isArray(coordinates)||coordinates.length!==2||!coordinates.every(Number.isFinite))continue;
  const matches=[];
  for(const area of entrance.properties?.areas||[]){
   const line=String(area.name||'').match(/^(.*?)\s*(?:\(Linea ([ABC])\)| ([AB]))$/i);
   const name=normal(line?line[1]:area.name),code=line?.[2]||line?.[3];
   const candidates=metro.filter(s=>normal(s.properties.name)===name&&distance(coordinates,s.geometry.coordinates)<=500);
   if(candidates.length!==1)continue;
   const station=candidates[0],routes=(station.properties.routes||[]).filter(r=>!code||String(r.display_code||r.code).replace(/^M/,'').startsWith(code.toUpperCase()));
   if(routes.length)matches.push({station,routes});
  }
  if(!matches.length)continue;
  // Shared A/B entrances remain one physical sign with every explicitly associated route.
  const routes=[...new Map(matches.flatMap(m=>m.routes).map(r=>[r.route_id,r])).values()];
  const stopIds=[...new Set(matches.flatMap(m=>m.station.properties.stop_ids||[m.station.properties.stop_id]))].sort();
  result.push({type:'Feature',id:entrance.id,geometry:entrance.geometry,
   properties:{...matches[0].station.properties,kind:'entrance',stop_id:undefined,stop_ids:stopIds,routes,
    entrance_ref:entrance.properties.ref,entrance_osm_id:entrance.properties.osm_id,
    wheelchair_boarding:entrance.properties.wheelchair||'unknown'}});
 }
 return result;
}
