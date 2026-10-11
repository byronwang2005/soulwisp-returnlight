# Soulwisp: Returnlight brand assets

The bronze lantern holds a silver memory wisp and an amber core. Its broken
eclipse ring connects the Returnlight expedition to the city's endless night.
The same transparent emblem appears in the site header, hero, repository README
and browser icons.

| Asset | Use |
| --- | --- |
| `returnlight-mark.png` | 512 px transparent emblem |
| `returnlight-city.webp` | 1672 x 941 desktop hero artwork |
| `returnlight-city-small.webp` | 960 x 540 mobile hero artwork |
| `../favicon.ico` | 16, 32 and 48 px browser icons |
| `../favicon-32.png`, `../favicon-192.png` | PNG browser icons |
| `../apple-touch-icon.png` | 180 px home screen icon |

Generated with the built-in Image Gen tool on 2026-10-11. PNG and WebP exports
were resized and encoded with the workspace's bundled Sharp; no application
dependency was added. Text is rendered by the existing Noto Serif SC and Source
Serif 4 fonts, so the title remains selectable and accessible.

## Generation direction

Emblem: one antique bronze lantern, a silver-white S-shaped memory flame and an
amber core inside a broken eclipse circle. Refine to clean, flat shapes on a
transparent background, removing side flares and the lower hanging ornament.
No text, texture or mockup. Palette: bronze `#b58a58`, parchment `#efe4ce` and
silver `#e3e8de`.

Hero: a cinematic painterly view through ruined Gothic arches into the stone
city and a distant bell tower. An amber lantern lights the foreground below
silver wisps; an eclipsed moon hangs over sage fog. Keep the upper center quiet
for the separately rendered title and the central composition usable in a
portrait crop. No characters, typography, UI or buttons.

The emblem and game title open the existing registration dialog. The narrative
line below them opens the existing tutorial. Both hit areas inherit the artwork
typography without action labels, icons, borders, fills or pressed effects. On small
or short viewports, the content can scroll within the hero while the page stays
bounded by the existing application shell.
