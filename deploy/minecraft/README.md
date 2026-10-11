# Fabric friends server

The authoritative public connection settings are in `apps/web/src/minecraft-server.json`. The website imports that file and `render.mjs` derives the server properties from it. The pinned Fabric mods and their SHA-512 hashes are in `mods.lock.json`; use Node.js 24 to render. The Java runtime inside the server container is Java 25.

## Prepare and start

Copy this directory and the public connection JSON to `/opt/minecraft`, keeping secrets and runtime data outside Git. Render with:

```sh
node render.mjs /opt/minecraft /opt/minecraft/connection.json
docker compose --env-file /opt/minecraft/.env -f /opt/minecraft/compose.yaml config --quiet
docker compose --env-file /opt/minecraft/.env -f /opt/minecraft/compose.yaml up -d minecraft
```

The renderer preserves the RCON password and configured whitelist. The container can use both CPU cores, has a 1–5 GiB Java heap and a 6.5 GiB total limit, and cannot use swap. Only TCP 25565 is published, bound to the public IPv4; RCON remains on the private Docker network. Allow TCP 25565 through the host and provider firewalls. Do not publish 25575.

Use the following commands from `/opt/minecraft`:

```sh
docker compose exec -T minecraft rcon-cli whitelist add PLAYER_NAME
docker compose exec -T minecraft rcon-cli op PLAYER_NAME
docker compose exec -T minecraft rcon-cli list
docker compose exec -T minecraft rcon-cli servercore status
docker compose exec -T minecraft rcon-cli spark tps
docker compose logs --tail=100 minecraft
docker stats --no-stream
```

Only grant operator status to the intended administrator. The website account does not grant Minecraft access. Whitelisted players are persisted in `data/whitelist.json`; do not configure an automatic startup whitelist removal policy.

## Initial chunk generation

Keep the initial whitelist empty. Process only one world at a time, waiting for each completion before starting the next. Select a square centered on the overworld spawn, radius 2000; nether and end radius 1000. Use the actual generated dimension names returned by Chunky.

```sh
docker compose exec -T minecraft rcon-cli chunky world minecraft:overworld
docker compose exec -T minecraft rcon-cli chunky shape square
docker compose exec -T minecraft rcon-cli chunky spawn
docker compose exec -T minecraft rcon-cli chunky radius 2000
docker compose exec -T minecraft rcon-cli chunky start
docker compose exec -T minecraft rcon-cli chunky progress
docker compose exec -T minecraft rcon-cli chunky pause
```

For the remaining dimensions use `minecraft:the_nether` and `minecraft:the_end`, center `0 0`, radius `1000`. World exploration remains open beyond the generated area. Tasks are not automatically resumed on server restart. Start the backup sidecar after the initial generation has completed.

## Backup and restore

```sh
docker compose up -d backup
docker compose exec -T backup backup now
docker compose logs --tail=80 backup
```

The sidecar flushes world data over internal RCON, pauses world writes for the archive and restores saving afterwards. It pauses Chunky first, uses at most half a CPU core and 256 MiB, backs up every 24 hours, and retains seven successful archives. Backups exclude downloaded jars and caches; the locked manifest recreates them. Export backups to a private local directory via SCP. Local archives alone do not survive loss of the VPS.

To restore, stop only the Minecraft project, preserve the current `data` directory under a dated name, inspect and extract the selected archive into a new directory, restore locked jars and start the server against that directory. Never overwrite a running world. Verify archive hashes, region files and player data in a separate restore directory before switching. Keep RCON secrets separately.

## Client validation

Use Prism's existing `Minecraft-26.3-Fabric` instance and the authorized `ByronNomad` profile:

```sh
"/Applications/Prism Launcher.app/Contents/MacOS/prismlauncher" --launch Minecraft-26.3-Fabric --profile ByronNomad --server 5.231.45.40:25565
```

Confirm the game window and server join log, movement, chunk loading, block interactions, chat, reconnect, persistence after graceful server restart, and rejection when the account is temporarily removed from the whitelist. Restore the whitelist after that check. Save evidence privately without session tokens. One connected client is not a ten-player load test.

## Sources and licenses

Use upstream releases, not development builds. Lithium and Krypton use LGPL-3.0, FerriteCore uses MIT, ServerCore uses MIT with GPL-licensed ported files, Chunky and spark use GPL-3.0, Fabric API uses Apache-2.0. The Minecraft container uses Apache-2.0 and the backup container MIT. The manifest records artifact sources; no third-party jars or player data are committed.
