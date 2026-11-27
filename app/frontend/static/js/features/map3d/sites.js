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
export const MAX_LEADER_LENGTH=64;
/** The fixed 44px head sits above the 24px ground/stem stack. */
export const siteHeadBox=(point,dx=0,dy=0)=>({left:point.x+dx-22,right:point.x+dx+22,top:point.y+dy-68,bottom:point.y+dy-24});
// A bounded fan offers alternatives when the shortest direction collides. Compute it once.
const HEAD_CANDIDATES=[[0,0],...[180,0,210,330,240,300,270,150,30,120,60,90].flatMap(angle=>
 [20,36,52,56].map(radius=>{
  const radians=angle*Math.PI/180;return [radius*Math.cos(radians),radius*Math.sin(radians)];
 })).filter(([dx,dy])=>Math.hypot(dx,dy-21)<=MAX_LEADER_LENGTH)];

/** Separate nearby site heads in screen space; feet and source grouping never move. */
export function placeSiteHeads(layout,{width,height,zoom,selectedId,rtl=false,controls=null}){
 const result=new Map();if(zoom<STEM_ZOOM)return result;
 const cells=new Map(),owners=new Map(),size=64,intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
 let repairBudget=256;
 // Numeric cells avoid allocating coordinate strings/arrays for every candidate at every frame.
 const visitCells=(box,visit,create=false)=>{
  const right=Math.floor(box.right/size),bottom=Math.floor(box.bottom/size);
  for(let x=Math.floor(box.left/size);x<=right;x++){
   let column=cells.get(x);if(!column&&create){column=new Map();cells.set(x,column);}if(!column)continue;
   for(let y=Math.floor(box.top/size);y<=bottom;y++){
    let row=column.get(y);if(!row&&create){row=[];column.set(y,row);}if(row&&visit(row))return true;
   }
  }
  return false;
 };
 const add=box=>visitCells(box,row=>{row.push(box);},true);
 const remove=box=>visitCells(box,row=>{const index=row.indexOf(box);if(index>=0)row.splice(index,1);});
 const hits=box=>visitCells(box,row=>row.some(other=>intersects(box,other)));
 const boxAt=siteHeadBox;
 const selected=group=>group.site.serviceIds?.includes(String(selectedId));
 const focus=layout.find(selected);
 // Source-space distance is stable through camera rotation; nearby civic addresses precede distant heads.
 const distance=group=>!focus?0:group.lngLat&&focus.lngLat?
  Math.hypot(group.lngLat[0]-focus.lngLat[0],group.lngLat[1]-focus.lngLat[1]):Math.hypot(group.point.x-focus.point.x,group.point.y-focus.point.y);
 const identity=group=>group.key||String(group.site.serviceIds?.slice().sort().join(',')||`${group.lngLat}`);
 const screen={width,height,rtl,controls};
 const inFrame=box=>box.left>=4&&box.right<=width-4&&box.top>=4&&box.bottom<=height-4;
 const at=(point,dx,dy)=>{
  const box=boxAt(point,dx,dy);
  return inFrame(box)&&!hitsMapControls(box,screen)&&!hits(box)?{dx,dy,box}:null;
 };
 /** Repair a greedy dead end by relocating at most two heads, with a shared per-pass work cap. */
 function repair(group){
  for(const [dx,dy] of HEAD_CANDIDATES){
   if(repairBudget<=0)return null;
   const box=boxAt(group.point,dx,dy);if(!inFrame(box)||hitsMapControls(box,screen))continue;
   const conflicts=new Set();let fixed=false;
   visitCells(box,row=>{for(const other of row)if(intersects(box,other)){if(!owners.has(other)){fixed=true;return true;}conflicts.add(other);if(conflicts.size>2)return true;}return false;});
   if(fixed)continue;
   if(conflicts.size<1||conflicts.size>2)continue;
   const oldBoxes=[...conflicts],blockers=oldBoxes.map(b=>owners.get(b));if(blockers.some(b=>!b))continue;
   for(const b of oldBoxes)remove(b);add(box);
   const alternatives=[];
   const relocate=index=>{
    if(index===blockers.length)return true;
    for(const [x,y] of HEAD_CANDIDATES){
     if(--repairBudget<0)return false;
     const alternative=at(blockers[index].point,x,y);if(!alternative)continue;
     add(alternative.box);alternatives.push(alternative);
     if(relocate(index+1))return true;
     alternatives.pop();remove(alternative.box);
    }
    return false;
   };
   const repaired=relocate(0);
   remove(box);
   if(repaired){for(let i=0;i<blockers.length;i++){owners.delete(oldBoxes[i]);owners.set(alternatives[i].box,blockers[i]);result.set(blockers[i],alternatives[i]);}return {dx,dy,box};}
   for(const b of oldBoxes)add(b);
  }
  return null;
 }
 // Feet are small obstacles; clusters keep their established, undisplaced positions.
 for(const group of layout){const p=group.point;add({left:p.x-5,right:p.x+5,top:p.y-5,bottom:p.y+5});if(group.members.length>1)add({left:p.x-25,right:p.x+25,top:p.y-25,bottom:p.y+25});}
 const ordered=layout.filter(g=>g.members.length===1).map(group=>({group,key:identity(group),selected:selected(group),distance:distance(group)}))
  .sort((a,b)=>Number(b.selected)-Number(a.selected)||a.distance-b.distance||a.key.localeCompare(b.key));
 for(const {group} of ordered){
  let placed=null;
  const previous=group.previous;
  // Keep a valid direction, shortening along it only when a substantial reduction fits.
  if(previous&&previous.dx**2+previous.dy**2<=MAX_HEAD_OFFSET**2&&previous.dx**2+(previous.dy-21)**2<=MAX_LEADER_LENGTH**2){
   const held=at(group.point,previous.dx,previous.dy);
   if(held)placed=previous.dx===0&&previous.dy===0?held:at(group.point,0,0)||at(group.point,previous.dx*.75,previous.dy*.75)||held;
  }
  if(!placed)for(const [dx,dy] of HEAD_CANDIDATES){
   placed=at(group.point,dx,dy);if(placed)break;
  }
  if(!placed&&repairBudget>0)placed=repair(group);
  // A bounded layout cannot guarantee space in arbitrarily dense views. Keep every site reachable.
  placed||={dx:0,dy:0,box:boxAt(group.point,0,0)};result.set(group,placed);owners.set(placed.box,group);add(placed.box);
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
