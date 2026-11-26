import {CycleLayer} from './layer.js';
import {isMapLibre,inertLayer} from '../map/engine.js';
/** Own the optional cycle overlay without exposing its mutable handles. */
export function createCycleways() {
 let layer=null;
 return {mount(attach){layer=attach(map=>isMapLibre(map)?inertLayer():CycleLayer.create(map,{toggle:document.getElementById('cycle-toggle'),status:document.getElementById('cycle-status')}));},
 dispose(){layer?.dispose();layer=null;}};
}
