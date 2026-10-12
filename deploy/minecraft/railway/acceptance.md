# Railway deployment acceptance - 2026-10-12

Deployed to the existing Minecraft 1.21.1 / NeoForge 21.1.133 / Create 6.0.3 world. Java 21 compiled the server helper against the exact deployed libraries and Create's bundled Catnip. The module checksum is recorded in `../starblade/release.json`.

## Completed

- Four native passenger trains assembled successfully with dual controls and conductors: black/gold 星港通勤号, red/white 东西快线号, copper/green 半岛海风号, warm yellow 晨光接驳号. Each has 12 seats, windows, boarding openings, headlights and a stepped roof.
- Four double-track loops and one scenic branch: 6,571 straight track blocks, 26 native quarter-turn curves, 27 passenger platforms, four depots and 48 entry signals. Native station names agree with approach directions.
- All 6,571 expected track positions and 48 signal blocks passed an offline scan of the flushed world. All 14 entrance floors, water catch pools, open return shafts and supported wall-sign water gates passed the same scan.
- Passenger boarding strips sit at carriage floor height, with three-step ramps from the concourse. Paired platforms and three line interchanges have pedestrian bridges. The central factory hall is a steel/copper and tinted-glass structure.
- Two original factory-line interruptions were repaired with two orthogonal crossings and four missing tracks. The original engineering train retained its UUID and remained paused throughout passenger commissioning.
- All 27 scheduled passenger stops were observed across 25 operating snapshots, including the lake branch. Every snapshot showed 20 TPS; mean MSPT was 7.525, maximum 18.496. All four trains advanced through every route entry without derailment, navigation error or missing conductor. Container memory during this window ranged roughly 3.3-3.9 GiB; configured limit remains 6.5 GiB. Container network counters increased by approximately 0.55 MB received and 2.71 MB sent during the window. These snapshots include final station-label and signal commissioning activity; this was not a six-player client load test.
- A normal server restart restored all five native trains, station names, current route progress and automatic schedules. Passenger services resumed with both conductors present; the engineering train remained paused. A post-restart sample showed 20 TPS and 2.961 MSPT.
- Both UUID-bound starblade self-tests passed after the helper upgrade. Existing weapon ownership, virtual gear and personal protections remain in the module.
- Construction tickets were fully released; `forceload query` reported no forced chunks. The final generated datapack loaded without function parsing errors.
- Node.js 24 type checking and production builds passed. Python compilation, layout assertions and module SHA-256 verification passed.

The initial 736 construction batches had three sampled spikes above 40 MSPT (maximum 105.91); the controller paused and resumed construction after recovery. These are separate from the operating samples above.

## Backups and client boundary

A coordinated backup preceded construction: `/opt/minecraft-create/backups/world-20261012-164751.tar.gz`. A post-build backup completed at `/opt/minecraft-create/backups/world-20261012-180210.tar.gz`; the final signal offset was subsequently corrected and the final coordinated backup completed at `/opt/minecraft-create/backups/world-20261012-180755.tar.gz`, with automatic saving restored and seven backups retained. World archives and player data stay outside Git.

The user plays on another computer. No local Prism instance was launched. Native assembly, captured carriage blocks and server movement were verified; visual preference, boarding comfort and actual client rendering remain for the user's in-game observation.

## Boarding

Factory ground entrance: `(376, 89, 625)`, beside the up-shaft at `(377, 89, 625)`. Central factory hall: `(427, 168, 615)`. Walk up the boarding ramp and right-click a seat when a train is stopped; services wait 20 seconds. The adjacent return shaft has a water catch pool. Each station displays its line and direction; use the pedestrian bridge for the opposite platform.
