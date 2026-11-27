/** Conservative map-space footprints shared by service heads and their expanded labels. */
export function hitsMapControls(box,{width,height,rtl=false,controls=null}){
 if(controls)return controls.some(c=>box.left<c.right&&box.right>c.left&&box.top<c.bottom&&box.bottom>c.top);
 const camera=(rtl?box.right>width-140:box.left<140)&&box.right>0&&box.top<312&&box.bottom>100;
 const modes=(rtl?box.left<140:box.right>width-140)&&box.top<270;
 const brand=box.left<150&&box.top<125;
 const navigation=box.bottom>height-115&&(box.left<110||box.right>width-110||box.left<width/2+85&&box.right>width/2-85);
 return camera||modes||brand||navigation;
}

import {iconPath} from '../map/pins.js';
import {escapeHtml,categoryCaption} from '../../format.js';
/** Screen-space site clustering and progressive labels; editorial/service rules stay upstream. */
export const CLUSTER_DISTANCE=64, STEM_ZOOM=14, NAME_ZOOM=14, DETAIL_ZOOM=14;
export const MAX_HEAD_OFFSET=56;

/** Separate nearby site heads in screen space; feet and source grouping never move. */
export function placeSiteHeads(layout,{width,height,zoom,selectedId,rtl=false,controls=null}){
 const result=new Map();if(zoom<STEM_ZOOM)return result;
 const cells=new Map(),size=64,intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
 const keys=box=>{const keys=[];for(let x=Math.floor(box.left/size);x<=Math.floor(box.right/size);x++)for(let y=Math.floor(box.top/size);y<=Math.floor(box.bottom/size);y++)keys.push(`${x}:${y}`);return keys;};
 const add=box=>{for(const key of keys(box)){if(!cells.has(key))cells.set(key,[]);cells.get(key).push(box);}};
 const hits=box=>keys(box).some(key=>(cells.get(key)||[]).some(other=>intersects(box,other)));
 const boxAt=(point,dx,dy)=>({left:point.x+dx-25,right:point.x+dx+25,top:point.y+dy-82,bottom:point.y+dy-20});
 const selected=group=>group.site.serviceIds?.includes(String(selectedId));
 const identity=group=>String(group.site.serviceIds?.slice().sort().join(',')||`${group.lngLat}`);
 // Feet are small obstacles; clusters keep their established, undisplaced positions.
 for(const group of layout){const p=group.point;add({left:p.x-5,right:p.x+5,top:p.y-5,bottom:p.y+5});if(group.members.length>1)add({left:p.x-25,right:p.x+25,top:p.y-25,bottom:p.y+25});}
 const ordered=layout.filter(g=>g.members.length===1).sort((a,b)=>Number(selected(b))-Number(selected(a))||identity(a).localeCompare(identity(b)));
 const candidates=[[0,0],[-56,0],[56,0],[0,-36],[-52,-16],[52,-16]];
 for(const group of ordered){
  let placed=null;
  for(const [dx,dy] of candidates){
   const box=boxAt(group.point,dx,dy);
   const inFrame=box.left>=4&&box.right<=width-4&&box.top>=4&&box.bottom<=height-4;
   const overTools=hitsMapControls(box,{width,height,rtl,controls});
   if(inFrame&&!overTools&&!hits(box)){placed={dx,dy,box};break;}
  }
  // A bounded layout cannot guarantee space in arbitrarily dense views. Keep every site reachable.
  placed||={dx:0,dy:0,box:boxAt(group.point,0,0)};result.set(group,placed);add(placed.box);
 }
 return result;
}

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
 const label=statuses.length===1?statuses[0].label:live.length?translate('map.map3d.site_open',{open:live.length,total:statuses.length},`${live.length}/${statuses.length} servizi aperti`):kind==='closed'?statuses[0].label:translate('map.map3d.hours_unknown',{},'Orario non disponibile');
 const verification=[...new Set(statuses.map(s=>s.verificationLabel).filter(Boolean))].join(' · ');
 const visibleLabel=statuses.length>1&&verification&&!label.includes(verification)?`${verification} · ${label}`:label;
 const categorySet=site.allCategories||site.categories||[];
 const categories=categorySet.length>1?categorySet.map(c=>{
  const caption=categoryCaption(c.label||c.slug),outside=c.matched===false;
  const title=outside?translate('map.map3d.category_outside',{category:caption},`${caption} · fuori dai filtri`):caption;
  const icon=iconPath(c.icon_path);
  return `<span class="map3d-category${outside?' outside-search':''}" style="background:${escapeHtml(c.color||'#555')}" title="${escapeHtml(title)}">${icon?`<img src="${escapeHtml(icon)}" alt="${escapeHtml(caption)}">`:escapeHtml(caption)}</span>`;
 }).join(''):'';
 const kinds=(site.kinds||[]).join(' · ');
 const secondary=categorySet.length>1?`<span class="map3d-category-row">${categories}</span>`:kinds?`<small class="map3d-site-kind" title="${escapeHtml(kinds)}">${escapeHtml(kinds)}</small>`:'';
 return `<span class="map3d-site-label" aria-hidden="true"><strong>${escapeHtml(name)}</strong>${secondary}<small class="map3d-site-status ${kind}" title="${escapeHtml(statuses.map(s=>[s.label,s.note].filter(Boolean).join(' · ')).join('; '))}"><i></i>${escapeHtml(visibleLabel)}</small></span>`;
}
