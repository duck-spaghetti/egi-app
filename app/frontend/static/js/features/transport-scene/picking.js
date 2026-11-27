import {worldVertex} from './geometry.js';
/** CPU exact-triangle candidates only; native-building visibility is established separately by GPU query. */
export function signCandidates(records,meshes,matrix,bearing,progress,point,width,height){
 const project=p=>{const v=[0,0,0,0];for(let r=0;r<4;r++){v[r]=matrix[12+r];for(let c=0;c<3;c++)v[r]+=matrix[c*4+r]*p[c];}return v[3]<=0?null:[(v[0]/v[3]+1)*width/2,(1-v[1]/v[3])*height/2,v[2]/v[3]];};
 const hits=[];if(progress<=0)return hits;
 for(const record of records){let depth=Infinity,hitKind=null;
  for(const [kind,mesh] of meshes.entries())for(let i=0;i<mesh.length;i+=24){
   const v=[0,8,16].map(o=>project(worldVertex(mesh.subarray(i+o,i+o+3),record,kind,bearing,progress)));if(v.some(p=>!p))continue;
   const [a,b,c]=v,d=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(d)<1e-9)continue;
   const x=((b[1]-c[1])*(point.x-c[0])+(c[0]-b[0])*(point.y-c[1]))/d,y=((c[1]-a[1])*(point.x-c[0])+(a[0]-c[0])*(point.y-c[1]))/d,z=1-x-y;
   if(x>=0&&y>=0&&z>=0){const distance=x*a[2]+y*b[2]+z*c[2];if(distance<depth){depth=distance;hitKind=kind;}}
  }
  if(depth>=-1&&depth<=1)hits.push({record,depth,kind:hitKind});
 }
 return hits.sort((a,b)=>a.depth-b.depth||a.record.key.localeCompare(b.record.key)).slice(0,8);
}
