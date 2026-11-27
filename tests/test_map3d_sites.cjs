const assert=require('node:assert/strict');const {environment}=require('./module_fixture.cjs');
(async()=>{
 const {clusterSites,clusterAppearance,siteLabel,placeSiteHeads,hitsMapControls,MAX_HEAD_OFFSET}=await environment().load('features/map3d/sites.js');
 const project=([x,y])=>({x,y}),sites=[{lng:63,lat:10},{lng:65,lat:10},{lng:200,lat:10}];
 assert.deepEqual(Array.from(clusterSites(sites,project,14),g=>g.members.length).sort(),[1,2],'neighbours across grid boundary merge');
 assert.equal(clusterSites(sites,project,16).length,3,'close zoom preserves each site');
 const groups=clusterSites(Array.from({length:1000},(_,i)=>({lng:i%40*10,lat:Math.floor(i/40)*10})),project,12);
 assert.equal(groups.reduce((n,g)=>n+g.members.length,0),1000,'no site lost or duplicated');
 for(let a=0;a<groups.length;a++)for(let b=a+1;b<groups.length;b++)assert(Math.hypot(groups[a].point.x-groups[b].point.x,groups[a].point.y-groups[b].point.y)>=64);
 assert(clusterAppearance(64).size>clusterAppearance(2).size);assert.notEqual(clusterAppearance(64).background,clusterAppearance(2).background);
 const close=[0,1,2].map(i=>({site:{serviceIds:[String(i)]},members:[{}],lngLat:[12.5+i*.00001,41.9],point:{x:400+i*4,y:350+i*2}}));
 const view={width:1000,height:700,zoom:17};assert(hitsMapControls({left:50,right:100,top:180,bottom:240},view),'new left camera rail is reserved');assert(hitsMapControls({left:900,right:980,top:100,bottom:160},view),'right mode rail remains reserved');assert(hitsMapControls({left:900,right:980,top:180,bottom:240},{...view,rtl:true}),'RTL camera rail is reserved opposite modes');assert(!hitsMapControls({left:300,right:360,top:180,bottom:240},view));assert(hitsMapControls({left:300,right:360,top:180,bottom:240},{...view,controls:[{left:310,right:340,top:170,bottom:250}]}),'measured control bounds override fallback rails');const heads=placeSiteHeads(close,view),overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
 const denseHeads=Array.from({length:8},(_,i)=>({site:{serviceIds:[String(i)]},members:[{}],point:{x:400+i*2,y:350},lngLat:[12.5+i*.00001,41.9]}));
 const compact=placeSiteHeads(denseHeads,view);assert(Math.max(...[...compact.values()].map(p=>Math.hypot(p.dx,p.dy-21)))<=64,'dense service leaders remain within64px instead of89px');
 const positions=[...heads.values()];assert(positions.some(p=>p.dx||p.dy));for(let i=0;i<positions.length;i++){assert(Math.hypot(positions[i].dx,positions[i].dy)<=MAX_HEAD_OFFSET);for(let j=0;j<i;j++)assert(!overlap(positions[i].box,positions[j].box),'distinct close heads must not overlap');}
 const reordered=placeSiteHeads([...close].reverse(),view);for(const group of close)assert.deepEqual({...heads.get(group)},{...reordered.get(group)},'stable identity order prevents pan jitter');
 const mobileClose=close.map((g,i)=>({...g,point:{x:195+i*3,y:400+i*2}}));const mobileHeads=[...placeSiteHeads(mobileClose,{width:390,height:844,zoom:17}).values()];for(let i=0;i<mobileHeads.length;i++)for(let j=0;j<i;j++)assert(!overlap(mobileHeads[i].box,mobileHeads[j].box),'mobile nearby heads stay separate');
 assert.equal(placeSiteHeads(close,{...view,zoom:13}).size,0,'overview clusters retain their established layout');
 assert.equal(placeSiteHeads(close,{...view,selectedId:'2'}).get(close[2]).dx,0,'selected site keeps the first placement');
 const t=(k,p,f)=>f,site={name:'<script>',label:'name',categories:[{label:'A&B'}],statuses:[{kind:'closing',label:'Chiude presto · da verificare',note:'<test>'}]};
 assert(!siteLabel(site,false,t).includes('A&amp;B'),'names before details');
 const html=siteLabel(site,true,t);assert(html.includes('&lt;script&gt;'));assert(!html.includes('map3d-category-row'),'single category icon is not repeated');assert(html.includes('status closing'));assert(html.includes('da verificare'));assert(!html.includes('<test>'));
 const kind=siteLabel({...site,kinds:['Mensa & accoglienza']},true,t);assert(kind.includes('Mensa &amp; accoglienza'));assert(!kind.includes('map3d-category-row'));
 const all=siteLabel({...site,allCategories:[{slug:'first',label:'Visible'},{slug:'second',label:'Other service',matched:false}]},true,t);assert(all.includes('Other service'));assert(all.includes('outside-search'));assert(all.includes('fuori dai filtri'));
 const mixed=siteLabel({...site,statuses:[{kind:'closed',label:'Chiuso'},{kind:'unknown',label:'Non noto'}]},true,t);assert(mixed.includes('Orario non disponibile'));assert(!mixed.includes('</i>Chiuso'));
 const unverified=siteLabel({...site,statuses:[1,2].map(()=>({kind:'open',label:'Aperto · da verificare',verificationLabel:'da verificare'}))},true,t);assert(unverified.includes('</i>da verificare · 2/2 servizi aperti'));
 assert.equal(clusterAppearance(64).ink,'#000');
 console.log('PASS: neighbour clusters, count presentation, site conservation, progressive safe labels and honest mixed status');
})().catch(e=>{console.error(e);process.exitCode=1;});
