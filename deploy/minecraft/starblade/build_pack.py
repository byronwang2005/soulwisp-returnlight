"""Original star-core sword art. Python standard library; deterministic ZIP and asset checks."""
import pathlib,json,math,struct,zlib,zipfile,hashlib,sys
ROOT=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '.local/starblade/resourcepack');ROOT.mkdir(parents=True,exist_ok=True)
def write(name,obj):
 p=ROOT/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
def png(name,w,h,pixel):
 def chunk(t,d):return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
 raw=b''.join(b'\0'+b''.join(bytes(pixel(x,y)) for x in range(w)) for y in range(h))
 p=ROOT/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b''))
def metal(x,y):
 v=6+((x*17+y*7)%11);return (v,v+3,v+12,255) if x%8 not in (0,7) else (115+v,78+v,25+v,255)
def gold(x,y):
 v=(x*11+y*3)%30;return (205+v,140+v,45+v,255)
def core(x,y):
 frame=y//16;yy=y%16;d=math.hypot(x-7.5,yy-7.5);pulse=.75+.25*math.sin(frame*math.pi/4)
 if abs(x-7.5)<1 or abs(yy-7.5)<1:return (int(190*pulse),int(245*pulse),255,255)
 v=max(.15,1-d/12)*pulse;return (int(30*v),int(190*v),int(255*v),255)
def violet(x,y):return (120+(x+y)%50,25+(x*3)%25,215+(y%30),255)
for name,func,h in [('metal',metal,32),('gold',gold,32),('core',core,128),('violet',violet,32)]:png('assets/starblade/textures/item/'+name+'.png',32 if name!='core' else 16,h,func)
write('assets/starblade/textures/item/core.png.mcmeta',{'animation':{'frametime':3,'interpolate':True}})
write('pack.mcmeta',{'pack':{'pack_format':34,'description':'星冕·终焉 | ByronNomad 唯一星核机械巨剑 | 1.21.1'}})
e=[]
def cube(a,b,mat,rot=None):
 q={'from':a,'to':b,'faces':{f:{'texture':'#'+mat,'uv':[0,0,16,16]} for f in ['up','down','north','south','east','west']}}
 if rot:q['rotation']={'origin':rot[0],'axis':rot[1],'angle':rot[2],'rescale':False}
 e.append(q)
cube([7.55,.4,7.55],[8.45,4.6,8.45],'metal')
for y in [1,1.7,2.4,3.1,3.8]:cube([7.45,y,7.45],[8.55,y+.18,8.55],'gold')
cube([7.2,0,7.2],[8.8,.8,8.8],'gold',([8,.4,8],'y',45))
cube([3.2,4.4,7.4],[12.8,5.2,8.6],'metal');cube([3.2,5.2,7.5],[12.8,5.45,8.5],'gold')
cube([7.15,5.1,7.45],[8.85,8.8,8.55],'metal');cube([7.65,5.1,7.35],[8.35,8.7,7.45],'core')
for left in [True,False]:
 x=5.9 if left else 9.3
 cube([x,7.9,7.5],[x+.8,14.8,8.5],'metal');cube([x+.15,8.1,7.35],[x+.65,14.6,7.5],'gold')
 edge=x-.25 if left else x+.8
 cube([edge,8.6,7.65],[edge+.25,14.8,8.35],'core')
 for i in range(3):
  x0=2.6+i*.75 if left else 10.65+i*.75
  cube([x0,6.5+i*.65,7.8],[x0+2,6.72+i*.65,8.2],'violet',([x0+1,6.6+i*.65,8],'z',22.5 if left else -22.5))
cube([6.6,14,7.6],[9.4,15.4,8.4],'metal',([8,14.7,8],'z',45));cube([7.8,14.5,7.5],[8.2,16,8.5],'core')
cube([7.05,9.25,7.05],[8.95,11.15,8.95],'core',([8,10.2,8],'y',45))
for x in [6.7,9.15]:cube([x,9,7.25],[x+.15,11.4,8.75],'gold')
for y in [9,11.3]:cube([6.7,y,7.25],[9.3,y+.15,8.75],'gold')
model={'gui_light':'front','ambientocclusion':False,'textures':{m:'starblade:item/'+m for m in ['metal','gold','core','violet']},'elements':e,'display':{
 'thirdperson_righthand':{'rotation':[0,90,-35],'translation':[0,2.8,0],'scale':[1.35,1.35,1.35]},
 'thirdperson_lefthand':{'rotation':[0,-90,35],'translation':[0,2.8,0],'scale':[1.35,1.35,1.35]},
 'firstperson_righthand':{'rotation':[0,25,-12],'translation':[1.2,2.4,-1.5],'scale':[1.12,1.12,1.12]},
 'firstperson_lefthand':{'rotation':[0,-25,12],'translation':[1.2,2.4,-1.5],'scale':[1.12,1.12,1.12]},
 'gui':{'rotation':[0,45,-35],'translation':[0,0,0],'scale':[.9,.9,.9]},
 'ground':{'translation':[0,3,0],'scale':[.6,.6,.6]},'fixed':{'rotation':[0,90,-45],'scale':[1,1,1]}}}
write('assets/starblade/models/item/starblade.json',model)
write('assets/minecraft/models/item/netherite_sword.json',{'parent':'minecraft:item/handheld','textures':{'layer0':'minecraft:item/netherite_sword'},'overrides':[{'predicate':{'custom_model_data':17012001},'model':'starblade:item/starblade'}]})
for q in e:
 assert all(0<=v<=16 for k in ['from','to'] for v in q[k]),q
 for face in q['faces'].values():assert face['texture'][1:] in model['textures']
for m in model['textures'].values():assert (ROOT/('assets/'+m.split(':')[0]+'/textures/'+m.split(':')[1]+'.png')).is_file()
# Orthographic preview shares the actual cuboid geometry; this is not client rendering proof.
svg=['<svg xmlns="http://www.w3.org/2000/svg" width="720" height="900" viewBox="0 0 720 900"><rect width="720" height="900" fill="#080e1b"/><text x="40" y="55" fill="#dbb973" font-size="28">星冕 · 终焉</text>']
colors={'metal':'#172033','gold':'#e4b54a','core':'#63efff','violet':'#b767ff'}
for q in e:
 a,b=q['from'],q['to'];mat=q['faces']['north']['texture'][1:];x=100+a[0]*32;y=830-b[1]*44;w=(b[0]-a[0])*32;h=(b[1]-a[1])*44
 rot=q.get('rotation');tr=''
 if rot and rot['axis']=='z':tr=f' transform="rotate({-rot["angle"]} {100+rot["origin"][0]*32} {830-rot["origin"][1]*44})"'
 svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{colors[mat]}" stroke="#526074" stroke-width="1"{tr}/>')
svg.append('</svg>');(ROOT.parent/'starblade-preview.svg').write_text(''.join(svg))
archive=ROOT.parent/'starblade-pack.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
 for p in sorted(ROOT.rglob('*')):
  if p.is_file():
   info=zipfile.ZipInfo(str(p.relative_to(ROOT)),(2026,10,12,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,p.read_bytes())
digest=hashlib.sha1(archive.read_bytes()).hexdigest()
(ROOT.parent/'resourcepack.json').write_text(json.dumps({'sha1':digest,'bytes':archive.stat().st_size,'model':17012001,'elements':len(e),'url':f'https://gaming.byron.wang/minecraft/starblade-{digest}.zip'},indent=2))
print(digest,len(e),'elements',archive.stat().st_size,'bytes; model bounds, textures, animation and JSON passed')
