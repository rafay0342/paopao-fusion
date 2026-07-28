# PF-asset-231 in-engine review

Review date: 2026-07-28
Preview route: `/classic/?art-preview=v14-a1`
Decision: approved for the staged V14 preview; it does not close its A3 release gate.

## Art and provenance

Candidate C was selected from three independent built-in image-generation
outputs. The selected 941 by 1672 source remains immutable and hash-bound in
the V14 production manifest. A deterministic local finishing pass reduced
lower-launcher noise, preserved the true generated source, and produced
full-canvas disjoint background, midground, gameplay-plane and foreground
composition bands, one independent parallax-safe atmosphere layer and the
final runtime composite. The disjoint bands are editable and reconstruct the
plate losslessly; they are not misrepresented as independently movable depth
planes.

The approved environment uses realistic material response, depth, volumetric
light and atmosphere while keeping the Keeper and Pao spirits in the locked
stylized PaoPao language. It contains no watermark, baked text, copied
character, fighting content, gore, weapon-led framing or hidden jump-scare
subject.

## In-engine evidence

| Surface | Viewport | Evidence |
|---|---:|---|
| Adventure map, post-layout audit | 1280x720 | `map-layout-fixed-desktop-1280x720.png` |
| Adventure map, post-layout audit | 390x844 | `map-layout-fixed-mobile-390x844.png` |
| Adventure map, post-layout audit | 320x568 | `map-layout-fixed-mobile-320x568.png` |
| Adventure map details expanded | 320x568 | `map-details-expanded-mobile-320x568.png` |
| Stage 27 story continuity | 390x844 | `stage-27-story-mobile-390x844.png` |
| Story continuity | 320x568 | `story-mobile-320x568.png` |
| Bubble Shooter | 1280x720 | `shooter-desktop-1280x720.png` |
| Bubble Shooter | 320x568 | `shooter-mobile-320x568.png` |
| Bubble Shooter command rail | 320x568 | `shooter-controls-mobile-320x568.png` |
| Prism Cascade map | 1280x720 | `match3-map-desktop-1280x720.png` |
| Prism Cascade map | 320x568 | `match3-map-mobile-320x568.png` |
| Prism Cascade | 1280x720 | `match3-desktop-1280x720.png` |
| Prism Cascade | 390x844 | `match3-mobile-390x844.png` |
| Prism Cascade | 320x568 | `match3-mobile-320x568.png` |
| Adventure map, reduced motion | 1280x720 | `map-reduced-motion-1280x720.png` |
| Bubble Shooter, reduced motion | 1280x720 | `shooter-reduced-motion-1280x720.png` |
| Prism Cascade, reduced motion | 320x568 | `match3-reduced-motion-320x568.png` |
| Menu after Nexus bundle release | 1280x720 | `menu-after-realm-release-1280x720.png` |

The captures verify:

- protected HUD, central gameplay and lower launcher zones;
- no clipping or overlap in the captured state, objective and route hierarchy;
- one 26–30 player-facing route while stable Nexus save/reward IDs remain
  15, 28, 16, 29 and 17;
- distinct standard, mystery, challenge, elite and boss silhouettes, one
  non-repeating sign-in instruction and bounded reward rows;
- 100-design-pixel realm controls, high-contrast 26px durable labels and a
  fully bounded footer on the 320x568 baseline;
- one continuous corruption treatment across map, story and both game modes;
- a static equivalent for the captured map, Bubble Shooter and Prism Cascade
  states under `prefers-reduced-motion: reduce`;
- no overlap in the final Prism Cascade objective hierarchy;
- non-overlapping 100-design-pixel Bubble Shooter command targets and a
  compact objective/status rail on the 320x568 baseline;
- V14 base and atmosphere decoding through content-hashed runtime variants.
- scene-owned Nexus bundle release restores the displaced stable Crystal
  texture before the menu resumes, rather than deleting a global texture key.

Fresh static-preview traversal produced zero application errors and two
existing MediaPipe/WebGL implementation warnings. Long static-preview sessions
can also log an expected `/api/telemetry/batch` 404 because Vite preview has no
Fastify API; that is separated from the clean fresh-load result and does not
represent an art-loader failure.

The command-rail capture used an isolated browser-only QA progress fixture to
open level 29. No repository save, account, wallet or server data was changed.

## Scope boundary

All six canonical world IDs now have corruption/restoration presentation
profiles, but PF-asset-231 is the only newly approved authored horror
environment in this slice. Crystal and Emerald retain their approved V14 bright
bases; Celestial, Ember and Frostbound still use bounded legacy bases. Those
five worlds require their own candidates, approvals, masters and in-engine
evidence before a six-world horror-art claim can pass.

This staged review is not the full V14 accessibility or responsive gate. The
shared art-button and realm-selector targets now retain at least 100 design
pixels (44 CSS pixels at the 320x568 baseline), Match-3 exposes live
objectives, score, moves, board focus and realm actions to assistive
technology, and reduced-motion guards
cover the affected scene code. The remaining project-wide typography audit and
the 430x932 and 1920x1080 capture matrix stay open with the wider A1-A5 gates.

No campaign rule, deterministic seed, economy value, save schema, inventory
record, hand-tracking cadence or camera-frame privacy behaviour was changed.
