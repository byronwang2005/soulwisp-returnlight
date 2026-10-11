import clipping,{type MultiPolygon,type Polygon} from 'polygon-clipping';
import * as THREE from 'three';
import type {MapNode} from '@wangxu/shared';

export function groundPolygons(nodes:MapNode[],edges:[string,string][],corridorRadius:number) {
  const rooms:Polygon[]=nodes.map(n=>[Array.from({length:128},(_,i)=>[n.x+Math.cos(i*Math.PI/64)*n.radius,n.y+Math.sin(i*Math.PI/64)*n.radius] as [number,number])]);
  // Quantize authored intersections so coincident corridor seams have identical endpoints.
  const quantize=(polygons:Polygon[])=>polygons.map(p=>p.map(r=>r.map(([x,y])=>[Math.round(x*1e5),Math.round(y*1e5)] as [number,number])));
  const snappedRooms=quantize(rooms);
  const floor=clipping.union(snappedRooms[0],...snappedRooms.slice(1));
  const corridors:Polygon[]=edges.map(([a,b])=>{
    const from=nodes.find(n=>n.id===a)!,to=nodes.find(n=>n.id===b)!;
    const dx=to.x-from.x,dy=to.y-from.y,length=Math.hypot(dx,dy),nx=-dy/length*corridorRadius,ny=dx/length*corridorRadius;
    return [[[from.x+nx,from.y+ny],[to.x+nx,to.y+ny],[to.x-nx,to.y-ny],[from.x-nx,from.y-ny]]];
  });
  const snappedCorridors=quantize(corridors);
  const roads=corridors.length?clipping.difference(clipping.union(snappedCorridors[0],...snappedCorridors.slice(1)),floor):[];
  const foundation=snappedCorridors.length?clipping.union(snappedRooms[0],...snappedRooms.slice(1),...snappedCorridors):floor;
  // Boolean operations use integer inputs to avoid nearly coincident floating seams.
  const restore=(polygons:MultiPolygon):MultiPolygon=>polygons.map(p=>p.map(r=>r.map(([x,y])=>[x/1e5,y/1e5] as [number,number])));
  return {floor:restore(floor),roads:restore(roads),foundation:restore(foundation)};
}
export function pavingGeometry(polygons:MultiPolygon,textureMeters:number){
  const shapes=polygons.map(polygon=>{
    const shape=new THREE.Shape(polygon[0].slice(0,-1).map(([x,y])=>new THREE.Vector2(x,y)));
    shape.holes=polygon.slice(1).map(ring=>new THREE.Path(ring.slice(0,-1).map(([x,y])=>new THREE.Vector2(x,y))));return shape;
  });
  const geometry=new THREE.ShapeGeometry(shapes);
  const positions=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
  for(let i=0;i<positions.count;i++)uv.setXY(i,positions.getX(i)/textureMeters,-positions.getY(i)/textureMeters);
  geometry.rotateX(Math.PI/2); // Shape XY becomes horizontal XZ; face upward below.
  const index=geometry.getIndex()!;for(let i=0;i<index.count;i+=3){const b=index.getX(i+1);index.setX(i+1,index.getX(i+2));index.setX(i+2,b);}
  geometry.computeVertexNormals();
  return geometry;
}

/** Extrude only the complete paving boundary; hole winding exposes the inner wall. */
export function foundationGeometry(polygons:MultiPolygon,depth=.6,textureMeters=2.7){
  const positions:number[]=[],uv:number[]=[],indices:number[]=[];
  for(const polygon of polygons)for(const [ringIndex,source] of polygon.entries()){
    const ring=source.slice(0,-1).map(p=>[...p] as [number,number]);
    const area=ring.reduce((sum,[x,y],i)=>{const b=ring[(i+1)%ring.length];return sum+x*b[1]-b[0]*y;},0);
    if((area>0)!==(ringIndex===0))ring.reverse();
    let distance=0;
    for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<1e-8)continue;
      const base=positions.length/3;
      positions.push(a[0],0,a[1],b[0],0,b[1],a[0],-depth,a[1],b[0],-depth,b[1]);
      uv.push(distance/textureMeters,depth/textureMeters,(distance+length)/textureMeters,depth/textureMeters,distance/textureMeters,0,(distance+length)/textureMeters,0);
      indices.push(base,base+1,base+2,base+1,base+3,base+2);distance+=length;
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
