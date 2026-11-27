/** Load actual ES Modules unchanged; callers and tests cross the same Imports. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function element(){
 const classes=new Set(),listeners={};
 return {dataset:{},style:{},hidden:false,value:'',innerHTML:'',textContent:'',children:[],isConnected:true,selectedOptions:[],
 classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,on){if(on??!classes.has(x))classes.add(x);else classes.delete(x);}},
 setAttribute(){},toggleAttribute(){},getClientRects:()=>[{}],addEventListener(name,fn){listeners[name]=fn;},
 querySelector:()=>element(),querySelectorAll:()=>[],append(x){this.children.push(x);},appendChild(x){this.children.push(x);},replaceChildren(){this.children=[];},focus(){},scrollTo(){},contains:()=>true,
 click(){listeners.click?.({target:this});},dispatch(name,event){listeners[name]?.(event);}};
}
function environment(extra={},fixture=null){
 const unsupported=()=>{throw Error('Unsupported DOM operation in strict fixture');};
 const make=()=>fixture?{...element(),querySelector:unsupported,querySelectorAll:unsupported}:element();
 const elements=new Map((fixture?.nodes || []).map(id=>[id,make()]));
 const get=id=>{
  if(fixture && !elements.has(id)){
   if(fixture.optional?.includes(id))return null;
   throw Error('Missing required DOM node: '+id);
  }
  if(!elements.has(id))elements.set(id,make());return elements.get(id);
 };
 const document={getElementById:get,querySelector:fixture?unsupported:get,querySelectorAll:fixture?unsupported:()=>[],createElement:make,addEventListener(){},documentElement:{},title:''};
 const context=vm.createContext({console,AbortController,AbortSignal,DOMException,URL,URLSearchParams,structuredClone,setTimeout,clearTimeout,setInterval,clearInterval,
 window:{location:{origin:'http://localhost'},clearTimeout,setTimeout,clearInterval},location:{search:''},navigator:{},document,...extra});
 const root=path.resolve(__dirname,'../app/frontend/static/js'),modules=new Map();
 function getModule(file){
  file=path.resolve(file);if(!modules.has(file))modules.set(file,new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{context,identifier:file}));
  return modules.get(file);
 }
 async function load(name){
  const module=getModule(path.join(root,name));
  if(module.status==='unlinked')await module.link((specifier,parent)=>getModule(path.resolve(path.dirname(parent.identifier),specifier)));
  if(module.status==='linked')await module.evaluate();return module.namespace;
 }
 return {load,context,document,elements,get};
}
/** Integration assertions declare nodes; legacy unit-only fakes remain explicit. */
function strictEnvironment(fixture,extra={}){return environment(extra,fixture);}
module.exports={environment,strictEnvironment,element};
