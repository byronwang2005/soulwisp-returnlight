# Regional passenger railway

This world upgrade reuses the installed [Create 6.0.3](https://github.com/Creators-of-Create/Create) railway graph, signals, carriage assembly and cyclic schedules. Foldbacks use two 90-degree curves and a short straight to satisfy Create's [quarter-chord pathfinding angle check](https://github.com/Creators-of-Create/Create/blob/mc1.21.1/dev/src/main/java/com/simibubi/create/content/trains/graph/TrackEdge.java). No additional mod or npm package is installed. The original engineering train and its inventory remain separate from passenger services.

The surveyed express decks sit at Y=168, above the mountain terrain. Four double-track loops serve the spawn, base, factory, southern bay and peninsula. A fifth scenic branch serves the lake. Paired platforms have pedestrian bridges; 14 surveyed ground entrances have source-water bubble elevators and separate water-cushioned descent shafts. Red/blue, red/green and red/shuttle interchanges have elevated walkways.

| Train | Appearance | Service |
| --- | --- | --- |
| 星港通勤号 | Black/gold, pale seats | Blue spine and gold lake branch |
| 东西快线号 | Red/white | East/west red loop |
| 半岛海风号 | Copper/green | Peninsula green loop |
| 晨光接驳号 | Warm yellow | Spawn shuttle |

Each carriage has two bogeys, dual controls and smouldering blaze conductors, 12 seats, windows, open boarding doors, headlights and a stepped roof. Boarding strips and three-step ramps match the carriage floor height. Native schedules repeat with a 20-second stop at each station. The existing two factory-line interruptions are repaired with orthogonal crossings and four missing straight track blocks.

## Build and commission

`entrances.json` is a sanitized terrain survey including the checked natural ground beneath tree canopies. `blueprint.json` describes the commissioned layout; it contains no inventory or player database. General construction uses `keep`; replacement writes are restricted to new lift interiors, passenger bodies and the two checked legacy crossing states.

```sh
python3 deploy/minecraft/railway/build.py /private/build/datapack
python3 deploy/minecraft/railway/rolling_stock.py /private/build/datapack
python3 deploy/minecraft/railway/extras.py /private/build/datapack
```

The build generator emits a zipped datapack and private manifest. Repack after adding rolling-stock/extras functions. Confirm the exact world's track corridor is clear and create a coordinated world backup before executing `function regional_rail:start`. It is a one-time world operation, not a startup hook. Pause/resume with `function regional_rail:pause` and `function regional_rail:resume`; inspect `#phase` and `#done` in scoreboard `rail_build`. Batches hold at most 16 construction chunks, write at most 384 blocks and release tickets afterward. Never remove tickets owned by another operation.

`commission.py` uses Compose's internal RCON and the manifest under `/opt/minecraft-create/starblade`. Run curve/name commissioning after construction completes, then `--trains` for native assembly. Apply `function regional_rail:extras/start` for staged interchange walkways and the checked legacy repairs. `schedules.py` installs routes after all four trains assemble. Do not re-run assembly against an occupied depot or re-run the start function against a world changed by players.

Console/OP 4 commands supplied by the server module:

- `railops survey`: inspect graph, station, train, destination and runtime state.
- `railops curve ax ay az bx by bz dx dz ex ez`: connect loaded track endpoints with a native Bezier connection.
- `railops disconnect ax ay az bx by bz`: remove a native curve from both loaded endpoints.
- `railops name x y z NAME`: name a registered station.
- `railops glue minx miny minz maxx maxy maxz`: glue the inclusive vehicle envelope.
- `railops assemble x y z NAME`: native Create assembly at a depot.
- `railops schedule UUID SNBT`: install a native cyclic schedule.
- `railops route UUID NAME1|NAME2|...`: install a cyclic route with 20-second stops without exceeding the RCON packet limit.
- `railops pause UUID`: stop an automatic service and cancel navigation.

After commissioning, verify train destinations advance and `derailed=false`, inspect persistent signal groups and graph connectivity, remove construction tickets, flush the world, and check restart persistence. See `acceptance.md` for observed operating results. Appearance and boarding comfort require player observation in the actual client.
