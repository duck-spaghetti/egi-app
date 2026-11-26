import {iconPath} from '../map/pins.js';
import {escapeHtml,categoryCaption} from '../../format.js';
/** Screen-space site clustering and progressive labels; editorial/service rules stay upstream. */
export const CLUSTER_DISTANCE=64, STEM_ZOOM=14, NAME_ZOOM=14, DETAIL_ZOOM=14;

/** Merge neighbouring groups across cell boundaries until their centres no longer overlap. */
export function clusterSites(entries,project,zoom,maxZoom=15){
 if(zoom>=maxZoom)return entries.map(site=>({site,members:[site]}));
 const cells=new Map(),groups=new Set();
 const cell=point=>[Math.floor(point.x/CLUSTER_DISTANCE),Math.floor(point.y/CLUSTER_DISTANCE)];
 function remove(group){const key=cell(group.point).join(':');cells.get(key)?.delete(group);groups.delete(group);}
 function insert(group){const key=cell(group.point).join(':');if(!cells.has(key))cells.set(key,new Set());cells.get(key).add(group);groups.add(group);}
 for(const site of entries){
  const group={site,members:[site],point:project([site.lng,site.lat])};
  let other;
  do{
   other=null;const [x,y]=cell(group.point);
   for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const candidate of cells.get(`${x+dx}:${y+dy}`)||[]){
    if(Math.hypot(group.point.x-candidate.point.x,group.point.y-candidate.point.y)<CLUSTER_DISTANCE){other=candidate;break;}
   }
   if(other){remove(other);group.members.push(...other.members);const n=group.members.length;
    group.point=project([group.members.reduce((sum,p)=>sum+p.lng,0)/n,group.members.reduce((sum,p)=>sum+p.lat,0)/n]);}
  }while(other);
  insert(group);
 }
 return [...groups];
}

/** Readable count symbols use the same quantity for size and tint, leaving category colours to sites. */
export function clusterAppearance(count){
 const strength=Math.min(1,Math.log2(Math.max(2,count))/6);
 return {size:Math.round(30+18*strength),background:`hsl(188 32% ${Math.round(78-23*strength)}% / 0.85)`,ink:'#000'};
}

/** Labels reuse the existing service opening statuses, including unknown and unverified states. */
export function siteLabel(site,detail,translate){
 const name=site.name||site.label.split(':')[0];
 if(!detail)return `<span class="map3d-site-label" aria-hidden="true"><strong>${escapeHtml(name)}</strong></span>`;
 const statuses=(site.statuses||[]).filter(Boolean),live=statuses.filter(s=>s.kind==='open'||s.kind==='closing');
 const kind=live.some(s=>s.kind==='open')?'open':live.length?'closing':statuses.length&&statuses.every(s=>s.kind==='closed')?'closed':'unknown';
 const label=statuses.length===1?statuses[0].label:live.length?translate('map.map3d.site_open',{open:live.length,total:statuses.length},`${live.length}/${statuses.length} servizi aperti`):kind==='closed'?statuses[0].label:translate('map.map3d.hours_unknown',{},'Orario da verificare');
 const verification=[...new Set(statuses.map(s=>s.verificationLabel).filter(Boolean))].join(' · ');
 const visibleLabel=statuses.length>1&&verification&&!label.includes(verification)?`${verification} · ${label}`:label;
 const categories=(site.allCategories||site.categories||[]).map(c=>{
  const caption=categoryCaption(c.label||c.slug),outside=c.matched===false;
  const title=outside?translate('map.map3d.category_outside',{category:caption},`${caption} · fuori dai filtri`):caption;
  const icon=iconPath(c.icon_path);
  return `<span class="map3d-category${outside?' outside-search':''}" style="background:${escapeHtml(c.color||'#555')}" title="${escapeHtml(title)}">${icon?`<img src="${escapeHtml(icon)}" alt="${escapeHtml(caption)}">`:escapeHtml(caption)}</span>`;
 }).join('');
 return `<span class="map3d-site-label" aria-hidden="true"><strong>${escapeHtml(name)}</strong><span class="map3d-category-row">${categories}</span><small class="map3d-site-status ${kind}" title="${escapeHtml(statuses.map(s=>[s.label,s.note].filter(Boolean).join(' · ')).join('; '))}"><i></i>${escapeHtml(visibleLabel)}</small></span>`;
}
