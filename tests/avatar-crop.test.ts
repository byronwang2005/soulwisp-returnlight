import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {AVATAR_LIMITS,avatarDraftReducer,cropAvatar,loadAvatar,validCrop} from '../apps/web/src/avatar-crop';

describe('avatar crop and profile draft',()=>{
  const drawImage=vi.fn(),fillRect=vi.fn(),context={drawImage,fillRect,fillStyle:''};
  const bitmap={width:600,height:900,close:vi.fn()};
  let outputBytes=100;
  beforeEach(()=>{
    outputBytes=100;drawImage.mockClear();fillRect.mockClear();bitmap.close.mockClear();bitmap.width=600;bitmap.height=900;
    vi.stubGlobal('createImageBitmap',vi.fn(async()=>bitmap));
    vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>context,toBlob:(callback:(blob:Blob)=>void,type:string)=>callback(new Blob([new Uint8Array(outputBytes)],{type}))})});
    vi.stubGlobal('Image',class{src='';decode=async()=>{};});
    vi.stubGlobal('FileReader',class{result='data:image/jpeg;base64,AAAA';onload=()=>{};readAsDataURL(){this.onload();}});
  });
  afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
  it('orients the source before defining visible crop dimensions and releases decoded pixels',async()=>{
    const file=new File(['image'],'photo.jpg',{type:'image/jpeg'}),source=await loadAvatar(file);
    expect(createImageBitmap).toHaveBeenCalledWith(file,{imageOrientation:'from-image'});
    expect(source).toMatchObject({width:600,height:900});expect(drawImage).toHaveBeenCalledWith(bitmap,0,0);expect(bitmap.close).toHaveBeenCalled();URL.revokeObjectURL(source.url);
  });
  it('rejects unsupported formats, oversized files, decoding errors and excess pixels',async()=>{
    await expect(loadAvatar(new File(['a'],'x.svg',{type:'image/svg+xml'}))).rejects.toThrow('JPEG');
    await expect(loadAvatar(new File([new Uint8Array(AVATAR_LIMITS.fileBytes+1)],'x.png',{type:'image/png'}))).rejects.toThrow('10 MiB');
    bitmap.width=6000;bitmap.height=5000;await expect(loadAvatar(new File(['a'],'x.png',{type:'image/png'}))).rejects.toThrow('2400');expect(bitmap.close).toHaveBeenCalled();
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('decode'));await expect(loadAvatar(new File(['a'],'x.png',{type:'image/png'}))).rejects.toThrow('无法读取');
  });
  it('exports precisely the selected square over the theme background and bounds compression',async()=>{
    const source={url:'blob:source',width:600,height:900},area={x:100,y:300,width:300,height:300};
    expect(await cropAvatar(source,area,'#25251e')).toBe('data:image/jpeg;base64,AAAA');
    expect(context.fillStyle).toBe('#25251e');expect(fillRect).toHaveBeenCalledWith(0,0,256,256);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(),100,300,300,300,0,0,256,256);
    outputBytes=65537;await expect(cropAvatar(source,area,'#25251e')).rejects.toThrow('过大');
    outputBytes=100;await expect(cropAvatar(source,area,'#25251e')).resolves.toBe('data:image/jpeg;base64,AAAA');
  });
  it('rejects out-of-bounds and invalid coordinates',()=>{
    for(const area of [{x:-1,y:0,width:100,height:100},{x:0,y:0,width:0,height:0},{x:0,y:0,width:100,height:80},{x:580,y:0,width:100,height:100},{x:NaN,y:0,width:100,height:100}])expect(()=>validCrop(area,600,900)).toThrow('裁剪');
  });
  it('cancels an edit without replacing the draft and only clears staged data after saving',()=>{
    const source={url:'blob:source',width:600,height:900},original={image:'/avatars/lantern-1.svg'};
    const editing=avatarDraftReducer(original,{type:'load',source});expect(avatarDraftReducer(editing,{type:'cancel'})).toEqual({...original,source:undefined});
    const staged=avatarDraftReducer(editing,{type:'use',data:'data:image/jpeg;base64,AAAA'});
    expect(staged.image).toBe(original.image);expect(staged.avatarData).toBeDefined();
    const replacement=avatarDraftReducer(staged,{type:'load',source});expect(avatarDraftReducer(replacement,{type:'cancel'})).toEqual(staged);
    expect(avatarDraftReducer(staged,{type:'saved',image:'/api/avatars/id/version.webp'})).toEqual({image:'/api/avatars/id/version.webp'});
    expect(avatarDraftReducer(staged,{type:'select',image:null})).toEqual({image:null});
  });
});
