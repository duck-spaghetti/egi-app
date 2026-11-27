/** Original shared metre-space meshes; vertex colors and panel UVs need no external model/font. */
export const ATLAS_URL='/static/img/transport/boards.svg';
import {SIGN_SCALE} from '../transport/paline-gl.js';
export {SIGN_SCALE};
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
/** Non-indexed triangles keep per-face colors/UVs explicit and bounded. */
function builder(){
 const values=[];
 function face(points,color,uv=null){const c=rgb(color);for(const i of [0,1,2,0,2,3])values.push(...points[i],...c,...(uv?uv[i]:[2,2]));}
 function box(x,y,z,w,d,h,color){const a=x-w/2,b=x+w/2,c=y-d/2,e=y+d/2,f=z+h;
  face([[a,c,z],[b,c,z],[b,c,f],[a,c,f]],color);face([[b,e,z],[a,e,z],[a,e,f],[b,e,f]],color);
  face([[a,e,z],[a,c,z],[a,c,f],[a,e,f]],color);face([[b,c,z],[b,e,z],[b,e,f],[b,c,f]],color);
  face([[a,c,f],[b,c,f],[b,e,f],[a,e,f]],color);face([[a,e,z],[b,e,z],[b,c,z],[a,c,z]],color);
 }
 return {face,box,mesh:()=>new Float32Array(values)};
}
/** One pole and one two-sided board, scaled like the established enlarged signs. */
export function signMeshes(){
 const pole=builder();pole.box(0,0,0,.15,.15,2.3,'#ffffff');
 const board=builder();board.box(0,0,2.05,.65,.18,.65,'#ffffff');
 // Replace the two vertical faces with atlas coordinates, same front-readable UVs on each face.
 const mesh=board.mesh(),uv=[[0,1],[1,1],[1,0],[0,0]];for(let face=0;face<2;face++)for(const [j,i] of [0,1,2,0,2,3].entries()){mesh[face*48+j*8+6]=face?1-uv[i][0]:uv[i][0];mesh[face*48+j*8+7]=uv[i][1];}
 return {pole:pole.mesh(),board:mesh};
}
/** A reusable north-facing bus: body, windshield, side windows, wheels and rear lamps. */
export function busMesh(distant=false){
 const b=builder();b.box(0,0,.65,4,18,3.5,'#e9bd27');if(distant){b.box(0,-7.6,3.9,3.3,2,.9,'#224655');return b.mesh();}
 b.box(0,0,4.15,3.7,17,.65,'#ede5c7');
 for(const y of [-9.08,9.08])b.box(0,y,.7,3.8,.12,.25,'#42484b');
 b.box(0,2,4.5,2.1,3,.3,'#d9d3b9');b.box(2.06,-5,1,.04,2.1,2.7,'#294956');
 b.box(0,-9.03,1.7,3.4,.04,2.25,'#214656'); // Front (north) differs clearly from yellow rear.
 for(const x of [-2.03,2.03]){b.box(x,-.4,2.1,.04,13,1.5,'#335869');for(const y of [-5.8,5.8])b.box(x,y,.1,.25,1.8,1.45,'#303436');}
 for(const x of [-1.25,1.25]){b.box(x,9.03,1.1,.55,.05,.65,'#a82d32');b.box(x,-9.06,1,.5,.05,.25,'#fff1cb');}
 return b.mesh();
}
/** Transform vertices exactly as the GPU: city-local metres, per-anchor scale, vertical board yaw. */
export function worldVertex(vertex,record,kind,bearing,progress){
 let [x,y,z]=vertex;const sign=kind<2,angle=sign?(kind===1?bearing:0):record.bearing||0,a=angle*Math.PI/180;
 const scale=record.scale*(sign?SIGN_SCALE*progress:1);x*=scale;y*=scale;z*=scale;
 return [record.x+x*Math.cos(a)-y*Math.sin(a),record.y+x*Math.sin(a)+y*Math.cos(a),record.z+z];
}
