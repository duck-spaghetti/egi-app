/** Load actual ES Modules unchanged; callers and tests cross the same Imports. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {element}=require('./dom_fixture.cjs');
function environment(extra={},fixture=null){
 const unsupported=()=>{throw Error('Unsupported DOM operation in strict fixture');};
 const make=(tag)=>fixture?{...element(tag),querySelector:unsupported,querySelectorAll:unsupported}:element(tag);
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
