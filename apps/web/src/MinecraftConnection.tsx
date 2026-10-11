import {useEffect,useRef,useState} from 'react';
import {ActionButton} from './ActionButton';
import server from './minecraft-server.json';
import './minecraft.css';

export function MinecraftCard({onOpen}:{onOpen:()=>void}) {
  return <section className="minecraft-card panel" aria-labelledby="minecraft-card-title">
    <div><span className="eyebrow">MINECRAFT / JAVA EDITION</span><h2 id="minecraft-card-title">{server.name}</h2><p>{server.modpack} {server.modpackVersion} · 正版白名单 · 最多 {server.maxPlayers} 人</p><code>{server.address}</code></div>
    <ActionButton iconKind="scavenger" className="primary" onClick={onOpen} aria-haspopup="dialog">Minecraft 连接入口</ActionButton>
  </section>;
}

export function MinecraftConnection({onClose}:{onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const address=useRef<HTMLInputElement>(null);
  const [copied,setCopied]=useState(false);
  const [manual,setManual]=useState(false);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    dialog.current?.showModal();
    return()=>{dialog.current?.close();previous?.focus();};
  },[]);
  async function copy(){
    try {await navigator.clipboard.writeText(server.address);setCopied(true);setManual(false);}
    catch {setManual(true);address.current?.focus();address.current?.select();}
  }
  return <dialog ref={dialog} className="minecraft-dialog panel" aria-labelledby="minecraft-title" onCancel={event=>{event.preventDefault();onClose();}}>
    <div className="section-head"><span className="eyebrow">MINECRAFT / JAVA EDITION</span><ActionButton iconKind="close" aria-label="关闭 Minecraft 连接说明" onClick={onClose}>关闭</ActionButton></div>
    <h1 id="minecraft-title">{server.name}</h1>
    <p>Java 版 <strong>{server.version}</strong> · {server.modpack} {server.modpackVersion} · 最多 {server.maxPlayers} 人</p>
    <label>服务器地址<input ref={address} readOnly value={server.address} onFocus={event=>event.currentTarget.select()}/></label>
    <ActionButton iconKind="copy" iconState={copied?'success':'default'} className="primary full" onClick={()=>void copy()}>{copied?'地址已复制':'复制连接地址'}</ActionButton>
    <p className="hint" role="status">{manual?'复制未成功，请选中上方地址后手动复制。':'需要 Minecraft Java 正版账号，并提前加入服务器白名单。'}</p>
    <h2>客户端要求</h2>
    <p>必须安装 <strong>{server.modpack} 整合包 {server.modpackVersion}</strong>，使用 Minecraft {server.version}、{server.loader} {server.loaderVersion} 和 Java {server.javaVersion}。普通原版客户端及 Fabric 26.3 实例无法加入。</p>
    <h2>使用 Prism 或 PCL 连接</h2>
    <ol><li>向服主获取客户端文件“{server.clientArchive}”。在 Prism 中选择“添加实例 → 导入”，或用 PCL 导入整合包 ZIP；等待模组下载完成，不要解压后只复制其中几个模组。</li><li>确认整合包 {server.modpackVersion}、Minecraft {server.version} 和 {server.loader} {server.loaderVersion}，选择 Java {server.javaVersion}，登录正版账号后启动。</li><li>进入“多人游戏”，选择“添加服务器”。</li><li>填写上方地址，保存后选择服务器并加入。</li></ol>
    <p className="hint">请使用服主提供的完整客户端整合包，保持玩法模组与服务端一致。网站账号与 Minecraft 正版账号独立。</p>
    <a href="https://prismlauncher.org/download/" target="_blank" rel="noreferrer">下载 Prism Launcher ↗</a>
  </dialog>;
}
