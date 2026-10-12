"""Load, apply and release small, bounded groups of console construction writes."""
import re

def stage(base, lines, prefix='extras', counter='rail_extras'):
    batches=[]; batch=[]; chunks=set(); cost=0
    for line in lines:
        m=re.search(r'(?:fill|setblock) (-?\d+) (-?\d+) (-?\d+)(?: (-?\d+) (-?\d+) (-?\d+))?',line)
        if not m: raise ValueError('No construction footprint: '+line)
        x,y,z=map(int,m.group(1,2,3)); X,Y,Z=map(int,m.group(4,5,6)) if m.group(4) else (x,y,z)
        used={(a,b) for a in range(x//16,X//16+1) for b in range(z//16,Z//16+1)}
        writes=(X-x+1)*(Y-y+1)*(Z-z+1)
        if batch and (cost+writes>384 or len(batch)>=12 or len(chunks|used)>8):
            batches.append((batch,chunks));batch=[];chunks=set();cost=0
        batch.append(line);chunks|=used;cost+=writes
    if batch:batches.append((batch,chunks))
    def fn(name,body):
        p=base/f'{prefix}/{name}.mcfunction';p.parent.mkdir(parents=True,exist_ok=True);p.write_text('\n'.join(body)+'\n')
    fn('start',[f'scoreboard objectives add {counter} dummy',f'scoreboard players set #done {counter} 0',f'function regional_rail:{prefix}/prepare/0'])
    for i,(body,used) in enumerate(batches):
        fn(f'prepare/{i}',[f'forceload add {x*16} {z*16}' for x,z in sorted(used)]+[f'schedule function regional_rail:{prefix}/wait/{i} 10t replace'])
        fn(f'wait/{i}',[f'scoreboard players set #wait {counter} 0']+[f'execute unless loaded {x*16} 168 {z*16} run scoreboard players add #wait {counter} 1' for x,z in sorted(used)]+[f'execute if score #wait {counter} matches 1.. run schedule function regional_rail:{prefix}/wait/{i} 10t replace',f'execute if score #wait {counter} matches 0 run function regional_rail:{prefix}/apply/{i}'])
        fn(f'apply/{i}',body+[f'scoreboard players set #phase {counter} {i+1}',f'schedule function regional_rail:{prefix}/release/{i} 4t replace'])
        fn(f'release/{i}',[f'forceload remove {x*16} {z*16}' for x,z in sorted(used)]+[f'function regional_rail:{prefix}/prepare/{i+1}' if i+1<len(batches) else f'scoreboard players set #done {counter} 1'])
    return len(batches)
