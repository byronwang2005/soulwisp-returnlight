import {fs,path,local,root,binary,run,loadEnv} from './lib.mjs';
const ip=process.argv[2];if(!ip||!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)||ip.split('.').some(n=>Number(n)>255))throw new Error('Usage: node scripts/lan.mjs 192.168.x.x');
const env=loadEnv();fs.mkdirSync(path.join(local,'caddy'),{recursive:true});
fs.writeFileSync(path.join(local,'Caddyfile'),`{\n  auto_https disable_redirects\n  skip_install_trust\n  admin off\n  storage file_system { root ${path.join(local,'caddy')} }\n}\nhttps://${ip}:8443 {\n tls internal\n handle /api/* { reverse_proxy 127.0.0.1:3000 }\n handle { reverse_proxy 127.0.0.1:${env.WEB_PORT||5180} }\n}\nhttps://${ip}:8444 { tls internal\n reverse_proxy 127.0.0.1:2567\n}\nhttps://${ip}:8445 { tls internal\n reverse_proxy 127.0.0.1:7880\n}\n`);
const rtc=fs.readFileSync(path.join(local,'livekit.yaml'),'utf8').replace(/node_ip: .*/,`node_ip: ${ip}`);fs.writeFileSync(path.join(local,'livekit.yaml'),rtc,{mode:0o600});
const address=`https://${ip}:8443`;const additions={LAN_IP:ip,AUTH_BASE_URL:address,ALLOWED_ORIGINS:`${address},http://localhost:${env.WEB_PORT||5180}`,LIVEKIT_PUBLIC_URL:`wss://${ip}:8445`,VITE_GAME_URL:`wss://${ip}:8444`};
let source=fs.readFileSync(path.join(root,'.env'),'utf8');for(const [key,value]of Object.entries(additions)){const re=new RegExp(`^${key}=.*$`,'m');source=re.test(source)?source.replace(re,`${key}=${value}`):source+`${key}=${value}\n`;}fs.writeFileSync(path.join(root,'.env'),source,{mode:0o600});
console.log(`LAN address: ${address}. Restart npm run dev after this command. Trust the generated .local/caddy/pki/authorities/local/root.crt on your TEST devices. This script does not change system trust.`);
run(binary('caddy'),['run','--config',path.join(local,'Caddyfile')]);
