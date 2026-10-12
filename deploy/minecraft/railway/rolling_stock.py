"""Create four original passenger carriages; native assembly is a separate operation."""
from pathlib import Path
import json,sys
out=Path(sys.argv[1]);plan=json.loads((out.parent/'manifest.json').read_text())
styles=[('black','gold_block','white'),('red','smooth_quartz','red'),('cyan','waxed_oxidized_cut_copper','lime'),('yellow','smooth_sandstone','yellow')]
for index,t in enumerate(plan['trains']):
 color,trim,seats=styles[index];x,y,z=t['rail'];axis=t['axis'];lines=[]
 def put(along,lateral,height,state):
  X,Z=(x+lateral,z+along) if axis=='z' else (x+along,z+lateral)
  lines.append(f'setblock {X} {y+height} {Z} {state} keep')
 for a in range(12):
  for l in range(-2,3):
   put(a,l,2,'create:andesite_casing')
   facing=('west' if l<0 else 'east') if axis=='z' else ('north' if l<0 else 'south')
   put(a,l,6,('minecraft:polished_blackstone_stairs[facing='+facing+',half=bottom]') if abs(l)==2 else 'minecraft:'+color+'_concrete')
   if abs(l)<=1 and 2<=a<=9:put(a,l,7,'minecraft:dark_prismarine_slab[type=bottom]')
  for l in [-2,2]:
   put(a,l,3,'minecraft:'+trim)
   for h in [4,5]:put(a,l,h,'minecraft:black_stained_glass' if 1<=a<=10 else 'minecraft:'+color+'_concrete')
  for l in [-1,1]:
   if 3<=a<=8:put(a,l,3,'create:'+seats+'_seat')
  if a in [0,11]:
   for l in [-1,0,1]:
    put(a,l,4,'minecraft:black_stained_glass');put(a,l,5,'minecraft:'+trim)
   for l in [-2,2]:put(a,l,5,'minecraft:sea_lantern')
 for a in [1,9]:put(a,0,1,f'create:small_bogey[axis={axis}]')
 for a,f in [(1,'south' if axis=='z' else 'east'),(11,'north' if axis=='z' else 'west')]:put(a,0,3,f'create:controls[facing={f}]')
 for a in [2,10]:put(a,0,3,'create:blaze_burner[blaze=smouldering]')
 # Open doors by omitting the body walls at two positions (replace only own panels).
 for a in [4,7]:
  for l in [-2,2]:
   X,Z=(x+l,z+a) if axis=='z' else (x+a,z+l)
   for h in [3,4,5]:lines.append(f'setblock {X} {y+h} {Z} minecraft:air replace')
 path=out/f'data/regional_rail/function/train/{index}.mcfunction';path.parent.mkdir(parents=True,exist_ok=True);path.write_text('\n'.join(lines)+'\n')
 t['glueMin']=[x-2,y+1,z] if axis=='z' else [x,y+1,z-2]
 t['glueMax']=[x+2,y+7,z+11] if axis=='z' else [x+11,y+7,z+2]
(out.parent/'rolling-stock.json').write_text(json.dumps(plan['trains'],ensure_ascii=False,indent=2))
