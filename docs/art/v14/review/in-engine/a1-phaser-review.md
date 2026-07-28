# V14 A1 Phaser in-engine review

Review date: 2026-07-28

Preview route: `/classic/?art-preview=v14-a1`

Release behaviour:

- The V14 A1 art is opt-in and does not replace the R5 production presentation.
- A production `r6-art-v14` manifest is rejected until all 500 approved masters exist.
- Current source approval is 7 of 500 masters. A1 is therefore still open.

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

The boss capture used an isolated browser-only QA progress fixture to unlock the
existing deterministic level-3 route. No repository save, account, wallet, or
server data was changed.

## Runtime observations

- Menu, story, map, shooter, Match-3, boss and rewards routes remained playable.
- V14 world, Keeper, Lumi, Crown, launcher, boss and six Nova orb requests
  returned HTTP 200.
- The Production Archive read the active approved-master manifest instead of
  legacy procedural sheets. All seven archive previews passed byte-length,
  SHA-256 and browser-decode checks before display, and their hashed requests
  returned HTTP 200 across both pages.
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

## Gate result

A1 runtime integration passes for the seven approved masters and their 86
stable runtime keys, including seven real Production Archive previews. The A1
source gate does not close until PF-asset-001-100
are individually approved with provenance and evidence.
