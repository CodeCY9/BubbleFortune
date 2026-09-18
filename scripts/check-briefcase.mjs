// Inspect the actual exported animation and project its complete swept envelope.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const layouts = JSON.parse(fs.readFileSync('src/stage-layout.json', 'utf8'));
// Historical geometry remains testable, without shipping the retired 16-box layout.
layouts['16'] = JSON.parse(fs.readFileSync('art/stage-basic/legacy/stage-layout-16.json', 'utf8'));
const report = { date: new Date().toISOString(), assets: [], stages: [], layouts: [], errors: [] };
const loader = new GLTFLoader();
// Geometry check only; real texture decoding and appearance are verified in-browser.
loader.register(() => ({ name: 'GeometryInspection', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
const load = async path => {
  const data = fs.readFileSync(path);
  const gltf = await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
  return { gltf, hash: crypto.createHash('sha256').update(data).digest('hex'), bytes: data.length };
};
function hull(points) {
  const p = points.map(v => [v.x, v.y]).sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  const cross = (o,a,b) => (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const half = arr => { const h=[]; for(const q of arr) { while(h.length>1 && cross(h.at(-2),h.at(-1),q)<=0)h.pop(); h.push(q); } return h; };
  return [...half(p).slice(0,-1), ...half(p.reverse()).slice(0,-1)];
}
function intersects(a,b) {
  for(const poly of [a,b]) for(let i=0;i<poly.length;i++) {
    const next=poly[(i+1)%poly.length]; const axis=[-(next[1]-poly[i][1]),next[0]-poly[i][0]];
    const pa=a.map(p=>p[0]*axis[0]+p[1]*axis[1]);const pb=b.map(p=>p[0]*axis[0]+p[1]*axis[1]);
    if(Math.max(...pa)<=Math.min(...pb) || Math.max(...pb)<=Math.min(...pa))return false;
  }
  return true;
}

for(const count of [16,26]) {
  const layout=layouts[count];
  const stagePath = count === 16 ? 'art/stage-basic/legacy/runtime/' + layout.stage.split('/').at(-1) : 'public'+layout.stage;
  const {gltf,hash,bytes}=await load(stagePath);
  gltf.scene.updateMatrixWorld(true);
  const stageMeshes=[];gltf.scene.traverse(o=>{if(o.isMesh)stageMeshes.push(o);});
  assert.equal(stageMeshes.length,4,'Exactly one studio stage with four material batches');
  let supported=0;
  for(const [i,s] of layout.slots.entries()) {
    const socket=gltf.scene.getObjectByName('BoxSlot_'+String(i).padStart(2,'0'));
    assert.ok(socket,'Export must contain every socket');
    assert.ok(socket.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(...s.position))<.00001,'Runtime and Blender sockets must match');
    assert.ok(socket.getWorldQuaternion(new THREE.Quaternion()).angleTo(new THREE.Quaternion().setFromEuler(new THREE.Euler(...s.rotation)))<.00001,'Socket and runtime orientation must match');
    const transform=new THREE.Matrix4().compose(new THREE.Vector3(...s.position),new THREE.Quaternion().setFromEuler(new THREE.Euler(...s.rotation)),new THREE.Vector3(1,1,1));
    for(const x of [-.70,0,.70])for(const z of [-.251,.35,.960]) {
      const p=new THREE.Vector3(x,.01,z).applyMatrix4(transform);
      const hits=new THREE.Raycaster(p,new THREE.Vector3(0,-1,0),0,.05).intersectObjects(stageMeshes,false);
      if(hits.length && Math.abs(hits[0].point.y-s.position[1])<.003)supported++;
      else report.errors.push(`Stage ${count} slot ${i+1}: unsupported footprint sample ${x},${z}`);
    }
  }
  report.stages.push({count,hash,bytes,supportedSamples:supported,triangles:stageMeshes.reduce((n,m)=>n+(m.geometry.index?.count??m.geometry.attributes.position.count)/3,0)});
}

for(const name of ['BF_Briefcase_v009.glb','BF_Briefcase_v009_low.glb']) {
  const {gltf,hash,bytes}=await load('public/assets/models/runtime/'+name);
  const clip=gltf.animations.find(c=>c.name==='Chest_Open');assert.ok(clip,'Opening clip must be exported');
  const mixer=new THREE.AnimationMixer(gltf.scene);const action=mixer.clipAction(clip);action.play();
  const meshes=[];const materials=new Set();gltf.scene.traverse(o=>{if(o.isMesh){meshes.push(o);materials.add(o.material.uuid);}});
  const sweep=[];const poses=[];
  for(let frame=0;frame<=60;frame++) {
    action.time=clip.duration*frame/60; action.paused=true;mixer.update(0);gltf.scene.updateMatrixWorld(true);
    const points=[];
    for(const mesh of meshes) {
      const pos=mesh.geometry.attributes.position;
      for(let i=0;i<pos.count;i++)points.push(new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld));
    }
    const box=new THREE.Box3().setFromPoints(points);poses.push({frame,min:box.min.toArray(),max:box.max.toArray()});
    // Per-pose bounds are a conservative envelope around all real vertices.
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])sweep.push(new THREE.Vector3(x,y,z));
  }
  const endNormal=new THREE.Vector3(0,-1,0).transformDirection(gltf.scene.getObjectByName('BF_Case_LidPivot').matrixWorld);
  const lidAngle=Math.acos(THREE.MathUtils.clamp(endNormal.y,-1,1))*180/Math.PI;
  assert.ok(Math.abs(lidAngle-80)<.1,'Inner lid normal must tilt 10 degrees upward (100-degree opening)');
  const bounds=new THREE.Box3().setFromPoints(sweep);
  if(bounds.min.y<-.005)report.errors.push(name+': below podium');
  if(bounds.min.x<-.89 || bounds.max.x>.89 || bounds.min.z<-.36 || bounds.max.z>1.10)report.errors.push(name+': animation leaves own podium');
  report.assets.push({name,hash,bytes,triangles:meshes.reduce((n,m)=>n+(m.geometry.index?.count??m.geometry.attributes.position.count)/3,0),meshes:meshes.length,materials:materials.size,clipSeconds:clip.duration,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},poses});

  for(const count of [16,26]) {
    const layout=layouts[count];
    const transforms=layout.slots.map(s=>new THREE.Matrix4().compose(new THREE.Vector3(...s.position),new THREE.Quaternion().setFromEuler(new THREE.Euler(...s.rotation)),new THREE.Vector3(1,1,1)));
    const world=transforms.map(m=>sweep.map(p=>p.clone().applyMatrix4(m)));
    const ground=world.map(ps=>hull(ps.map(p=>new THREE.Vector3(p.x,p.z,0))));
    const physical=[];
    for(let i=0;i<count;i++)for(let j=i+1;j<count;j++)if(intersects(ground[i],ground[j]))physical.push([i+1,j+1]);
    if(physical.length)report.errors.push(name+': '+count+' physical overlap '+JSON.stringify(physical));
    for(const [width,height] of [[760,620],[920,800],[390,540]]) {
      const aspect=width/height;const distance=Math.max(4.5,6.5/(Math.tan(THREE.MathUtils.degToRad(24))*aspect)-5);
      const camera=new THREE.PerspectiveCamera(48,aspect,.1,80);camera.position.set(0,2.8,-distance);camera.lookAt(0,count===16?2:3.4,8);camera.updateMatrixWorld(true);
      const projected=world.map(ps=>hull(ps.map(p=>p.clone().project(camera))));
      const overlaps=[];let clipped=0;
      for(let i=0;i<count;i++) {
        if(projected[i].some(p=>Math.abs(p[0])>1 || Math.abs(p[1])>1))clipped++;
        for(let j=i+1;j<count;j++)if(intersects(projected[i],projected[j]))overlaps.push([i+1,j+1]);
      }
      report.layouts.push({asset:name,count,width,height,physicalOverlaps:physical,projectedOverlaps:overlaps,clipped});
      if(overlaps.length || clipped)report.errors.push(`${name} ${count} ${width}x${height}: ${overlaps.length} projected overlaps, ${clipped} clipped`);
    }
  }
}
fs.writeFileSync('art/chest-standard/validation/runtime-sweep-v009.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({assets:report.assets.map(({poses,...rest})=>rest),layouts:report.layouts,errors:report.errors},null,2));
assert.equal(report.errors.length,0,'See runtime-sweep.json');
