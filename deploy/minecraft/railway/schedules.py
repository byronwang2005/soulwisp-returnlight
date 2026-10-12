"""Install cyclic, 20-second passenger stops on commissioned Create trains."""
import json,pathlib,subprocess
root=pathlib.Path('/opt/minecraft-create');trains=json.loads((root/'starblade/rail-trains.json').read_text())
routes=[
 ['B·星港工厂·南行','B·云岭观景·南行','T·湖畔观光','B·南湾码头·南行','B·南湾码头·北行','B·云岭观景·北行','B·星港工厂·北行','B·基地换乘·北行','B·基地换乘·南行'],
 ['R·东部新区·东行','R·半岛换乘·东行','R·半岛换乘·西行','R·东部新区·西行','R·玩家基地·西行','R·出生区·西行','R·出生区·东行','R·玩家基地·东行'],
 ['G·林海中转·南行','G·东环换乘·南行','G·东环换乘·北行','G·林海中转·北行','G·半岛海岸·北行','G·半岛海岸·南行'],
 ['S·红线换乘·南行','S·红线换乘·北行','S·出生广场·北行','S·出生广场·南行']]
commands=[]
for t,route in zip(trains,routes):
 commands.append('railops route '+t['uuid']+' '+'|'.join(route))
 t['route']=route

for command in commands:
 assert len(command.encode())<1400
 p=subprocess.run(['docker','compose','exec','-T','minecraft','rcon-cli',command],cwd=root,text=True,capture_output=True,timeout=15)
 print(p.stdout,p.stderr,flush=True);assert 'Automatic route installed' in p.stdout

(root/'starblade/rail-trains.json').write_text(json.dumps(trains,ensure_ascii=False,indent=2))
