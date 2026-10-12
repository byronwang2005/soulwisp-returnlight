from pathlib import Path
import sys,json
p=Path(sys.argv[1])/'data/regional_rail/function/extras.mcfunction';lines=[]
def fill(x,y,z,X,Y,Z,b):
 if max(X-x,Z-z)>100:
  if X-x>Z-z:m=(X+x)//2;fill(x,y,z,m,Y,Z,b);fill(m+1,y,z,X,Y,Z,b)
  else:m=(Z+z)//2;fill(x,y,z,X,Y,m,b);fill(x,y,m+1,X,Y,Z,b)
 else:lines.append(f'fill {x} {y} {z} {X} {Y} {Z} {b} keep')
def walk(x,z,X,Z):
 fill(x,176,z,X,176,Z,'minecraft:smooth_quartz')
 if X-x>Z-z:
  for zz in [z-1,Z+1]:fill(x,177,zz,X,177,zz,'minecraft:iron_bars')
 else:
  for xx in [x-1,X+1]:fill(xx,177,z,xx,177,Z,'minecraft:iron_bars')
walk(326,325,389,327);walk(325,230,327,325)
walk(1073,154,1075,202)
walk(35,153,90,155);walk(89,155,91,202)
# Repair the two original factory-line crossings without replacing connected curve entities.
for z in [305,307,348,350]:
 lines.append(f'setblock 341 78 {z} minecraft:polished_andesite keep');lines.append(f'setblock 341 79 {z} create:track[shape=zo] keep')
for z in [306,349]:lines.append(f'execute if block 341 79 {z} create:track[shape=xo,turn=false] run setblock 341 79 {z} create:track[shape=cr_o] replace')
for lift in json.loads(Path(__file__).with_name('entrances.json').read_text()):
 lines.append(f"setblock {lift['x']+4} 167 {lift['z']} minecraft:air replace")
p.write_text('\n'.join(lines)+'\n')
from stages import stage
print('extra batches',stage(p.parent,lines))
