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
function environment(extra={}){
 const elements=new Map();const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 const document={getElementById:get,querySelector:get,querySelectorAll:()=>[],createElement:element,addEventListener(){},documentElement:{},title:''};
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
module.exports={environment,element};
