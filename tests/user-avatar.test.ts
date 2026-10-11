import {type ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({failed:false}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useState:()=>[state.failed,(failed:boolean)=>{state.failed=failed;}]}));
import {UserAvatar} from '../apps/web/src/UserAvatar';
import {API} from '../apps/web/src/api';
beforeEach(()=>{state.failed=false;});
const render=(props:Parameters<typeof UserAvatar>[0])=>renderToStaticMarkup(UserAvatar(props));

describe('avatar loading and accessible fallback',()=>{
  it('falls back after a failed image and uses fresh state for changed URLs',()=>{
    const first=UserAvatar({name:'归灯者',image:'/avatars/lantern-1.svg',alt:''});
    const Image=first.type as (props:any)=>ReactElement<any>;
    const loaded=Image(first.props);expect(loaded.type).toBe('img');loaded.props.onError();
    expect(render({name:'归灯者',image:'/avatars/lantern-1.svg',alt:''})).toContain('avatar-fallback');
    const next=UserAvatar({name:'归灯者',image:'/avatars/lantern-2.svg',alt:''});
    expect(next.key).not.toBe(first.key);
    // React remounts the keyed image when its URL changes.
    state.failed=false;expect(render({name:'归灯者',image:'/avatars/lantern-2.svg',alt:''})).toContain('src="/avatars/lantern-2.svg"');
    expect(UserAvatar({name:'归灯者',image:'/avatars/lantern-1.svg'}).key).not.toBe(next.key);
  });
  it('resolves uploaded avatar paths through the configured API',()=>{
    const path='/api/avatars/asset/version.webp';
    expect(render({name:'归灯者',image:path})).toContain(`src="${API}/avatars/asset/version.webp"`);
    expect(render({name:'归灯者',image:'/avatars/lantern-1.svg'})).toContain('src="/avatars/lantern-1.svg"');
  });
  it('hides decorative avatars and describes standalone images and initials',()=>{
    for(const image of [null,'/avatars/lantern-1.svg']){
      const html=render({name:'归灯者',image,alt:''});
      expect(html).toContain('aria-hidden="true"');expect(html).not.toContain('aria-label');
      expect(render({name:'归灯者',image,alt:'归灯者的头像'})).toContain(image?'alt="归灯者的头像"':'role="img" aria-label="归灯者的头像"');
    }
  });
  it('keeps Unicode initials intact and handles empty names and missing images',()=>{
    expect(render({name:'𠮷野',size:32})).toContain('>𠮷</span>');
    expect(render({name:'',image:null,size:40})).toContain('>灯</span>');
    expect(render({name:'归灯者',size:56})).toContain('user-avatar--56');
  });
});
