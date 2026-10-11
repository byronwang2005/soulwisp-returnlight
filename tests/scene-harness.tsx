// Browser-only render fixture. Vite serves this source solely for the opt-in GPU test.
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {GameEngine,getConfig} from '@wangxu/rules';
import {GameScreen} from '../apps/web/src/GameUI';
import {useAssets} from '../apps/web/src/World';
import '@fontsource-variable/noto-sans-sc';
import '@fontsource-variable/noto-serif-sc';
import '@fontsource-variable/source-serif-4/standard.css';
import '@fontsource-variable/source-sans-3';
import '../apps/web/src/styles.css';
import '../apps/web/src/viewport.css';
import '../apps/web/src/bronze-theme.css';
import '../apps/web/src/scene-ui.css';
const engine=new GameEngine({roomId:'gpu-fixture-ten',invite:'GPU',config:{...getConfig(10),prepSeconds:1,exploreSeconds:900},seed:2});
for(let i=0;i<10;i++)engine.addPlayer({id:`render-${i}`,name:`同行者 ${i+1}`});
for(const player of engine.players.values())engine.command(player.id,{type:'ready',ready:true});engine.tick(1);
function Fixture(){
  const assets=useAssets(),[view,setView]=useState(()=>engine.viewFor('render-0'));
  useEffect(()=>{const timer=setInterval(()=>{engine.tick(.05);setView(engine.viewFor('render-0'));},50);return()=>clearInterval(timer);},[]);
  return <GameScreen view={view} assets={assets} quality="auto" training onLeave={()=>{}} send={command=>engine.command('render-0',command)}/>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
