/** Reconcile trusted app-generated markup while preserving surviving controls, focus and scroll. */
const rendered=new WeakMap();
export const forgetMarkup=host=>rendered.delete(host);
const key=node=>node.nodeType===1?(node.id||['data-id','data-need','data-need-group','data-offer','data-control'].map(a=>node.getAttribute(a)).find(v=>v!==null)||(node.tagName==='OPTION'?`option:${node.getAttribute('value')}`:null)):null;
function compatible(a,b){return a.nodeType===b.nodeType&&(a.nodeType!==1||a.tagName===b.tagName)&&key(a)===key(b);}
function children(parent,target){
 const old=[...parent.childNodes],keyed=new Map(old.filter(n=>key(n)!==null).map(n=>[key(n),n])),used=new Set();
 for(const [index,next] of [...(Array.isArray(target)?target:target.childNodes)].entries()){
  const candidate=key(next)!==null?keyed.get(key(next)):old[index];let current=candidate&&!used.has(candidate)&&compatible(candidate,next)?candidate:null;
  if(!current)current=next;else if(current!==next&&!current.isEqualNode?.(next))patch(current,next);used.add(current);
  if(parent.childNodes[index]!==current)parent.insertBefore(current,parent.childNodes[index]||null);
 }
 for(const node of old)if(!used.has(node))node.remove();
}
function patch(current,next){
 if(current.nodeType!==1){if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;return;}
 for(const attr of [...current.attributes])if(!next.hasAttribute(attr.name))current.removeAttribute(attr.name);
 for(const attr of [...next.attributes])if(current.getAttribute(attr.name)!==attr.value)current.setAttribute(attr.name,attr.value);
 children(current,next);
}
/** One transaction owns focus/scroll restoration for both markup and row reconciliation. */
function preservePosition(host,fallback,update){
 const active=document.activeElement,hadFocus=active&&host.contains(active),top=host.scrollTop;
 update();
 if(hadFocus&&document.activeElement!==active){if(active.isConnected)active.focus({preventScroll:true});else fallback()?.focus({preventScroll:true});}
 if(host.scrollTop!==top)host.scrollTop=top;
}
/** HTML comes only from existing escaped presentation helpers; never pass arbitrary source HTML. */
export function reconcileMarkup(host,html,{fallback=()=>document.getElementById('view-toggle')}={}){
 if(rendered.get(host)===html)return;
 const template=document.createElement('template');template.innerHTML=html;
 preservePosition(host,fallback,()=>children(host,template.content));rendered.set(host,html);
}

const rowMarkup=new WeakMap();
/** Parse only changed service rows; current nodes own their last markup, never a detached-row cache. */
export function reconcileRows(host,rows,{fallback=()=>document.getElementById('view-toggle')}={}){
 const current=new Map([...host.children].map(node=>[node.getAttribute('data-id'),node]));
 const unchanged=row=>{const node=current.get(String(row.id));return node&&rowMarkup.get(node)===row.html?node:null;};
 const template=document.createElement('template');template.innerHTML=rows.filter(row=>!unchanged(row)).map(row=>row.html).join('');
 const changed=new Map([...template.content.children].map(node=>[node.getAttribute('data-id'),node]));
 preservePosition(host,fallback,()=>children(host,rows.map(row=>unchanged(row)||changed.get(String(row.id)))));
 for(const [index,row] of rows.entries())rowMarkup.set(host.children[index],row.html);
 forgetMarkup(host);
}
