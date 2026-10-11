import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {getConfig,getLayout} from '@wangxu/rules';
import {SCENE,SCENE_MATERIALS,OBJECT_FOOTPRINT,type WorldObject} from '@wangxu/shared';
import {groundPolygons,foundationGeometry,pavingGeometry} from '../apps/web/src/ground-geometry';
import {groundTexturePaths,materialPaths,PROFESSION_ART,RETAINED_CLIPS} from '../apps/web/src/art-config';
import {assembleArt,landmarkParts,attachmentParts,fallbackArtMaterials,disposeArtGeometry} from '../apps/web/src/art-geometry';
const root=new URL('../apps/web/public/',import.meta.url);
const glb=(path:string)=>{const b=readFileSync(new URL(path.slice(1),root));return JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString());};
describe('continuous stone foundations',()=>{
  for(let players=4;players<=10;players++)for(let seed=0;seed<3;seed++)it(`${players} players / layout ${seed}: extrudes the paving boundary with finite outward normals`,()=>{
    const layout=getLayout(getConfig(players),seed),nodes=layout.nodes.map(n=>({...n,x:(n.x-500)/20,y:(n.y-350)/20,radius:n.radius/20}));
    const polygons=groundPolygons(nodes,layout.edges,SCENE.corridorRadius/20),g=foundationGeometry(polygons.foundation),p=g.getAttribute('position'),normal=g.getAttribute('normal'),index=g.getIndex()!;
    expect(index.count).toBe(polygons.foundation.reduce((n,poly)=>n+poly.reduce((n,ring)=>n+(ring.length-1)*6,0),0));
    for(let i=0;i<p.count;i++){expect([p.getX(i),p.getY(i),p.getZ(i)].every(Number.isFinite)).toBe(true);expect(p.getY(i)).toBeCloseTo(i%4<2?0:-.6,5);expect(normal.getY(i)).toBeCloseTo(0,6);expect(Math.hypot(normal.getX(i),normal.getZ(i))).toBeCloseTo(1,5);}
    const top=pavingGeometry(polygons.floor,SCENE_MATERIALS.floor.meters);for(let i=0;i<top.getAttribute('position').count;i++)expect(top.getAttribute('normal').getY(i)).toBeCloseTo(1,5);top.dispose();g.dispose();
  });
  it('exposes a hole wall inward and an outer wall outward without an internal corridor wall',()=>{
    const outer:[[number,number][]]=[[[0,0],[4,0],[4,4],[0,4],[0,0]]],hole:[number,number][]=[[1,1],[1,3],[3,3],[3,1],[1,1]];
    const g=foundationGeometry([[outer[0],hole]]),p=g.getAttribute('position'),n=g.getAttribute('normal');
    for(let i=0;i<p.count;i+=4){const x=(p.getX(i)+p.getX(i+1))/2-2,z=(p.getZ(i)+p.getZ(i+1))/2-2,dot=x*n.getX(i)+z*n.getZ(i);expect(i<16?dot:-dot).toBeGreaterThan(0);}
    const rooms=[{id:'a',name:'A',x:0,y:0,radius:2},{id:'b',name:'B',x:6,y:0,radius:2}],polygons=groundPolygons(rooms,[['a','b']],.5);
    for(const poly of polygons.foundation)for(const ring of poly)for(let i=0;i<ring.length-1;i++){const a=ring[i],b=ring[i+1];expect(Math.abs((a[1]+b[1])/2)<.4&&Math.abs(a[0]-b[0])<1e-6&&a[0]>1.5&&a[0]<4.5).toBe(false);}g.dispose();
  });
});
describe('facility bounds and profession assets',()=>{
  const materials=fallbackArtMaterials();
  for(const [kind,id]of [['beacon','beacon-0'],['altar','altar-0'],['cleanse','cleanse'],['cleanse','purify'],['exit','exit']] as const)it(`${id} fits its authoritative footprint`,()=>{
    const group=assembleArt(landmarkParts(kind,id),materials,id);group.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(group);expect(bounds.min.y).toBeGreaterThanOrEqual(-1e-6);expect(group.children.length).toBeLessThanOrEqual(3);
    group.traverse(n=>{if(n instanceof THREE.Mesh){const p=n.geometry.getAttribute('position');for(let i=0;i<p.count;i++)expect(Math.hypot(p.getX(i),p.getZ(i))).toBeLessThanOrEqual(OBJECT_FOOTPRINT[kind]/20+1e-6);}});disposeArtGeometry(group);
  });
  it('keeps every requested bone and clip while removing unselected equipment and animation buffers',()=>{
    const manifest=JSON.parse(readFileSync(new URL('assets/manifest.json',root),'utf8'));
    for(const [profession,entry] of Object.entries(manifest.characters) as [keyof typeof PROFESSION_ART,{path:string;appearance:string}][]){
      expect(entry.appearance).toBe(profession);const j=glb(entry.path),names=new Set(j.nodes.map((n:{name:string})=>n.name));
      for(const a of PROFESSION_ART[profession].attachments)expect(names.has(attachmentParts(a).bone)).toBe(true);
      expect(j.animations.map((a:{name:string})=>a.name).sort()).toEqual([...RETAINED_CLIPS].sort());expect(j.skins[0].joints).toHaveLength(41);
      const referenced=new Set(j.meshes.flatMap((m:{primitives:{attributes:Record<string,number>;indices?:number}[]})=>m.primitives.flatMap(p=>[...Object.values(p.attributes),p.indices].filter(x=>x!==undefined))));
      for(const a of j.animations)for(const s of a.samplers){referenced.add(s.input);referenced.add(s.output);}for(const s of j.skins)referenced.add(s.inverseBindMatrices);
      expect(referenced.size).toBe(j.accessors.length);
    }
  });
  it('loads no normal map at the lowest quality and points every requested map at a shipped file',()=>{
    const manifest=JSON.parse(readFileSync(new URL('assets/materials/manifest.json',root),'utf8')),files=new Set(manifest.files.map((f:{file:string})=>f.file));
    for(const id of Object.keys(manifest.materials))for(const normal of [false,true]){const paths=materialPaths(id,normal);expect(Object.values(paths).some(p=>p.includes('_normal_'))).toBe(normal);for(const path of Object.values(paths))expect(files.has(path)).toBe(true);}
    for(const normal of [false,true])for(const resolution of ['1k','2k'])for(const id of ['plaza','road']){const paths=groundTexturePaths(id,{normal,resolution});expect(Object.keys(paths).includes('normal')).toBe(normal);for(const path of Object.values(paths))expect(files.has(path)).toBe(true);}
    expect(SCENE_MATERIALS.floor.meters).toBe(2.7);expect(SCENE_MATERIALS.road.meters).toBe(3.3);
  });
});
