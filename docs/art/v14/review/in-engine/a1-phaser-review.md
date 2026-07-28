# V14 A1 Phaser in-engine review

Review date: 2026-07-28

Preview route: `/classic/?art-preview=v14-a1`

Release behaviour:

- The V14 A1 art is opt-in and does not replace the R5 production presentation.
- A production `r6-art-v14` manifest is rejected until all 500 approved masters exist.
- Current source approval is 8 of 500 masters. A1 is therefore still open.

## Captures

| Surface | Viewport | Evidence |
|---|---:|---|
| Main menu | 1280x720 | `a1-menu-desktop-1280x720.png` |
| Main menu | 390x844 | `a1-menu-mobile-390x844.png` |
| Crystal adventure map | 1280x720 | `a1-map-desktop-1280x720.png` |
| Opening story beat | 1280x720 | `a1-story-desktop-1280x720.png` |
| Shooter tutorial and level 1 | 1280x720 | `a1-shooter-desktop-1280x720.png` |
| Prism Cascade map | 1280x720 | `a1-match3-map-desktop-1280x720.png` |
| Prism Cascade level 1 | 1280x720 | `a1-match3-desktop-1280x720.png` |
| Prism Warden boss level | 1280x720 | `a1-boss-desktop-1280x720.png` |
| Rewards and skin paging | 1280x720 | `a1-rewards-desktop-1280x720.png` |
| Production Archive, page 1 | 1280x720 | `a1-production-archive-desktop-1280x720.png` |
| Production Archive, page 2 | 1280x720 | `a1-production-archive-page2-desktop-1280x720.png` |
| Nexus corruption map, post-layout audit | 1280x720 | `nexus-corruption/map-layout-fixed-desktop-1280x720.png` |
| Nexus corruption map, post-layout audit | 390x844 | `nexus-corruption/map-layout-fixed-mobile-390x844.png` |
| Nexus corruption map, post-layout audit | 320x568 | `nexus-corruption/map-layout-fixed-mobile-320x568.png` |
| Nexus corruption map details expanded | 320x568 | `nexus-corruption/map-details-expanded-mobile-320x568.png` |
| Nexus stage 27 story continuity | 390x844 | `nexus-corruption/stage-27-story-mobile-390x844.png` |
| Nexus story continuity | 320x568 | `nexus-corruption/story-mobile-320x568.png` |
| Nexus Bubble Shooter | 1280x720 | `nexus-corruption/shooter-desktop-1280x720.png` |
| Nexus Bubble Shooter | 320x568 | `nexus-corruption/shooter-mobile-320x568.png` |
| Nexus Bubble Shooter command rail | 320x568 | `nexus-corruption/shooter-controls-mobile-320x568.png` |
| Nexus Prism Cascade map | 1280x720 | `nexus-corruption/match3-map-desktop-1280x720.png` |
| Nexus Prism Cascade map | 320x568 | `nexus-corruption/match3-map-mobile-320x568.png` |
| Nexus Prism Cascade | 1280x720 | `nexus-corruption/match3-desktop-1280x720.png` |
| Nexus Prism Cascade | 390x844 | `nexus-corruption/match3-mobile-390x844.png` |
| Nexus Prism Cascade | 320x568 | `nexus-corruption/match3-mobile-320x568.png` |
| Nexus map, reduced motion | 1280x720 | `nexus-corruption/map-reduced-motion-1280x720.png` |
| Nexus Bubble Shooter, reduced motion | 1280x720 | `nexus-corruption/shooter-reduced-motion-1280x720.png` |
| Nexus Prism Cascade, reduced motion | 320x568 | `nexus-corruption/match3-reduced-motion-320x568.png` |
| Main menu after Nexus release | 1280x720 | `nexus-corruption/menu-after-realm-release-1280x720.png` |

The boss and mobile shooter-command captures used isolated browser-only QA
progress fixtures to unlock their existing deterministic routes. No repository
save, account, wallet, or server data was changed.

## Runtime observations

- Menu, story, map, shooter, Match-3, boss and rewards routes remained playable.
- V14 world, Keeper, Lumi, Crown, launcher, boss and six Nova orb requests
  returned HTTP 200.
- The Production Archive read the active approved-master manifest instead of
  legacy procedural sheets. All eight archive previews passed byte-length,
  SHA-256 and browser-decode checks before display, and their hashed requests
  returned HTTP 200 across both pages.
- PF-asset-231 retained the generated source while the approved master exposed
  reproducible background, midground, gameplay-plane, foreground and
  atmosphere layers. Its V14 Nexus base and atmosphere requests returned HTTP
  200 before the stable runtime keys replaced their bounded legacy fallbacks.
- Releasing the scene-owned Nexus bundle restored the previously displaced
  Crystal texture to its stable key; the post-release menu capture verifies
  that returning to a non-Nexus scene does not leave a missing texture.
- The same Nexus corruption state remained visible across map, story, Bubble
  Shooter, Prism Cascade map and Prism Cascade gameplay without changing level
  rules, progress, rewards, save values or hand-input cadence.
- The reduced-motion captures retained a static, readable corruption state
  while source guards disabled decorative fog, parallax, looping pulses and
  camera effects.
- The mutable V14 art manifest used network-first service-worker handling with
  the last valid cached response retained for bounded offline recovery.
- The MediaPipe model and WASM returned HTTP 200; camera frames remained local.
- Normal online traversal produced zero application console errors.
- Two MediaPipe implementation warnings remained: disabled WebGL error checking
  and square-ROI projection without explicit image dimensions.
- A controlled offline reload restored a playable main menu from the service
  worker. The browser logged two expected disconnected requests for
  `/api/account/status`; gameplay recovery was not blocked.
- Desktop and mobile captures retained the play action, HUD safety, launcher
  safety and portrait crop without clipping.
- The Nexus map now presents stages 26–30 in route order while its canonical
  IDs remain unchanged for saves, replays, rewards and APIs. Story and gameplay
  retain the same player-facing stage number after selection.

## Gate result

A1 runtime integration passes for the eight approved masters and their 89
stable runtime keys, including eight real Production Archive previews. The A1
source gate does not close until PF-asset-001-100
are individually approved with provenance and evidence.
