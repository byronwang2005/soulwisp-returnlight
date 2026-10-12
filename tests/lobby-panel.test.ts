import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import type { LobbyView } from '@wangxu/shared';
const fake=vi.hoisted(()=>({buttons:new Map<string,()=>unknown>(),join:vi.fn(),leave:vi.fn(),camera:vi.fn(),stopCamera:vi.fn(),voice:{state:'idle',metrics:[],members:[],muted:true,info:{available:false},message:'',playbackBlocked:false,micBusy:false,listening:true,cameraOwner:null as {id:string;name:string;participantSid:string}|null,cameraTrack:null,cameraEnabled:false,cameraBusy:false}}));
vi.mock('react',async importOriginal=>({...await importOriginal<typeof import('react')>(),useSyncExternalStore:(_subscribe:unknown,snapshot:()=>unknown)=>snapshot()}));
vi.mock('../apps/web/src/ActionButton',()=>({ActionButton:({children,onClick,iconKind,iconState,...props}:any)=>{if(typeof children==='string')fake.buttons.set(children,onClick);return createElement('button',{...props,onClick},children);}}));
vi.mock('../apps/web/src/GameUI',()=>({PHASE_NAMES:{EXPLORE:'探索',PREP:'职业准备'}}));
vi.mock('../apps/web/src/lobby-voice',()=>({LobbyVoiceConnection:class{subscribe=()=>()=>{};getSnapshot=()=>fake.voice;join=fake.join;leave=fake.leave;toggleCamera=fake.camera;stopCamera=fake.stopCamera;}}));
import { VoiceLobby } from '../apps/web/src/VoiceLobby';
const lobby:LobbyView={selfId:'a',selfArea:'waiting',members:[{id:'a',name:'同行者甲',position:1,candidate:true,ready:false,preference:'warden'},{id:'b',name:'同行者乙',position:2,candidate:true,ready:true,preference:null}],countdown:null,game:null,draining:false};
const props={page:true,user:{id:'a',name:'甲'} as any,lobby:null as LobbyView|null,summary:{waiting:2,game:null,available:true},suspended:false,onJoin:vi.fn(async()=>{}),onLeave:vi.fn(async()=>{}),send:vi.fn(),onError:vi.fn(),onLogin:vi.fn(),onConnection:vi.fn(),onActivityChange:vi.fn()};
beforeEach(()=>{vi.clearAllMocks();fake.buttons.clear();Object.assign(fake.voice,{state:'idle',cameraOwner:null,cameraTrack:null,cameraEnabled:false,cameraBusy:false});vi.stubGlobal('sessionStorage',{getItem:()=>null,setItem:vi.fn(),removeItem:vi.fn()});});
it('exposes the roster, preference and ready controls directly on the lobby page',()=>{
  const html=renderToStaticMarkup(createElement(VoiceLobby,{...props,lobby}));
  expect(html).toContain('远征大厅');expect(html).toContain('同行者甲');expect(html).toContain('职业偏好');expect(html).toContain('准备出征');expect(html).toContain('1 / 2 已准备');expect(html).not.toContain('<dialog');
  fake.buttons.get('准备出征')!();expect(props.send).toHaveBeenCalledWith({type:'ready',ready:true});
});
it('prepares without a voice connection',()=>{
  renderToStaticMarkup(createElement(VoiceLobby,{...props,lobby:{...lobby,members:lobby.members.map(m=>({...m,ready:true}))}}));
  fake.buttons.get('取消准备')!();expect(props.send).toHaveBeenCalledWith({type:'ready',ready:false});expect(fake.join).not.toHaveBeenCalled();
});
it('connects optional voice without reserving another waiting seat',async()=>{
  renderToStaticMarkup(createElement(VoiceLobby,{...props,lobby}));await fake.buttons.get('连接语音')!();expect(fake.join).toHaveBeenCalledOnce();expect(props.onJoin).not.toHaveBeenCalled();
});
it('joins the game waiting queue even if optional voice fails',async()=>{
  fake.join.mockRejectedValueOnce(new Error('语音离线'));renderToStaticMarkup(createElement(VoiceLobby,props));await fake.buttons.get('加入等待区')!();expect(props.onJoin).toHaveBeenCalledOnce();await vi.waitFor(()=>expect(props.onError).toHaveBeenCalledWith('语音离线'));
});
it('reports unavailable lobby state instead of displaying an idle game',()=>{
  const html=renderToStaticMarkup(createElement(VoiceLobby,{...props,summary:{waiting:0,game:null,available:false}}));expect(html).toContain('等待区服务暂未连接');expect(html).toContain('等待连接');expect(html).not.toContain('等待出发');
});


it('renders candidate and overflow avatars by account ID while leaving empty seats unadorned',()=>{
  const members=[{...lobby.members[0],name:'同名',image:'/avatars/lantern-1.svg'},{...lobby.members[1],name:'同名',image:'/avatars/lantern-2.svg'},{...lobby.members[0],id:'c',name:'候场',candidate:false,image:'/avatars/lantern-3.svg'}];
  const html=renderToStaticMarkup(createElement(VoiceLobby,{...props,lobby:{...lobby,members}}));
  for(const image of members.map(m=>m.image))expect(html).toContain(`src="${image}"`);
  expect(html.match(/class="user-avatar /g)).toHaveLength(3);expect(html).toContain('seat-number');expect(html).toContain('已准备');expect(html).toContain('候场队列');expect(html).toContain('alt="" aria-hidden="true"');
});

it('offers camera sharing only after connecting voice and reports another owner as occupied',()=>{
  expect(renderToStaticMarkup(createElement(VoiceLobby,{...props,lobby}))).not.toContain('共享摄像头');
  fake.voice.state='connected';
  const available=renderToStaticMarkup(createElement(VoiceLobby,{...props,lobby}));
  expect(available).toContain('共享摄像头');fake.buttons.get('共享摄像头')!();expect(fake.camera).toHaveBeenCalledOnce();
  fake.voice.cameraOwner={id:'b',name:'同行者乙',participantSid:'sid-b'};
  const occupied=renderToStaticMarkup(createElement(VoiceLobby,{...props,lobby}));
  expect(occupied).toContain('同行者乙的摄像头共享');expect(occupied).toMatch(/<button[^>]*disabled=""[^>]*>同行者乙正在共享<\/button>/);
  expect(occupied).toContain('playsInline=""');expect(occupied).toContain('muted=""');expect(occupied).toContain('controls=""');
});

it('keeps a camera stop control visible in the compact waiting strip',()=>{
  Object.assign(fake.voice,{state:'connected',cameraOwner:{id:'a',name:'同行者甲',participantSid:'sid-a'},cameraEnabled:true});
  const html=renderToStaticMarkup(createElement(VoiceLobby,{...props,page:false,lobby}));
  expect(html).toContain('摄像头开启');expect(html).toContain('aria-label="停止摄像头共享"');
  expect(html).toContain('你正在共享');
});
