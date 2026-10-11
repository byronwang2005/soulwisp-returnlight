import {beforeEach,describe,it,expect,vi} from 'vitest';
import {Hono} from 'hono';
const mocks=vi.hoisted(()=>({session:vi.fn(),handler:vi.fn(),findAvatar:vi.fn(),transaction:vi.fn()}));
vi.mock('../apps/server/src/accounts',()=>({
  AccountError:class extends Error {},getSession:mocks.session,auth:{handler:mocks.handler},
  advanceTutorial:vi.fn(),craft:vi.fn(),getCamp:vi.fn(),issueGameTicket:vi.fn(),saveLoadout:vi.fn(),savePresets:vi.fn(),
}));
vi.mock('../apps/server/src/db/index',()=>({pool:{query:vi.fn()}}));
vi.mock('../apps/server/src/profile-store',()=>({profileRepository:{findAvatar:mocks.findAvatar,transaction:mocks.transaction}}));
vi.mock('../apps/server/src/waiting-room',()=>({reserveWaiting:vi.fn()}));
import {actualBodyLimit,createApi} from '../apps/server/src/api';

describe('profile HTTP boundary with mocked sessions and storage',()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.session.mockResolvedValue({user:{id:'a',name:'测试甲'}});mocks.handler.mockResolvedValue(new Response('{}',{headers:{'content-type':'application/json'}}));});
  const post=(path:string,body:unknown,headers:Record<string,string>={})=>createApi({getRoom:()=>undefined}).request(path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  it('measures actual stream size even without or with a forged content length',async()=>{
    const app=new Hono();app.use('*',actualBodyLimit(10));app.post('/',async c=>c.text(await c.req.text()));
    for(const headers of [new Headers(),new Headers({'Content-Length':'1'})])expect((await app.request('/',{method:'POST',headers,body:'x'.repeat(11)})).status).toBe(413);
    expect(await (await app.request('/',{method:'POST',body:'x'.repeat(10)})).text()).toBe('x'.repeat(10));
  });
  it('keeps ordinary requests bounded at 32 KiB and profiles at 96 KiB',async()=>{
    expect((await post('/api/profile',{name:'测试甲',avatarData:'x'.repeat(96*1024)})).status).toBe(413);
    expect((await post('/api/game-ticket',{value:'x'.repeat(33*1024)})).status).toBe(413);
    // A body between both limits reaches profile validation, not the ordinary request limit.
    expect((await post('/api/profile',{name:'测试甲',avatarData:'x'.repeat(33*1024)})).status).toBe(400);
  });
  it('requires a session and same-origin JSON for writes',async()=>{
    mocks.session.mockResolvedValue(null);expect((await post('/api/profile',{name:'测试甲',image:null})).status).toBe(401);
    expect((await post('/api/profile',{name:'测试甲',image:null},{Origin:'https://other.example.test'})).status).toBe(403);
    expect((await post('/api/profile',{name:'测试甲',image:null},{'Content-Type':'text/plain'})).status).toBe(400);
  });
  it('blocks alternate profile updates and external or foreign avatars at signup',async()=>{
    for(const path of ['/api/auth/update-user','/api/auth/update-user/'])expect((await post(path,{image:'https://other.example.test/avatar'})).status).toBe(403);
    for(const path of ['/api/auth/sign-up/email','/api/auth/sign-up/email/'])expect((await post(path,{image:'/api/avatars/foreign/version.webp'})).status).toBe(400);
    expect(mocks.handler).not.toHaveBeenCalled();
    expect((await post('/api/auth/sign-up/email',{image:'/avatars/lantern-1.svg'})).status).toBe(200);
    expect(mocks.handler).toHaveBeenCalledTimes(1);
  });
  it('serves only a matching version as a public immutable WebP without requiring login',async()=>{
    const assetId='12345678-1234-1234-1234-123456789012',version='a'.repeat(64),data=Buffer.from('webp fixture');
    const app=createApi({getRoom:()=>undefined});mocks.findAvatar.mockResolvedValue({data});mocks.session.mockResolvedValue(null);
    const response=await app.request(`/api/avatars/${assetId}/${version}.webp`);
    expect(response.status).toBe(200);expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(response.headers.get('Cache-Control')).toContain('immutable');expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(data);expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.findAvatar).toHaveBeenCalledWith(assetId,version);
    mocks.findAvatar.mockResolvedValue(undefined);expect((await app.request(`/api/avatars/${assetId}/${'b'.repeat(64)}.webp`)).status).toBe(404);
    expect((await app.request(`/api/avatars/${assetId}/invalid.webp`)).status).toBe(404);
  });
});
