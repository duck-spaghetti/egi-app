
/** createSites owns its behavior; dependencies and snapshots are explicit. */
export function createSites({context,snapshot}) {

function sourceSiteKey(poi) {
  if (!Number.isFinite(poi.latitude) || !Number.isFinite(poi.longitude) || poi.raw?.placement?.section === "directory") return null;
  if (context.canonical) return `point:${poi.latitude}:${poi.longitude}`;
  return [poi.raw?.source_group?.external_key || poi.id,poi.latitude,poi.longitude,poi.raw?.itinerant_source ? "itinerant" : "fixed"].join(":");
}

function siteGroups(list) {
  // A matching service reveals its source site, including siblings in other categories.
  const keys = new Set(list.map(sourceSiteKey).filter(Boolean));
  const groups = new Map();
  (context.canonical ? list : snapshot().pois).forEach(poi => {
    const key = sourceSiteKey(poi);
    if (!keys.has(key)) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(poi);
  });
  return [...groups.values()];
}

let indexed=null,points=new Map(),sources=new Map();
/** Rebuild exact source relationships once per refresh; never merge approximate positions. */
function reset(){
 indexed=snapshot().pois;points=new Map();sources=new Map();
 for(const poi of indexed){const key=sourceSiteKey(poi),source=poi.raw?.source_group?.external_key;
  if(key){if(!points.has(key))points.set(key,[]);points.get(key).push(poi);}
  if(source){if(!sources.has(source))sources.set(source,[]);sources.get(source).push(poi);}
 }
}
function sameSourceGroup(poi) {
 if(indexed!==snapshot().pois)reset();
 if(context.canonical){const key=sourceSiteKey(poi);return key?points.get(key)||[]:[poi];}
 const id=poi.raw?.source_group?.external_key;return id?sources.get(id)||[]:[poi];
}

return {key:sourceSiteKey,groups:siteGroups,siblings:sameSourceGroup,reset,dispose(){indexed=null;points.clear();sources.clear();}};
}
