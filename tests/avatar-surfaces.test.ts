import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect,vi} from 'vitest';
import {GameEngine,getConfig} from '@wangxu/rules';
import type {CampData,GameView} from '@wangxu/shared';

vi.mock('../apps/web/src/preferences',()=>({openSettings:vi.fn(),getPreferences:()=>({}),subscribePreferences:()=>()=>{},usePreferences:()=>({})}));
vi.mock('../apps/web/src/World',()=>({World:()=>null,useAssets:()=>null}));
vi.mock('../apps/web/src/effects',()=>({useGameEffects:()=>({settings:{motion:false},events:[],intent:vi.fn()})}));
vi.mock('../apps/web/src/voice',()=>({useCouncilVoice:()=>({enabled:false,muted:true,allowed:false,status:'',setEnabled:vi.fn(),toggleMic:vi.fn()})}));
vi.mock('../apps/web/src/useNavigation',()=>({useNavigation:()=>[]}));
vi.mock('../apps/web/src/ActionButton',()=>({ActionButton:({children,iconKind,iconState,...props}:any)=>createElement('button',props,children)}));
import {GameScreen} from '../apps/web/src/GameUI';
import {Camp} from '../apps/web/src/App';

function view(phase:GameView['phase']):GameView {
  const engine=new GameEngine({roomId:'avatars',invite:'',config:getConfig(4)});
  for(const id of ['a','b','c','d'])engine.addPlayer({id,name:id==='a'||id==='b'?'同名':id==='c'?'训练角色':'归灯者'});
  const result=engine.viewFor('a');result.phase=phase;
  result.players=result.players.map((player,index)=>({...player,image:index<2?`/avatars/lantern-${index+1}.svg`:null}));
  result.voice={enabled:false,epoch:null,speakerId:'b',open:false};
  result.messages=[{id:'message-b',author:'b',text:'乙的观察',at:0},{id:'message-a',author:'a',text:'甲的观察',at:1}];
  if(phase==='RESULT')result.result={winner:'human',reason:'归灯成功',factions:{a:'human',b:'wolf',c:'human',d:'human'},rewards:{a:{fragments:3,secrets:1}}};
  return result;
}
const screen=(state:GameView,training=false)=>renderToStaticMarkup(createElement(GameScreen,{view:state,send:vi.fn(),assets:null,quality:'low',onLeave:vi.fn(),training}));

describe('avatars in existing player surfaces without a browser or GPU',()=>{
  it('uses the current account avatar in the camp greeting',()=>{
    const camp:CampData={fragments:0,secrets:0,cosmetics:[],research:[],equipment:{profession:'warden',form:0,cosmeticId:'base'},presets:[],tutorialStep:0,tutorialCompleted:false,matches:0,wins:0,displayName:'归灯者'};
    const html=renderToStaticMarkup(createElement(Camp,{user:{id:'a',name:'归灯者',image:'/avatars/lantern-6.svg',email:'a@example.test'},camp,assets:null,quality:'low',voiceActive:false,onPlay:vi.fn(),onTutorial:vi.fn()}));
    expect(html).toContain('user-avatar--56');expect(html).toContain('src="/avatars/lantern-6.svg"');expect(html).toContain('欢迎归来，归灯者');expect(html).not.toContain('a@example.test');
  });
  it('associates speaker and chat avatars with IDs even when names are identical',()=>{
    const html=screen(view('DISCUSS'));
    const speaker=html.match(/<span class="badge council-speaker">([\s\S]*?)<\/span>/)![1];
    expect(speaker).toContain('user-avatar--24');expect(speaker).toContain('src="/avatars/lantern-2.svg"');
    const messages=[...html.matchAll(/<p class="chat-message">([\s\S]*?)<\/p>/g)].map(match=>match[1]);
    expect(messages[0]).toContain('src="/avatars/lantern-2.svg"');expect(messages[0]).toContain('乙的观察');
    expect(messages[1]).toContain('src="/avatars/lantern-1.svg"');expect(messages[1]).toContain('甲的观察');
    expect(html).toContain('user-avatar--40');
  });
  it('keeps voting names and professions alongside avatars and initials',()=>{
    const html=screen(view('VOTE'));
    const votes=html.slice(html.indexOf('class="vote-grid"'),html.indexOf('表决</button>'));
    expect(votes).toContain('src="/avatars/lantern-1.svg"');expect(votes).toContain('src="/avatars/lantern-2.svg"');expect(votes).toContain('训练角色');expect(votes).toContain('avatar-fallback');expect(votes).toContain('灯卫');expect(votes).toContain('弃权');
  });
  it('shows all result avatars without changing revealed factions or rewards',()=>{
    const html=screen(view('RESULT'));
    const roster=html.slice(html.indexOf('class="result-roster"'));
    expect(roster).toContain('src="/avatars/lantern-1.svg"');expect(roster).toContain('src="/avatars/lantern-2.svg"');expect(roster).toContain('训练角色');expect(roster).toContain('蚀月者');expect(html).toContain('+3');
  });
  it('supports legacy and training views without avatar fields',()=>{
    const state=view('DISCUSS');state.players.forEach(player=>delete player.image);
    const html=screen(state,true);
    expect(html).toContain('avatar-fallback');expect(html).toContain('训练使用文字交流');expect(html).toContain('乙的观察');expect(html).not.toContain('src="');
  });
  it('does not attach the last speaker avatar to free discussion or voting',()=>{
    const state=view('DISCUSS');state.voice.open=true;
    expect(screen(state)).not.toContain('user-avatar--24');expect(screen(view('VOTE'))).not.toContain('user-avatar--24');
  });
});
