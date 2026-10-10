import fs from 'node:fs/promises';
import path from 'node:path';
import { isIP } from 'node:net';
import { parseEnv } from 'node:util';
const directory = import.meta.dirname;
const input = path.resolve(process.argv[2] ?? path.join(directory, '.env'));
const output = path.resolve(process.argv[3] ?? directory);
const env = { ...parseEnv(await fs.readFile(input, 'utf8')), ...process.env };
const domain = env.DOMAIN?.toLowerCase();
if (!domain || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) throw new Error('DOMAIN must be a hostname without protocol or port.');
if (isIP(env.PUBLIC_IP ?? '') !== 4) throw new Error('PUBLIC_IP must be the VPS public IPv4 address.');
for (const key of ['POSTGRES_PASSWORD', 'AUTH_SECRET', 'LIVEKIT_API_SECRET']) if (!/^[a-fA-F0-9]{64,}$/.test(env[key] ?? '')) throw new Error(`${key} must be at least 64 hexadecimal characters.`);
if (!/^[a-zA-Z0-9_-]+$/.test(env.LIVEKIT_API_KEY ?? '')) throw new Error('LIVEKIT_API_KEY must use letters, numbers, hyphens or underscores.');
const game = `game.${domain}`, voice = `voice.${domain}`, turn = `turn.${domain}`;
const reverse = dial => ({ handler: 'reverse_proxy', upstreams: [{ dial }] });
const route = (match, handle) => ({ match: [match], handle, terminal: true });
const config = {
  admin: { disabled: true }, storage: { module: 'file_system', root: '/data' },
  apps: {
    tls: { certificates: { automate: [domain, game, voice, turn] } },
    http: { servers: {
      redirects: { listen: [':80'], routes: [{ handle: [{ handler: 'static_response', status_code: 308, headers: { Location: ['https://{http.request.host}{http.request.uri}'] } }] }] },
      websites: { listen: [':443'], protocols: ['h1', 'h2'], tls_connection_policies: [{}], automatic_https: { disable_redirects: true },
        listener_wrappers: [{ wrapper: 'layer4', routes: [
          { match: [{ tls: { sni: [turn] } }], handle: [{ handler: 'tls' }, { handler: 'proxy', proxy_protocol: 'v2', upstreams: [{ dial: ['127.0.0.1:5349'] }] }] },
        ] }, { wrapper: 'tls' }], routes: [
        route({ host: [domain], path: ['/api/*'] }, [reverse('127.0.0.1:3000')]),
        route({ host: [game] }, [reverse('127.0.0.1:2567')]),
        route({ host: [voice] }, [reverse('127.0.0.1:7880')]),
        route({ host: [domain] }, [{ handler: 'encode', encodings: { gzip: {}, zstd: {} } }, { handler: 'subroute', routes: [
          { match: [{ file: { root: '/srv', try_files: ['{http.request.uri.path}', '/index.html'] } }], handle: [{ handler: 'rewrite', uri: '{http.matchers.file.relative}' }] },
          { handle: [{ handler: 'file_server', root: '/srv' }] },
        ] }]),
      ] },
    } },
  },
};
let livekit = await fs.readFile(path.join(directory, 'livekit.yaml.example'), 'utf8');
for (const [placeholder, value] of Object.entries({ REPLACE_PUBLIC_IPV4: env.PUBLIC_IP, REPLACE_API_KEY: env.LIVEKIT_API_KEY, REPLACE_API_SECRET: env.LIVEKIT_API_SECRET, REPLACE_DOMAIN: domain })) livekit = livekit.replaceAll(placeholder, value);
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, 'caddy.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
await fs.writeFile(path.join(output, 'livekit.yaml'), livekit, { mode: 0o600 });
await fs.chmod(path.join(output, 'caddy.json'), 0o600);
await fs.chmod(path.join(output, 'livekit.yaml'), 0o600);
console.log(`Generated Caddy HTTPS + TURN/TLS and LiveKit configuration in ${output}`);
