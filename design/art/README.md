# Stylized bronze art sources

`models/` retains unmodified KayKit CC0 GLBs. `sources/kaykit-manifest.json` pins the original character and dungeon source commits/hashes. The additional broken wall source is pinned in `scripts/art-models.mjs` and the derived runtime manifest. Original licenses remain in the public character/dungeon directories. Historical Poly Haven provenance is archived in `sources/polyhaven-manifest.json`; those textures are no longer published.

`textures/` contains seven original image_gen outputs; prompts and screen palette are in `texture-prompts.json`. Their actual source dimensions are 1254 x 1254. The 2K ground color export resamples that source and does not add detail. These generated materials are distributed under CC0; PANTONE 876 C is a color-direction reference, not a screen calibration claim.

From this checkout, with Node.js 24 and the committed lockfile:

```sh
npm ci
npm run assets:build
npm run assets:check
npm run art:preview
node scripts/art-check.mjs --record
npx vitest run tests/art-assets.test.ts tests/scene-interaction.test.ts
```

Missing KayKit originals can be restored with `node scripts/art-models.mjs --download`; existing originals are hash-checked before processing. Generated source PNGs are restored from Git. Runtime WebP/GLB files can be rebuilt without image generation or network requests. Do not regenerate the source PNGs merely to restore derived files, as a new imagegen output will differ.

Model processing uses pinned glTF Transform 4.4.0 (MIT), preserves 41 attachment joints and ten actually used clips, and removes unselected mesh/animation accessors. Sharp 0.35.5 (Apache-2.0) processes palette atlases, periodic tile edges and mask-derived OpenGL normal/ARM maps. Complete development-tool licenses are in `licenses/`; installed transitive licenses are supplied by `npm ci`.

Only `apps/web/public/assets/` is published. Originals, prompts, preview SVG/PNG and scripts stay outside the web bundle. No KTX2 files are produced. CPU previews use the exported runtime mesh, initial Idle skinning, actual attachment builders and an approximate material tint; they do not reproduce Three.js GPU shaders, environment reflections or lighting.
