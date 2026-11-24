import {CycleLayer} from './layer.js';
/** Own the optional cycle overlay without exposing its mutable handles. */
export function createCycleways() {
 let layer=null;
 return {mount(attach){layer=attach(map=>CycleLayer.create(map,{toggle:document.getElementById('cycle-toggle'),status:document.getElementById('cycle-status')}));},
 dispose(){layer?.dispose();layer=null;}};
}
