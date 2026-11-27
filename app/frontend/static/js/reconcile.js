/** Reconcile trusted app-generated markup while preserving surviving controls, focus and scroll. */
const rendered=new WeakMap();
export const forgetMarkup=host=>rendered.delete(host);
const key=node=>node.nodeType===1?(node.id||['data-id','data-need','data-need-group','data-offer','data-control'].map(a=>node.getAttribute(a)).find(v=>v!==null)||(node.tagName==='OPTION'?`option:${node.getAttribute('value')}`:null)):null;
function compatible(a,b){return a.nodeType===b.nodeType&&(a.nodeType!==1||a.tagName===b.tagName)&&key(a)===key(b);}
function children(parent,target){
 const old=[...parent.childNodes],keyed=new Map(old.filter(n=>key(n)!==null).map(n=>[key(n),n])),used=new Set();
 for(const [index,next] of [...target.childNodes].entries()){
  const candidate=key(next)!==null?keyed.get(key(next)):old[index];let current=candidate&&!used.has(candidate)&&compatible(candidate,next)?candidate:null;
  if(!current)current=next.cloneNode(true);else patch(current,next);used.add(current);
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
/** HTML comes only from existing escaped presentation helpers; never pass arbitrary source HTML. */
export function reconcileMarkup(host,html,{fallback=()=>document.getElementById('view-toggle')}={}){
 if(rendered.get(host)===html)return;
 const template=document.createElement('template');template.innerHTML=html;
 const active=document.activeElement,hadFocus=active&&host.contains(active),top=host.scrollTop;
 children(host,template.content);rendered.set(host,html);
 if(hadFocus&&document.activeElement!==active){if(active.isConnected)active.focus({preventScroll:true});else fallback()?.focus({preventScroll:true});}
 if(host.scrollTop!==top)host.scrollTop=top;
}
