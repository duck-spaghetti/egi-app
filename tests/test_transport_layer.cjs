/* Exercise the real popupopen handler: OSM stops must never fetch departures. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {environment} = require('./module_fixture.cjs');

async function main() {
  const requests = [], markers = [],routes=[],extra=[],frames=new Map();let frameId=0;
  const element = () => ({hidden:false, classList:{toggle(){}}, setAttribute(){}, addEventListener(){}, appendChild(){}, querySelector:()=>element()});
  const bounds = {getWest:()=>12, getSouth:()=>41, getEast:()=>13, getNorth:()=>43};
  const map = {getContainer:()=>element(), getPane:()=>null, createPane:()=>({style:{}}), on(){}, once(){}, getSize:()=>({x:800,y:600}), getBounds:()=>bounds, getZoom(){return this.zoom||14;}};
  const feature = {type:'Feature',geometry:{type:'Point',coordinates:[12.5,41.9]},properties:{kind:'stop',transport_type:'rail',stop_id:'osm:node:1',name:'Roma',untimed:true,routes:[{route_id:'osm:Metromare',code:'Metromare',mode:'rail'}]}};
  const sandbox = {
    document:{createElement:()=>element()}, URLSearchParams, AbortController,
    setTimeout:()=>1, clearTimeout(){}, setInterval(){},
    requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id),
    fetch: async url => {
      requests.push(url);
      return {ok:true,json:async()=>url==='/api/preview/transport'
        ? {availability:'available',features:[feature,...extra]}
        : {availability:'available',departures:[],alerts:[]}};
    },
    L:{
      layerGroup:()=>({addTo(){return this;},clearLayers(){},remove(){[...markers,...routes].forEach(m=>m.handlers.popupclose?.());}}),
      geoJSON:()=>{const line={handlers:{},bindPopup(){return this;},on(name,fn){this.handlers[name]=fn;return this;},addTo(){return this;}};routes.push(line);return line;},
      DomEvent:{disableClickPropagation(){}}, divIcon:options=>options,
      marker:(ll,options)=>{
        const marker = {ll,options,handlers:{},getElement:()=>element(),bindPopup(){return this;},on(name,handler){this.handlers[name]=handler;return this;},addTo(){return this;}};
        markers.push(marker);
        return marker;
      },
    },
  };
  sandbox.TransportLayer=(await environment(sandbox).load('features/transport/layer.js')).TransportLayer;
  const layer = sandbox.TransportLayer.create(map,{});
  layer.setVisible(true);
  await layer.reload();
  markers.at(-1).handlers.popupopen({popup:{isOpen:()=>true,setContent(){}}});
  await new Promise(setImmediate);
  assert.equal(requests.length,1,'Untimed popup must not request a timetable');
  markers.at(-1).handlers.popupclose();
  feature.properties = {...feature.properties,untimed:false,stop_id:'timed-stop'};
  await layer.reload();
  markers.at(-1).handlers.popupopen({popup:{isOpen:()=>true,setContent(){}}});
  await new Promise(setImmediate);
  assert.equal(requests.filter(url=>url.startsWith('/api/preview/transit/departures?')).length,1,'Timed popup must still load departures');
  markers.at(-1).handlers.popupclose();map.zoom=19;extra.push({type:'Feature',geometry:{type:'LineString',coordinates:[[12.5,41.9],[12.51,41.91]]},properties:{transport_type:'rail',route_id:'line',code:'REG'}});await layer.reload();
  const anchored=markers.at(-1);assert(anchored.options.icon.html.includes('tl-ground'));assert.equal(JSON.stringify(anchored.ll),JSON.stringify([41.9,12.5]));assert.equal(JSON.stringify(anchored.options.icon.iconAnchor),'[0,0]');
  const before=frameId;routes.at(-1).handlers.popupopen();assert(frameId>before,'line popup without auto-pan refreshes name collisions');
  await layer.reload();layer.dispose();assert.equal(frames.size,0,'Leaflet child popup teardown cannot restart label work');
  console.log('PASS: untimed popup skips departures; timed popup still fetches them');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
