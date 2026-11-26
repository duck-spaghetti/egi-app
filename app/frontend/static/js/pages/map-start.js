import {startMapPage} from './map.js';
import {viewMode,hasWebGL2} from '../features/map/view.js';
/** Start the map page in the current map or, when chosen and available, in 3D mode. */
const context=window.EGI_MAP_CONTEXT;
let local=null;try{local=window.localStorage;}catch{local=null;}
const view=viewMode({search:location.search,storage:local,context,webgl2:hasWebGL2(document)});
context.view=view;
if(view.mode==='3d'){
 try{
  const [{loadMap3dLibraries},{createMap3d},{createWalking},{createBuses}]=await Promise.all([import('../features/map3d/load.js'),import('../features/map3d/index.js'),import('../features/walking/index.js'),import('../features/buses/index.js')]);
  const libraries=await loadMap3dLibraries();
  startMapPage(context,{factories:{map:args=>createMap3d({...args,...libraries}),walking:args=>createWalking({...args,pmtiles:libraries.pmtiles}),buses:createBuses}});
 }catch(error){
  context.view={...view,mode:'2d',available:false,reason:'load'};
  startMapPage(context);
 }
}else startMapPage(context);
