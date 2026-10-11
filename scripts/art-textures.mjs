import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const root=new URL('../',import.meta.url),out=new URL('apps/web/public/assets/materials/',root);
const prompts=JSON.parse(await readFile(new URL('design/art/texture-prompts.json',root)));
const hash=data=>createHash('sha256').update(data).digest('hex');
const stone=new Set(['plaza','road','foundation']);
// The same periodic material mask drives height, occlusion and roughness.
function periodic(bytes,size){
  const result=Buffer.from(bytes),band=Math.round(size*.06);
  for(let y=0;y<size;y++)for(let x=0;x<band;x++)for(let c=0;c<3;c++){
    const a=(y*size+x)*3+c,b=(y*size+size-1-x)*3+c,mean=(bytes[a]+bytes[b])/2,t=1-x/band;
    result[a]=Math.round(bytes[a]*(1-t)+mean*t);result[b]=Math.round(bytes[b]*(1-t)+mean*t);
  }
  const horizontal=Buffer.from(result);
  for(let y=0;y<band;y++)for(let x=0;x<size;x++)for(let c=0;c<3;c++){
    const a=(y*size+x)*3+c,b=((size-1-y)*size+x)*3+c,mean=(horizontal[a]+horizontal[b])/2,t=1-y/band;
    result[a]=Math.round(horizontal[a]*(1-t)+mean*t);result[b]=Math.round(horizontal[b]*(1-t)+mean*t);
  }
  return result;
}
const files=[],materials={};await mkdir(out,{recursive:true});
for(const {id,prompt} of prompts.textures){
  const input=new URL(`design/art/textures/${id}.png`,root),source=await readFile(input),metadata=await sharp(source).metadata();
  materials[id]={source:`design/art/textures/${id}.png`,sourceSha256:hash(source),sourceDimensions:[metadata.width,metadata.height],generator:'built-in image_gen',prompt,maps:{}};
  const colorSizes=id==='plaza'||id==='road'?[1024,2048]:[1024];
  for(const size of colorSizes){
    const raw=await sharp(source).resize(size,size).removeAlpha().raw().toBuffer();
    const periodicColor=periodic(raw,size),bytes=await sharp(periodicColor,{raw:{width:size,height:size,channels:3}}).webp({quality:88}).toBuffer();
    const file=`${id}_color_${size}.webp`;await writeFile(new URL(file,out),bytes);
    files.push({file:`/assets/materials/${file}`,bytes:bytes.length,sha256:hash(bytes),material:id,map:'color',size});materials[id].maps[`color${size}`]=`/assets/materials/${file}`;
  }
  for(const size of [512,1024]){
    const raw=periodic(await sharp(source).resize(size,size).removeAlpha().raw().toBuffer(),size);
    const mask=new Float32Array(size*size);
    for(let i=0;i<mask.length;i++){const p=i*3;const value=(raw[p]*.2126+raw[p+1]*.7152+raw[p+2]*.0722)/255;mask[i]=stone.has(id)?Math.max(0,Math.min(1,(value-.12)*1.8)):value;}
    const height=(x,y)=>mask[((y+size)%size)*size+(x+size)%size];
    const normal=Buffer.alloc(size*size*3),arm=Buffer.alloc(size*size*3);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const i=y*size+x,p=i*3,h=mask[i],s=stone.has(id)?2.2:.7,dx=(height(x+1,y)-height(x-1,y))*s,dy=(height(x,y+1)-height(x,y-1))*s,len=Math.hypot(dx,dy,1);
      normal[p]=Math.round((-dx/len*.5+.5)*255);normal[p+1]=Math.round((dy/len*.5+.5)*255);normal[p+2]=Math.round((1/len*.5+.5)*255);
      arm[p]=Math.round((stone.has(id)?.6+.4*h:.94+.06*h)*255);
      const oxide=id==='bronze'&&raw[p+1]>raw[p]*.88;arm[p+1]=Math.round((id==='bronze'?(oxide?.85:.47):id==='leather'?.76:stone.has(id)?.88:.93)*255);
      arm[p+2]=id==='bronze'?(oxide?35:235):0;
    }
    for(const [map,rawMap] of [['normal',normal],['arm',arm]]){
      const bytes=await sharp(rawMap,{raw:{width:size,height:size,channels:3}}).webp({lossless:true}).toBuffer(),file=`${id}_${map}_${size}.webp`;
      await writeFile(new URL(file,out),bytes);files.push({file:`/assets/materials/${file}`,bytes:bytes.length,sha256:hash(bytes),material:id,map,size});materials[id].maps[`${map}${size}`]=`/assets/materials/${file}`;
    }
  }
}
await writeFile(new URL('manifest.json',out),JSON.stringify({revision:'stylized-bronze-v1',generator:'built-in image_gen',paletteReference:prompts.paletteReference,palette:prompts.palette,processing:'Periodic edge feather; a shared luminance/joint mask derives wrapped OpenGL normals, occlusion and roughness. Bronze oxidation mask separates conductive metal from patina. 2K color exports resample 1254px generated sources.',files,materials},null,2)+'\n');
console.log(`Exported ${files.length} material maps: ${(files.reduce((n,f)=>n+f.bytes,0)/1048576).toFixed(2)} MiB`);
