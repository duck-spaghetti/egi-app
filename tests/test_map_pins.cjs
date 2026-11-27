/** Shared site pin markup: single service, multi-category site, missing icon (no Leaflet). */
const assert=require('node:assert/strict');const {environment}=require('./module_fixture.cjs');
(async()=>{
 const env=environment();const {pinHtml,iconPath,siteMarkers}=await env.load('features/map/pins.js');
 const food={slug:'mangiare',label:'Mangiare',color:'#f00',icon_path:'icons/food.svg'},
       bed={slug:'dormire',label:'Dormire',color:'#00f',icon_path:''};
 const describe=poi=>({category:poi.cat,kind:poi.id===3?'Dormitorio':'Mensa'});
 const single=pinHtml({cat:food},describe);
 assert.match(single,/site-pin single/);assert.match(single,/<img src="\/static\/assets\/icons\/food.svg"/);
 assert.match(single,/conic-gradient\(#f00 0% 100%\)/);
 assert.match(pinHtml({cat:bed},describe),/single-pin-icon">D</,'missing icon falls back to the initial');
 assert.equal(iconPath('javascript:alert(1)'),null);assert.equal(iconPath('/static/assets/icons/a b.svg'),'/static/assets/icons/a b.svg');
 const pois=[{id:1,cat:food,latitude:41.9,longitude:12.5,title:'A'},{id:2,cat:food,latitude:41.9,longitude:12.5,title:'A'},{id:3,cat:bed,latitude:41.9,longitude:12.5,title:'A',raw:{facility_name:'Casa'}}];
 const sites={groups:list=>[list],siblings:poi=>pois.filter(p=>p.latitude===poi.latitude)};
 const [site]=siteMarkers(pois,{sites,describe});
 assert.deepEqual(Array.from(site.kinds),['Mensa','Dormitorio']);assert.equal(site.lat,41.9);assert.match(site.html,/site-pin multi/);assert.match(site.html,/<span class="site-total">3</);
 assert.match(site.html,/#f00 0% 66.66/);assert.match(site.html,/#00f 66.66[0-9]*% (100|99.9+)%/);
 assert.match(site.label,/^A: 3 servizi · /);
 const chosen=site.choose();assert.equal(chosen.items.length,3);assert.deepEqual([...chosen.matched],[1,2,3]);
 console.log('PASS: shared pin markup, labels and selection payload');
})().catch(error=>{console.error(error);process.exitCode=1;});
