"""Commission native Create curves, station names and rolling stock via console RCON."""
import subprocess,time,json,re,pathlib,sys
root=pathlib.Path('/opt/minecraft-create');plan=json.loads((root/'starblade/rail-manifest.json').read_text());trains=json.loads((root/'starblade/rolling-stock.json').read_text());results=[]
def rcon(command):
 p=subprocess.run(['docker','compose','exec','-T','minecraft','rcon-cli',command],cwd=root,text=True,capture_output=True,timeout=15)
 response=re.sub(r'\x1b\[[0-9;]*m','',p.stdout+p.stderr).strip();print(command[:110],'=>',response,flush=True)
 if p.returncode or any(e in response for e in ['Rail operation failed','Unknown or incomplete command','Incorrect argument','Unknown function']):raise RuntimeError(response)
 return response
def load(points):
 xs=[p[0] for p in points];zs=[p[2] for p in points];box=(min(xs)-16,min(zs)-16,max(xs)+16,max(zs)+16)
 rcon('forceload add '+' '.join(map(str,box)));time.sleep(2);return box
def release(box):rcon('forceload remove '+' '.join(map(str,box)))
if sys.argv[-1]!='--trains':
 for c in plan['curves']:
  box=load([c['a'],c['b']])
  try:rcon('railops curve '+' '.join(map(str,c['a']+c['b']+c['d']+c['e'])));time.sleep(2)
  finally:release(box)
 for s in plan['stations']:
  box=load([s['station']])
  try:rcon('railops name '+' '.join(map(str,s['station']))+' '+s['name'])
  finally:release(box)
else:
 for i,t in enumerate(trains):
  box=load([t['glueMin'],t['glueMax']])
  try:
   rcon('function regional_rail:train/'+str(i));time.sleep(1)
   rcon('railops glue '+' '.join(map(str,t['glueMin']+t['glueMax'])));time.sleep(1)
   response=rcon('railops assemble '+' '.join(map(str,t['station']))+' '+t['name']);id=re.search(r'Assembled ([\da-f-]+)',response).group(1)
   if 'doubleEnded=true' not in response:raise RuntimeError('Missing dual controls')
   t['uuid']=id;results.append(t)
   (root/'starblade/rail-trains.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
  finally:release(box)
rcon('railops survey');rcon('save-all flush')
