# PaoPao Fusion opening cinematic art record

> The five full-frame images below belong to the rejected v1 slideshow render.
> They are archived under `tools/cinematic-sources/rejected-v1/` and are not
> shipped in the runtime or used as the visual structure of v2.

Generated with the built-in image generation tool on 2026-07-21. These are
original PaoPao Fusion story frames; no existing franchise characters, stock
art, named-studio imitation, or copyrighted music were requested or used.

Shared direction for every frame: portrait 9:16, original high-end stylized 3D
fantasy feature-animation finish, painterly cinematic depth, tactile purple and
gold crystal craft, expressive round sentient Pao spirits, deep indigo
atmosphere, controlled highlights, no text or watermark, no white exposure,
no lens flare, and no sweeping glare.

1. `tools/cinematic-sources/rejected-v1/01-crown-unites.png`: The Aurora Crown floats above a circular crystal
   sanctuary and unites six realm gateways through violet, emerald, celestial,
   ember, frost, and magnetic energy paths while Pao spirits gather below.
2. `tools/cinematic-sources/rejected-v1/02-nexus-shatters.png`: The angular obsidian-violet Nexus Architect descends
   and breaks the Aurora Crown into six colored fragments as the Pao spirits
   recoil, framed as awe rather than horror.
3. `tools/cinematic-sources/rejected-v1/03-shards-six-realms.png`: Six colored fragments travel in a downward
   cinematic curve through the crystal, emerald, celestial, ember, frost, and
   magnetic realms, without split-screen borders or labels.
4. `tools/cinematic-sources/rejected-v1/04-keeper-awakens.png`: Lumi, the brave lavender Pao guide, touches the
   purple-gold crystal launcher; its runes answer the approaching last Prism
   Keeper and colorful Pao allies gather around it.
5. `tools/cinematic-sources/rejected-v1/05-vow-restore.png`: The Keeper and six Pao companions lift their fragments
   toward the incomplete crown above the six gateways and vow to restore it.

The archived v1 renderer and score are
`tools/cinematic-sources/rejected-v1/render-intro-cinematic-v1.py` and
`tools/cinematic-sources/rejected-v1/paopao-opening-score.wav`. The score is an
original additive-synthesis composition with no samples, loops, or third-party
melody.

## V2 continuous-animation layers

Generated with the built-in image generation tool on 2026-07-21, then converted
from a flat `#ff00ff` chroma background to validated alpha PNGs with the
installed image-generation post-processing helper. Transparent corners and
subject coverage were checked before animation use.

- `public/assets/cinematics/layers/lumi.png`: original full-body Lumi guide;
  pearl-enamel body, turquoise eyes, crystal ear fins, floating arms and a
  six-point prism crest. One character only, crisp silhouette, no text,
  shadow, logo, watermark or existing-franchise resemblance.
- `public/assets/cinematics/layers/aurora-crown.png`: original gold-and-pearl
  Aurora Crown with exactly six empty dark sockets—three per side—and a central
  star aperture. No installed gems, wearer, pedestal, text, shadow, watermark
  or existing-franchise resemblance.

The removable chroma sources are preserved under `tools/cinematic-sources/`.
V2 animates these isolated layers with the existing original game worlds,
launcher, Architect, mechanics and six Aurora Pao sprites. It does not use
full-frame stills as sequential shots. The deterministic continuous renderer is
`tools/render-intro-cinematic-v2.py`; it creates
`public/assets/cinematics/paopao-opening-v2.mp4` and the original synthesized
score `public/assets/cinematics/paopao-opening-v2-score.wav`.
