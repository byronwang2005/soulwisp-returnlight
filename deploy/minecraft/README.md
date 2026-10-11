# Create friends server

The public connection settings in `apps/web/src/minecraft-server.json` drive the website and server renderer: `gaming.byron.wang:25565`, Minecraft 1.21.1, NeoForge 21.1.133, Create6.0 pack 1.0.5, six players, authenticated accounts and whitelist. Use Java 21 in the server and clients. Plain Minecraft and the previous Fabric 26.3 instance cannot join.

## Prepare and start

Runtime directory: `/opt/minecraft-create`. The previous Fabric installation remains stopped at `/opt/minecraft` with its world and backups preserved. Never reuse its 26.3 world in this 1.21.1 server.

Copy this deployment directory and the public connection JSON to the runtime directory. Obtain the original `服务端1.0.5_20250315.zip` privately from the owner, then run:

```sh
python3 prepare.py /private/path/server-pack.zip /opt/minecraft-create
node render.mjs /opt/minecraft-create /opt/minecraft-create/connection.json
docker compose config --quiet
docker compose up -d minecraft
```

Use Python 3 and Node.js 24. The preparation script verifies the original archive SHA-256 and extracts only mods and configuration; it does not execute supplied scripts or overwrite existing configuration. The manifest pins the server jars by SHA-512. Client rendering/search/map jars and SimpleBackups are excluded from the server. Chunky 1.4.23 NeoForge is downloaded from its pinned official artifact. Pack jars and the client archive stay outside Git.

The renderer preserves the private IPv4 binding, RCON password and whitelist. For a fresh installation, configure `MINECRAFT_WHITELIST` in the private `.env` before starting. The runtime retains ByronNomad and H3arth without operator privileges.

The container can use both cores, has a 2–5 GiB G1 heap, a 6.5 GiB total limit and no container swap. View distance is six, simulation distance four and compression threshold 256 bytes. Only TCP 25565 is published; RCON stays on the private Docker network. Keep existing gameplay configurations from the friend-provided pack.

## Administration

Run from `/opt/minecraft-create`:

```sh
docker compose exec -T minecraft rcon-cli whitelist add PLAYER_NAME
docker compose exec -T minecraft rcon-cli whitelist list
docker compose exec -T minecraft rcon-cli list
docker compose exec -T minecraft rcon-cli neoforge tps
docker compose logs --tail=100 minecraft
docker stats --no-stream
```

Only grant operator status deliberately. Website accounts do not grant Minecraft access.

## Small initial generation

Pre-generate only a square around the overworld spawn, radius 500 blocks (roughly 4,000 chunks). Leave other dimensions for normal exploration. Run this once and wait for completion; use `chunky progress` to inspect it. This replaces the previous large Fabric generation schedule.

```sh
docker compose exec -T minecraft rcon-cli chunky world minecraft:overworld
docker compose exec -T minecraft rcon-cli chunky shape square
docker compose exec -T minecraft rcon-cli chunky spawn
docker compose exec -T minecraft rcon-cli chunky radius 500
docker compose exec -T minecraft rcon-cli chunky start
docker compose exec -T minecraft rcon-cli chunky progress
```

## Backup and restore

```sh
docker compose up -d --no-deps backup
docker compose exec -T backup backup now
docker compose logs --tail=80 backup
```

The sidecar pauses Chunky, flushes the world and disables saving for the archive, then restores saving and resumes pending generation. It uses at most half a core and 256 MiB, backs up every 24 hours and retains seven successful archives. SimpleBackups is removed to avoid competing backup schedules. Export archives to a private local directory. Backups exclude downloaded jars and caches; reconstruct them using the pinned pack and manifest.

For a restore, stop the Minecraft project, preserve the current data directory, extract the selected archive into a separate directory and restore the locked jars. Check archive hashes, region files and player data before switching. Never overwrite a running world. Keep credentials and player data out of Git.

## Clients

Get `PCL下载安装这个文件即可.zip` from the owner. In Prism choose Add Instance / Import and select the zip. In PCL import the same modpack. Allow all manifest downloads to finish, use Java 21 and log in with an authenticated Minecraft account. Confirm Minecraft 1.21.1, NeoForge 21.1.133 and pack 1.0.5 before adding `gaming.byron.wang:25565` in Multiplayer.

The previous real-client acceptance applied to Fabric 26.3. This replacement needs a fresh client join and Create gameplay check; server health/status alone does not establish that result.

## Sources

[NeoForge server installation](https://docs.neoforged.net/user/docs/server/), [itzg NeoForge container](https://docker-minecraft-server.readthedocs.io/en/latest/types-and-platforms/server-types/forge/#neoforge), [Prism modpack import](https://prismlauncher.org/wiki/getting-started/download-modpacks/), [Chunky](https://modrinth.com/plugin/chunky). The server and client archives were supplied privately by the owner; the manifest records their deployment identity without redistributing jars.
