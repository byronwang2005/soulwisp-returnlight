"""Build a staged, four-line Create railway above the surveyed existing world.
All general construction uses keep; critical tracks are checked for conflicts first.
"""
from pathlib import Path
import json,math,uuid,zipfile,sys
OUT=Path(sys.argv[1]);OUT.mkdir(parents=True,exist_ok=True)
Y=168; commands=[];curves=[];stations=[];trains=[];critical=[]
def emit(cmd,cost=1,chunks=()):commands.append((cmd,cost,set(chunks)))
def chunk(x,z):return (math.floor(x)//16,math.floor(z)//16)
def chunks_box(x,z,X,Z):return {(a,b) for a in range(math.floor(x)//16,math.floor(X)//16+1) for b in range(math.floor(z)//16,math.floor(Z)//16+1)}
def fill(x,y,z,X,H,Z,block,mode='keep'):
 assert x<=X and y<=H and z<=Z
 if (X-x+1)*(H-y+1)*(Z-z+1)>240:
  if X>x:m=(x+X)//2;fill(x,y,z,m,H,Z,block,mode);fill(m+1,y,z,X,H,Z,block,mode);return
  if Z>z:m=(z+Z)//2;fill(x,y,z,X,H,m,block,mode);fill(x,y,m+1,X,H,Z,block,mode);return
  m=(y+H)//2;fill(x,y,z,X,m,Z,block,mode);fill(x,m+1,z,X,H,Z,block,mode);return
 emit(f'fill {x} {y} {z} {X} {H} {Z} {block} {mode}',(X-x+1)*(H-y+1)*(Z-z+1),chunks_box(x,z,X,Z))
def block(x,y,z,state,mode='keep'):emit(f'setblock {x} {y} {z} {state} {mode}',1,[chunk(x,z)])
def line(axis,fixed,start,end,color):
 for t in range(start,end+1,16):
  last=min(end,t+15)
  if axis=='z':
   fill(fixed-2,Y-1,t,fixed+2,Y-1,last,'minecraft:polished_deepslate');fill(fixed,Y,t,fixed,Y,last,'create:track[shape=zo]');
   for side in [-2,2]:fill(fixed+side,Y,t,fixed+side,Y,last,'minecraft:'+color+'_concrete')
   critical.extend([[fixed,Y,z] for z in range(t,last+1)])
  else:
   fill(t,Y-1,fixed-2,last,Y-1,fixed+2,'minecraft:polished_deepslate');fill(t,Y,fixed,last,Y,fixed,'create:track[shape=xo]');
   for side in [-2,2]:fill(t,Y,fixed+side,last,Y,fixed+side,'minecraft:'+color+'_concrete')
   critical.extend([[x,Y,fixed] for x in range(t,last+1)])
  if t%48==0:
   x,z=(fixed,t) if axis=='z' else (t,fixed)
   fill(x-1,60,z-1,x+1,Y-2,z+1,'minecraft:stone_bricks');block(x-2,Y+1,z,'minecraft:sea_lantern');block(x+2,Y+1,z,'minecraft:sea_lantern')
def curve(a,b,d,e):
 # Create compares quarter-edge chords; a single 180-degree cubic fails its turn test.
 if d==e:
  if d[0]==0:mid=[(a[0]+b[0])//2,Y,a[2]+d[1]*8];cross=[1 if b[0]>a[0] else -1,0]
  else:mid=[a[0]+d[0]*8,Y,(a[2]+b[2])//2];cross=[0,1 if b[2]>a[2] else -1]
  block(*mid,'create:track[shape='+('xo' if cross[0] else 'zo')+']');block(mid[0],Y-1,mid[2],'minecraft:polished_deepslate');critical.append(mid)
  curve(a,mid,d,[-cross[0],-cross[1]]);curve(mid,b,cross,e);return
 curves.append({'a':a,'b':b,'d':d,'e':e})
def text(x,y,z,label,color='gold',size=.7):
 data=json.dumps({'text':label,'bold':True,'color':{'lime':'green','orange':'gold'}.get(color,color)},ensure_ascii=False,separators=(',',':'))
 nbt='{Tags:["regional_rail_sign"],text:'+json.dumps(data,ensure_ascii=False)+',billboard:"vertical",line_width:600,background:0,shadow:1b,brightness:{block:15,sky:15},transformation:{scale:['+','.join([str(size)+'f']*3)+']}}'
 emit(f'summon minecraft:text_display {x} {y} {z} '+nbt,1,[chunk(x,z)])
def station(name,rail,axis,direction,color,side=1,major=False):
 x,y,z=rail
 sx,sz=(x+side*3,z) if axis=='z' else (x,z+side*3)
 # Keep platforms separated from the rolling-stock capture envelope.
 if axis=='z':box=(sx if side>0 else sx-5,z-16,sx+5 if side>0 else sx,z+16)
 else:box=(x-16,sz if side>0 else sz-5,x+16,sz+5 if side>0 else sz)
 X,Z,XX,ZZ=box;fill(X,Y-1,Z,XX,Y-1,ZZ,'minecraft:smooth_quartz')
 for px,pz in [(X,Z),(XX,Z),(X,ZZ),(XX,ZZ)]:
  fill(px,Y,pz,px,Y+7,pz,'minecraft:polished_blackstone_bricks');block(px,Y+6,pz,'minecraft:sea_lantern')
 fill(X,Y+8,Z,XX,Y+8,ZZ,'minecraft:tinted_glass');fill(X,Y+9,Z,XX,Y+9,Z,'minecraft:waxed_cut_copper');fill(X,Y+9,ZZ,XX,Y+9,ZZ,'minecraft:waxed_cut_copper')
 id=uuid.uuid5(uuid.NAMESPACE_DNS,'byron.rail.'+name);ints=[(id.int>>(96-i*32)&0xffffffff) for i in range(4)];ints=[v if v<2**31 else v-2**32 for v in ints]
 nbt='{TargetTrack:[I;'+f'{x-sx},0,{z-sz}'+'],TargetDirection:'+str(direction)+'b,Ortho:1b,Id:[I;'+','.join(map(str,ints))+']}'
 block(sx,Y,sz,'create:track_station'+nbt)
 text(sx+.5,Y+5,sz+.5,name,color)
 if axis=='z':fill(sx,Y-1,z-14,sx,Y-1,z+14,'minecraft:'+color+'_concrete')
 else:fill(x-14,Y-1,sz,x+14,Y-1,sz,'minecraft:'+color+'_concrete')
 if axis=='z':
  fill(sx,Y+2,z-14,sx,Y+2,z+14,'minecraft:smooth_quartz')
  for step in range(3):
   px=x+side*(6-step);fill(px,Y-1+step,z-14,px,Y-1+step,z+14,'minecraft:smooth_quartz_stairs[facing='+('west' if side>0 else 'east')+']','replace')
 else:
  fill(x-14,Y+2,sz,x+14,Y+2,sz,'minecraft:smooth_quartz')
  for step in range(3):
   pz=z+side*(6-step);fill(x-14,Y-1+step,pz,x+14,Y-1+step,pz,'minecraft:smooth_quartz_stairs[facing='+('north' if side>0 else 'south')+']','replace')
 stations.append({'name':name,'station':[sx,Y,sz],'rail':rail,'axis':axis,'direction':direction,'platform':box})
 return [sx,Y,sz]
# Blue north-south loop: factory, mountain lookout and southern docks.
for x in [392,408]:line('z',x,256,1088,'blue')
curve([392,Y,256],[408,Y,256],[0,-1],[0,-1]);curve([392,Y,1088],[408,Y,1088],[0,1],[0,1])
blue=[]
for name,z in [('基地换乘',300),('星港工厂',615),('云岭观景',880),('南湾码头',1048)]:
 blue.append(station('B·'+name+'·北行',[392,Y,z],'z',1,'blue',-1));station('B·'+name+'·南行',[408,Y,z],'z',0,'blue',1)
# Red east-west loop, with an interchange to the blue spine.
for z in [208,224]:line('x',z,32,1088,'red')
curve([32,Y,208],[32,Y,224],[-1,0],[-1,0]);curve([1088,Y,208],[1088,Y,224],[1,0],[1,0])
red=[]
for name,x in [('出生区',64),('玩家基地',300),('东部新区',800),('半岛换乘',1048)]:
 red.append(station('R·'+name+'·西行',[x,Y,224],'x',1,'red',1));station('R·'+name+'·东行',[x,Y,208],'x',0,'red',-1)
curve([392,Y,256],[360,Y,224],[0,-1],[1,0]);curve([408,Y,256],[440,Y,224],[0,-1],[-1,0])
# Green Peninsula line, connecting the coastal station to the east interchange.
for x in [1056,1072]:line('z',x,-496,176,'lime')
curve([1056,Y,-496],[1072,Y,-496],[0,-1],[0,-1]);curve([1056,Y,176],[1072,Y,176],[0,1],[0,1])
for name,z in [('半岛海岸',-456),('林海中转',-144),('东环换乘',128)]:
 station('G·'+name+'·北行',[1056,Y,z],'z',1,'lime',-1);station('G·'+name+'·南行',[1072,Y,z],'z',0,'lime',1)
curve([1056,Y,176],[1088,Y,208],[0,1],[-1,0]);curve([1072,Y,176],[1040,Y,224],[0,1],[1,0])
# Spawn shuttle connects the actual spawn vicinity to the red line.
for x in [16,32]:line('z',x,0,176,'yellow')
curve([16,Y,0],[32,Y,0],[0,-1],[0,-1]);curve([16,Y,176],[32,Y,176],[0,1],[0,1])
for name,z in [('出生广场',16),('红线换乘',128)]:
 station('S·'+name+'·北行',[16,Y,z],'z',1,'yellow',-1);station('S·'+name+'·南行',[32,Y,z],'z',0,'yellow',1)
curve([32,Y,176],[64,Y,208],[0,1],[-1,0]);curve([16,Y,176],[48,Y,224],[0,1],[-1,0])
# Gold scenic branch shares the blue return track: factory -> lake -> southern bay.
for z in [600,1088]:line('x',z,440,768,'orange')
line('z',800,632,1056,'orange')
curve([440,Y,600],[408,Y,632],[-1,0],[0,-1]);curve([768,Y,600],[800,Y,632],[1,0],[0,-1]);curve([800,Y,1056],[768,Y,1088],[0,1],[1,0]);curve([440,Y,1088],[408,Y,1056],[-1,0],[0,1])
station('T·湖畔观光',[800,Y,840],'z',1,'orange',1)
# Large steel/glass interchange hall beside the factory platforms.
fill(414,Y-1,583,440,Y-1,647,'minecraft:polished_blackstone_bricks')
for z in range(584,648,8):
 for x in [414,440]:fill(x,Y,z,x,Y+17,z,'minecraft:polished_deepslate')
 fill(414,Y+17,z,440,Y+17,z,'minecraft:waxed_cut_copper')
 fill(420,Y+20,z,434,Y+20,z,'minecraft:waxed_cut_copper')
fill(415,Y+16,584,439,Y+16,646,'minecraft:tinted_glass');fill(420,Y+19,584,434,Y+19,646,'minecraft:tinted_glass')
fill(414,Y-1,613,416,Y-1,617,'minecraft:smooth_quartz')
for z in [587,643]:
 for x in [420,434]:block(x,Y,z,'minecraft:barrel[facing=up]');block(x,Y+1,z,'minecraft:lantern')
text(427,Y+12,615,'星港铁路 · 中央换乘大厅','gold',1.25)
text(427,Y+7,609,'蓝线 基地 / 工厂 / 云岭 / 南湾','aqua',.55)
text(427,Y+5,609,'红线 出生区 / 基地 / 东部 / 半岛换乘','red',.55)
text(427,Y+3,609,'绿线 半岛海岸   金线 湖畔观光','green',.55)
# Depot and rolling stock are assembled only after station/graph registration.
for name,rail,axis in [('星港通勤号',[408,Y,700],'z'),('东西快线号',[700,Y,224],'x'),('半岛海风号',[1072,Y,-240],'z'),('晨光接驳号',[32,Y,72],'z')]:
 sp=station('DEPOT·'+name,rail,axis,1,'white',1)
 trains.append({'name':name,'rail':rail,'axis':axis,'station':sp})
# Surveyed entrances, water elevators and safe return shafts.
lifts=json.loads(Path(__file__).with_name('entrances.json').read_text())
for lift in lifts:
 x,z,b=lift['x'],lift['z'],lift['bottom'];sx,_,sz=lift['station']
 fill(x-2,b,z-2,x+6,b,z+2,'minecraft:smooth_quartz')
 for cx in [x,x+4]:
  for dx,dz in [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)]:
   fill(cx+dx,b+1,z+dz,cx+dx,Y+2,z+dz,'minecraft:glass')
 # All replacement writes are within the newly built, surveyed air footprint.
 block(x,b,z,'minecraft:soul_sand','replace');fill(x,b+1,z,x,Y+1,z,'minecraft:water','replace')
 block(x+4,b+1,z,'minecraft:water','replace');fill(x+4,b+2,z,x+4,Y+1,z,'minecraft:air','replace')
 for cx,dx in [(x,-1),(x+4,1)]:
  for h in [b+1,b+2,Y,Y+1]:block(cx+dx,h,z,'minecraft:oak_wall_sign[facing=north]','replace')
 fill(x-2,Y-1,z-2,x+6,Y-1,z+2,'minecraft:smooth_quartz')
 block(x,Y-1,z,'minecraft:water','replace');block(x+4,Y-1,z,'minecraft:air','replace')
 # An L-shaped walkway stays on the outward side of its platform.
 fill(min(x+2,sx),Y-1,z-1,max(x+2,sx),Y-1,z+1,'minecraft:smooth_quartz')
 fill(sx-1,Y-1,min(z,sz),sx+1,Y-1,max(z,sz),'minecraft:smooth_quartz')
 for zz in range(min(z,sz),max(z,sz)+1):
  for xx in [sx-2,sx+2]:block(xx,Y,zz,'minecraft:iron_bars')
 block(x+4,Y-1,z,'minecraft:air','replace')
 text(x+2,min(lift.get('groundFloors',[b]))+4,z,lift['name']+' · 气泡上行 / 水池下行','aqua',.45)
 text(x+2,Y+4,z,'上行 ↑    下行 ↓','yellow',.45)
# Extend shafts below the tree-canopy survey level to their checked natural ground.
for lift in lifts:
 x,z,b=lift['x'],lift['z'],lift['bottom']
 for cx,ground in zip([x,x+4],lift.get('groundFloors',[b,b])):
  if ground>=b:continue
  for dx,dz in [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)]:fill(cx+dx,ground+1,z+dz,cx+dx,b,z+dz,'minecraft:glass')
  block(cx,ground,z,'minecraft:soul_sand' if cx==x else 'minecraft:smooth_quartz','replace')
  fill(cx,ground+1,z,cx,b+2,z,'minecraft:water' if cx==x else 'minecraft:air','replace')
  if cx!=x:block(cx,ground+1,z,'minecraft:water','replace')
  dx=-1 if cx==x else 1
  for h in [ground+1,ground+2]:
   block(cx+dx,h,z+1,'minecraft:glass');fill(cx+dx,h,z+1,cx+dx,h,z+1,'minecraft:glass','replace #minecraft:leaves');block(cx+dx,h,z,'minecraft:oak_wall_sign[facing=north]','replace')
  fill(cx-2,ground,z-2,cx+2,ground,z+2,'minecraft:smooth_quartz')
# Paired platforms use raised pedestrian bridges with full-block steps.
for st in stations:
 if st['name'].startswith('DEPOT') or not (st['axis']=='z' and st['station'][0]<st['rail'][0] or st['axis']=='x' and st['station'][2]>st['rail'][2]):continue
 sx,_,sz=st['station'];axis=st['axis'];other=next(q for q in stations if q['name']==st['name'].replace('北行','南行').replace('西行','东行'))
 ox,_,oz=other['station']
 if axis=='z':
  for px in [sx-2,ox+2]:
   for step in range(10):fill(px-1,Y-1+step,sz+17+step,px+1,Y-1+step,sz+17+step,'minecraft:smooth_quartz_stairs[facing=south]')
  fill(min(sx-3,ox-3),Y+8,sz+26,max(sx+3,ox+3),Y+8,sz+28,'minecraft:smooth_quartz')
 else:
  for pz in [sz+2,oz-2]:
   for step in range(10):fill(sx+17+step,Y-1+step,pz-1,sx+17+step,Y-1+step,pz+1,'minecraft:smooth_quartz_stairs[facing=east]')
  fill(sx+26,Y+8,min(sz-3,oz-3),sx+28,Y+8,max(sz+3,oz+3),'minecraft:smooth_quartz')
# Block signals separate each loop and protect shared junction approaches.
signals=[]
for axis,fixed,start,end,direction,side in [('z',392,280,1080,1,-1),('z',408,280,1080,0,1),('x',224,48,1072,1,1),('x',208,48,1072,0,-1),('z',1056,-480,160,1,-1),('z',1072,-480,160,0,1),('z',16,32,160,1,-1),('z',32,32,160,0,1),('z',800,656,1040,1,1)]:
 for t in range(start,end+1,128):
  # The spawn-to-red curve occupies the northern signal offset near x=50.
  if axis=='x' and fixed==208 and t==48:t=72
  rx,rz=(fixed,t) if axis=='z' else (t,fixed);sx,sz=(rx+side*3,rz) if axis=='z' else (rx,rz+side*3)
  if any((sx,sz) in [(q['platform'][0],q['platform'][1]),(q['platform'][0],q['platform'][3]),(q['platform'][2],q['platform'][1]),(q['platform'][2],q['platform'][3])] for q in stations):
   t+=2;rx,rz=(fixed,t) if axis=='z' else (t,fixed);sx,sz=(rx+side*3,rz) if axis=='z' else (rx,rz+side*3)
  if any(abs(sx-q['station'][0])+abs(sz-q['station'][2])<8 for q in stations):continue
  nbt='{TargetTrack:[I;'+f'{rx-sx},0,{rz-sz}'+'],TargetDirection:'+str(direction)+'b,Ortho:1b}'
  block(sx,Y-1,sz,'minecraft:polished_blackstone');block(sx,Y,sz,'create:track_signal[type=entry_signal]'+nbt)
  signals.append([sx,Y,sz])
# Generate staged functions. Chunk tickets are held only while each batch is active.
batches=[];batch=[];cost=0;ticket=set()
for cmd,n,ch in commands:
 if batch and (cost+n>384 or len(batch)>=12 or len(ticket|ch)>16):batches.append((batch,ticket));batch=[];cost=0;ticket=set()
 batch.append(cmd);cost+=n;ticket|=ch
if batch:batches.append((batch,ticket))
def fn(name,lines):
 p=OUT/f'data/regional_rail/function/{name}.mcfunction';p.parent.mkdir(parents=True,exist_ok=True);p.write_text('\n'.join(lines)+'\n')
(OUT/'pack.mcmeta').write_text(json.dumps({'pack':{'pack_format':48,'description':'Regional Rail: staged Create network construction'}}))
fn('start',['scoreboard objectives add rail_build dummy','scoreboard players set #done rail_build 0','scoreboard players set #pause rail_build 0','function regional_rail:prepare/0'])
fn('pause',['scoreboard players set #pause rail_build 1']);fn('resume',['scoreboard players set #pause rail_build 0'])
for i,(lines,chunks) in enumerate(batches):
 fn(f'prepare/{i}',[f'forceload add {x*16} {z*16}' for x,z in sorted(chunks)]+[f'schedule function regional_rail:wait/{i} 10t replace'])
 fn(f'wait/{i}',['scoreboard players set #wait rail_build 0']+[f'execute unless loaded {x*16} {Y} {z*16} run scoreboard players add #wait rail_build 1' for x,z in sorted(chunks)]+[f'execute if score #wait rail_build matches 1.. run schedule function regional_rail:wait/{i} 10t replace',f'execute if score #pause rail_build matches 1 run schedule function regional_rail:wait/{i} 20t replace',f'execute if score #wait rail_build matches 0 unless score #pause rail_build matches 1 run function regional_rail:apply/{i}'])
 fn(f'apply/{i}',lines+[f'scoreboard players set #phase rail_build {i+1}',f'schedule function regional_rail:release/{i} 4t replace'])
 fn(f'release/{i}',[f'forceload remove {x*16} {z*16}' for x,z in sorted(chunks)]+[f'function regional_rail:prepare/{i+1}' if i+1<len(batches) else 'scoreboard players set #done rail_build 1'])
manifest={'lifts':lifts,'signals':signals,'height':Y,'commands':len(commands),'batches':len(batches),'curves':curves,'stations':stations,'trains':trains,'criticalTracks':critical,'usedChunks':sorted({c for _,cs in batches for c in cs})}
(OUT.parent/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
with zipfile.ZipFile(OUT.parent/'regional-rail.zip','w',zipfile.ZIP_DEFLATED) as z:
 for p in sorted(OUT.rglob('*')):
  if p.is_file():z.write(p,p.relative_to(OUT))
print(json.dumps({k:v for k,v in manifest.items() if k in ['height','commands','batches']}),'stations',len(stations),'curves',len(curves),'tracks',len(critical))
