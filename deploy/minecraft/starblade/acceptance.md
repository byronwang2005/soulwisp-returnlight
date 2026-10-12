# Acceptance record - 2026-10-12 (Europe/London)

## Deployed release

- Minecraft 1.21.1, NeoForge 21.1.133, Create 6.0.3, Java 21; max six players.
- Module checksum and size: see `release.json`; runtime artifact verified against it.
- Required resource pack: see `resourcepack.json`; published ZIP SHA-1 matches the manifest.
- Original module/config rollback and a coordinated successful pre-deployment world backup are retained privately on the server. No backups or player databases are committed.

## Server verification

Both recipient engines passed the live `selftest` after the gift deployment at 16:41. Checks covered UUID binding, duplicate rejection, cursor/chest transfers, foreign theft rejection, blocked drops and automation, menu close, recall generation invalidation, full-inventory waiting and serialized cooldowns. Held armor/toughness, Protection IV, Respiration/Depth Strider attributes, diamond multi-tool harvesting, Silk Touch switching, removal of unheld aura and repair of actual equipment also passed.

Combat fixtures passed melee cone/range and obstruction, beam first-target/block occlusion, same-tick deduplication, vanilla explosion/drop handling, exact destruction radius limits, bedrock resistance, canceled explosion protection, armor and attacker attribution, and ultimate damage falloff. The melee fixture receives 43 HP from base 40 plus Sharpness V; beam damage is 60 HP. Sky fixtures were restored after each run. Protection validation used the event cancellation pipeline, rather than a newly configured live claimed-land fixture.

ByronNomad retained generation 3 and his inventory position after deployment. H3arth received his independent generation 1 in hotbar slot 9; RCON inventory data confirmed the owner UUID, independent token, all sword/tool enchantments, model ID and `来自父亲的礼物` lore. An in-game gift message was sent to H3arth. Both accounts reconnected successfully.

A pre-gift 60-second, six-viewer particle-packet serialization benchmark completed 1,200 ticks: mean encoding cost 0.0775 ms/tick, 12,499,200 encoded bytes, peak 56 particles/tick. This measured serialization, not six connected clients. Both engines now share a global 64-particle/tick budget.

After the gift deployment, the live sample was 20 TPS / 23.898 ms per tick overall, with 2.271 GiB container memory (6.5 GiB limit). Cumulative container network counters were 272 kB received / 6.51 MB sent; they include normal player traffic and are not a weapon-only throughput measurement. Startup/reconnection produced a transient 2.271-second backlog.

## Client and build checks

The user confirmed the revised first-person model clearly shows the blade face, core and guard. The same model pack is used by the gift. Additional local Prism testing was canceled at the user's request because they play from a different computer. Another player's visual confirmation of all three skills remains pending; server delivery is verified.

Node 24 `npm run check` and `npm run build` passed. The build retains the existing large-chunk warning. The resource builder reproduced the published hash and checked model bounds, textures, animation and JSON. The deployment renderer verified the 23 locked supplied/optimization mods plus the new module in a private prepared server-pack directory. No weapon explanation was added to the website.
