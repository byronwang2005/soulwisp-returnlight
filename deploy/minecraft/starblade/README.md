# Starblade server module

Minecraft 1.21.1 / NeoForge 21.1.133 / Java 21. The module extends the existing Byron Server Perks; it adds no client mod. The required resource pack uses vanilla CustomModelData, original procedural textures, animation and vanilla sounds.

Each recipient owns one independent persistent ledger: ByronNomad (`/starblade`) and H3arth (`/hearthblade`). H3arth's item lore says `来自父亲的礼物`. Existing ByronNomad PvP immunity and starter armor remain UUID scoped.

## Operations

Run commands through the internal Compose RCON client:

```sh
docker compose exec -T minecraft rcon-cli 'starblade status'
docker compose exec -T minecraft rcon-cli 'hearthblade status'
```

Both command roots support `recall`, `status`, `harvest fortune|silk`, `boots water|frost`, `disable`, `enable`, `selftest`, and `benchmark`. Recall and mode switches require the bound owner or console. Disable/enable and diagnostic commands require permission level 4. Recall invalidates the previous generation before delivering; an offline owner or full inventory waits for delivery. Store manually in vanilla chests/barrels; drops and automation are blocked.

Left click attacks, right click fires, sneak/right click casts a fixed-target ultimate with a two-second prelude and no cooldown. Melee and shot retain 16/20-tick cooldowns. While held, the weapon supplies diamond armor protection and top beneficial armor/sword/tool enchantment effects without replacing equipped items. Fortune and Silk Touch, and Depth Strider and Frost Walker, use selectable modes. Default modes are fortune/water. Putting the weapon away removes the virtual armor benefits.

A global 64-particle/tick budget covers both weapons. Ray tracing stops at unloaded chunks; explosions require their surrounding calculation area to be loaded. Chunk-load inventory cleanup is deferred to the server tick to avoid generating container loot during chunk registration.

## Rebuild

Compile these Java sources against the exact deployed server libraries with Java 21 and Eclipse JDT ECJ 3.38.0 (development tool only). Its SHA-256 is `97c566b120009c203a2fc8b291f4a9adbc171cf1ccb70f06f6b4e1828c00ce8e`.

```sh
java -jar ecj.jar -21 -proc:none -warn:none \
  -cp "$(find /data/libraries -name '*.jar' | paste -sd :)" \
  -d classes $(find src -name '*.java')
python3 package.py . classes dist
python3 build_pack.py /private/build/resourcepack
```

Packaging writes `release.json`; the resource builder writes its ZIP, manifest and geometry preview to the parent of the resourcepack directory. Compare checksums before replacing tracked artifacts. Run Node 24 `deploy/minecraft/render.mjs` against a prepared supplied server-pack directory; it verifies all locked mods and the module checksum. Keep credentials, player data, world archives and private output out of Git.

## Recovery

Save/backup before deployment, retain the previous module and resource-pack configuration, stop the server, replace the module, then restart. On a skill fault, disable the affected command root before reverting. Revert world data only when actual world destruction must be undone. Switching back to the old single-recipient module leaves H3arth's newer item unsupported; remove that item before such a rollback.

See [acceptance.md](acceptance.md) for the evidence and remaining client checks.
