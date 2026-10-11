import * as THREE from 'three';
// KayKit atlas UVs are for the original palette. Reproject masonry so a tiled
// stone material spans each face rather than sampling a small palette swatch.
export function masonryUvs(geometry:THREE.BufferGeometry){
 geometry.computeVertexNormals();const position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal'),uv=new Float32Array(position.count*2);
 for(let i=0;i<position.count;i++){const x=Math.abs(normal.getX(i)),y=Math.abs(normal.getY(i)),z=Math.abs(normal.getZ(i));uv[i*2]=x>y&&x>z?position.getZ(i):position.getX(i);uv[i*2+1]=y>x&&y>z?position.getZ(i):position.getY(i);}
 geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));return geometry;
}
export function masonryGeometry(scene:THREE.Object3D){let geometry:THREE.BufferGeometry|undefined;scene.updateMatrixWorld(true);scene.traverse(n=>{if(n instanceof THREE.Mesh&&!geometry)geometry=n.geometry.clone().applyMatrix4(n.matrixWorld);});if(!geometry)throw new Error('Masonry mesh missing');geometry.computeBoundingBox();const bounds=geometry.boundingBox!,size=new THREE.Vector3();bounds.getSize(size);geometry.translate(-(bounds.min.x+bounds.max.x)/2,-bounds.min.y,-(bounds.min.z+bounds.max.z)/2);geometry.scale(1/size.x,1/size.y,1/size.z);return masonryUvs(geometry);}
