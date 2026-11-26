import {CycleLayer} from './layer.js';
import {CycleLayerGL} from './layer-gl.js';
/** Own the optional cycle overlay without exposing its mutable handles. */
export function createCycleways() {
 let layer=null;
 return {mount(attach){layer=attach((map,engine)=>(engine?.maplibre?(m,e)=>CycleLayerGL.create(m,e,engine.maplibre):CycleLayer.create)(map,{toggle:document.getElementById('cycle-toggle'),status:document.getElementById('cycle-status')}));},
 dispose(){layer?.dispose();layer=null;}};
}
