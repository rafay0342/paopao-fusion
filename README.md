# PaoPao · Fusion — Phaser 3.90.0 Bubble Shooter.

A production Phaser 3 + TypeScript + Vite bubble-shooter with six worlds, 30
deterministic campaign levels, six bosses, three classic modes, authoritative
endless/live events, arena play, PlayerSaveV4 migration, accounts, inventory,
economy, story, accessibility profiles and optional on-device MediaPipe hand
control. Physics, matching, deterministic replay rules, progression and visual
feedback are implemented rather than mocked. The browser exterior, scene
backgrounds, panels, map paths, gameplay pieces and overlays share one animated
gold/crystal visual language.

The V4 progression expansion adds three special modes, live run timers,
hit/accuracy/streak tracking, bank-shot bonuses, persistent coins, a four-item
artifact store and inventory, an unlockable world gallery, charge-based active
superpowers, and Ultra/Balanced/Performance render profiles.

The V5 presentation pass adds a unified responsive type scale, safe HUD/card
spacing across phone and desktop aspect ratios, device-aware text rendering,
and 128px gameplay-optimized bubble textures with linear mipmapped filtering.

The **V6 Royal Vault expansion** adds three complete families of 256px
cinematic orbs (18 production sprites), plus a dedicated
animated Prize Vault, daily and level-clear Mystery Keys, weighted prize pools,
skin unlocks/purchases/equipping, and four persistent animated player tiers.

The **V7 optical-art edition** adds another three seamless families (18 more
production sprites) alongside every original V6 skin. Its circles use
multilayer refraction, volumetric caustics and controlled peak brightness while
the Royal originals remain unchanged and independently collectible. V11 adds
six Frostglass, Nexus Crown and Phoenix base/optical families. The current
catalog therefore contains 12 families and 72 playable colour sprites across
V6, V7 and V11.

The **V8 World Mechanics expansion** gives every realm its own playable rule:
two-hit crystal seals, spreading enchanted vines, paired shot-teleport portals
and countdown ember cores. Dedicated boss encounters close levels 3, 6, 9 and
12 with objective tracking, boss health and world-specific counterattacks.
Classic, Rush and Precision all share the configured level objective while
retaining their timer, miss and coin-multiplier identities. Existing level
indices and local save keys remain compatible.

The **V9 Living Worlds expansion** introduced Frostbound ice armour, Magnetic
Nexus polarity shifts, two additional bosses and dedicated production art. The
current campaign contains five encounters in each of all six worlds. A
versioned PlayerSaveV4 preserves and migrates earlier saves while adding
campaign, endless/live-event, entitlement, device and hand-profile state. The
Fastify + SQLite service provides signed content/live configuration,
cross-device revisioned progress, authoritative economy, full deterministic
endless/live-event replay, classic server-observed ticket/input proof, arena
protocol replay, leaderboards and telemetry batching.

## Current production release

This repository now ships one gameplay client: Phaser 3.90.0. Unity is
permanently excluded. `/` opens the launcher, `/classic/` opens the game,
`/downloads/` provides PWA installation information, and `/3d` returns HTTP
410. Windows and Android use the same installable web PWA; there is no APK,
native desktop executable or Unity build.

The immutable five-gate sequence is:

1. `r1-level100-foundation-contextfix-20260722`
2. `r2-level100-gameplay-contextfix-20260722`
3. `r3-level100-cinematic-contextfix-20260722`
4. `r4-level100-liveops-contextfix-20260722`
5. `r5-level100-production-contextfix-20260722`

R5 is active after a verified R5 to R4 to R5 rollback drill. Its complete
853-file content SHA-256 is
`10694cddc96bc9fa393601e94830825ac02f97864aecf48761199c9eb4630996`
and its manifest SHA-256 is
`30d19f859c0fc6e1a7a051744a9224b7bb2e9308a198da521fe9e5d4fa06d8b9`.
The server health/readiness contract reports database schema 20.

The production ledger contains exactly 3,710 verified records, split into five
closed gates of 742. The final regression run passed 63/63 test files and
7,479/7,479 tests. These automated results include deterministic hand landmark
corpora and browser recovery behavior; they are not a claim that a complete
physical-camera lighting matrix or a physical Android-device run has passed.

R5 also handles WebGL context loss. Browser, Phaser and direct GL probes pause
the game loop, input, video and active hand capture, then reset gesture
continuity. Normal play resumes only after Phaser rebuilds GPU resources. A
10-second recovery timeout permits one loop-guarded reload into Canvas
compatibility mode per browser-tab session.

---

## Run it

Requires **Node 20+**.

```bash
npm install
npm run dev      # open the printed URL (http://localhost:5173)
```

Build a static bundle for hosting:

```bash
npm run build    # outputs to dist/
npm run preview  # serve the built bundle locally
```

Run the production build, API and SQLite persistence together on Windows CMD:

```cmd
npm install && npm run build && npm run serve:live
```

Defaults to `http://127.0.0.1:8189`; override with `set PORT=8190&& npm run serve:live`.
When a verified release state exists, `serve:live` serves its active immutable
client. Rebuilding `dist` alone never changes that production pointer.

---

## Project structure

```
src/
  main.ts                 Phaser bootstrap, diagnostics and renderer recovery wiring
  config.ts               worlds, levels, orb skins, colours, grid + view constants
  game/
    grid.ts               pure hex-grid geometry (no Phaser)
    matcher.ts            pure flood-fill cluster match + floater detection
    mechanics.ts          pure objective, obstacle, portal, ice, polarity + boss rules
    contracts.ts          PlayerSaveV4 contracts and strict parsers
    save-v4.ts            V3 migration, local mirroring and revision-safe sync
    retention.ts          quests, achievements, mastery and seeded challenges
    endless.ts            deterministic endless/live-event state and modifiers
    handtracking.ts       on-device MediaPipe capture, recovery and bounded inference
    handcontrol.ts        fail-closed contact/release gesture state machine
    render-context.ts     WebGL loss/restore state and one-time Canvas fallback
    online.ts             offline queue, cloud sync, leaderboards and ghost retrieval
    progression.ts        local level unlocks, stars and best scores
  gfx/
    textures.ts           fallback textures + particle canvas
    ui.ts                 reusable art panels, buttons, backgrounds and motes
  scenes/
    BootScene.ts          branded loading screen + optimized art preload
    MenuScene.ts          illustrated title, progress and Hall of Heroes
    WorldMapScene.ts      six-world map + interactive level medallions
    GameScene.ts          themed HUD, pause/results, launcher, levels + fx
    RewardsScene.ts       animated mystery vault, prize pool, skins and tiers
    ChallengesScene.ts    daily/weekly orders, streak, badges and mastery
    CompetitiveScene.ts   Daily/Weekly rankings and ghost replay launcher
    ProductionArchiveScene.ts  browsable production ledger evidence
    ProductionExperienceScene.ts  release capability catalog
    ProductionSystemsScene.ts  runtime systems catalog
server/
  index.mjs               Fastify static host, signed API and SQLite persistence
public/
  assets/worlds/v3/       high-quality Crystal, Emerald, Celestial and Ember art
  assets/ui/v3/           HD transparent panel/button/medallion art
  assets/sprites/v3/      HD bubbles, launcher and power-up runtime art
  assets/sprites/v4/      Chrono, Phoenix, Void and Fortune artifact art
  assets/sprites/v5/      smooth gameplay-optimized bubble runtime art
  assets/sprites/v6/      Nova, Royal Aurora and Voidforge orb skin families
  assets/sprites/v7/      additional seamless optical-glass edition (18 sprites)
  assets/sprites/v8/      world mechanic overlays and four boss emblems
  assets/sprites/v9/      ice/polarity overlays and two new boss emblems
  assets/sprites/v11/     six additional base/optical families (36 sprites)
  assets/ui/v6/           mystery chests, gifts, coins, prize pool and tier crests
  assets/worlds/v6/       cinematic portrait Prize Vault environment
  assets/worlds/v9/       Frostbound Citadel and Magnetic Nexus environments
art-source/
  full-art-v2/            preserved world and interface masters
  full-art-v3/            full-resolution generated V3 source artwork
  full-art-v4/            full-resolution generated artifact sources
  full-art-v6/            full-resolution V6 orb/reward/vault source artwork
  full-art-v7/            full-resolution V7 seamless-orb source artwork
  full-art-v8/            full-resolution V8 mechanic and boss source artwork
tools/
  process-v6-assets.py    border-safe matte extraction and runtime sprite build
  serve-dist.mjs          gzip-enabled static server used by the live Funnel
```

Controls: with mouse/touch, aim and release to shoot. In Hand mode, aim, touch
thumb and index, then separate them slightly to fire—one natural pinch/release,
with no second pinch and no wide open palm. Uncertain, stale or incomplete
gestures fail closed. Match 3+
same-colour bubbles to pop them; disconnected bubbles fall.

## Modes, coins and artifacts

- **Classic Saga** — no countdown; clear the complete board and build combos.
- **Time Rush** — 75-second clock; successful hits restore time and pay ×1.5 coins.
- **Precision Trial** — reach the level hit target before the timer or five misses; pays ×1.75 coins.
- **Chrono Prism** — adds timed-mode seconds and activates Time Warp.
- **Phoenix Crown** — boosts hit scores and burns away the lowest rows.
- **Void Compass** — charges faster and erases the loaded colour.
- **Fortune Idol** — doubles run coins and summons a Golden Rain burst.

Campaign presentation, the equipped relic, mode and render profile keep a local
save mirror for offline play. For signed-in accounts, spendable wallet balance,
purchases and inventory are authoritative on the Fastify/SQLite server; client
state cannot mint currency or entitlements. The Store doubles as the artifact
inventory, while the Gallery tracks worlds, relics, orb art, lifetime hits and
lifetime coins.

## Prize Vault, orb skins and royal tiers

- **Mystery Keys** — one daily gift plus one key for every successful level clear.
- **Animated Mystery Chest** — first opening guarantees a premium skin; later
  openings draw coins, double keys, jackpots or another unowned skin.
- **Twelve complete skin families** — three preserved V6 Royal families, three
  V7 Optical families and six V11 Frostglass/Nexus Crown/Phoenix base/optical
  families; every family contains all six gameplay colours and can be bought,
  unlocked from the prize pool, equipped and used throughout gameplay/menu/gallery art.
- **Royal progression tiers** — Bronze Guardian, Silver Knight, Gold Sovereign
  and Prismatic Legend advance from lifetime coins, hits, clears and vault opens.
- **Level rewards** — every map medallion carries a visible animated chest badge,
  and clear/result cards show the Mystery Key payout with the coin reward.

### Hand-tracking (webcam, optional)

Tap **✋ HAND** in-game to enable MediaPipe hand-tracking. Aim with the index
tip, touch thumb and index, then separate them slightly to fire. You never need
to repeat the pinch, open the whole palm or spread the fingers wide. Contact
and release each require consecutive fresh observations, so one-frame landmark
jitter never shoots. Tap **HAND** again to turn it off.
It's fully optional — camera/model errors are shown in the game while
touch/mouse remains available.

The camera pipeline adaptively scales 512/384/320px inference from measured
end-to-end load, uses higher detail for first acquisition and distant hands,
corrects recoverable dark/bright/backlit footage, and combines 2D fingertip
contact with world-depth geometry for angled and perspective views.
Severely blurred, fully occluded, pitch-black or clipped-white frames fail closed
instead of guessing a gesture or firing accidentally.

The gesture model is bundled with the game. Hand inference runs on-device (no
video leaves the browser), and camera mode needs HTTPS plus camera permission.
If the graphics context is interrupted, hand capture and gesture progression
pause with the game; a gesture can never begin before the loss and fire after
recovery.

Automated recorded-landmark tests cover timing, geometry, loss and false-shot
boundaries. Camera drivers, real-device thermals and the full far/near,
dark/backlit, blur and angle matrix still require physical hardware evidence;
desktop mobile emulation is not a physical Android result.

---

## Full app art system

- **Crystal Kingdom** — Prism Gate, Refraction Hall, Moonlit Grotto, Prism Echo, Crown Vault.
- **Emerald Wilds** — Mosslight Trail, Sporelight Hollow, Verdant Canopy, Thorncrown Path, Heartwood Shrine.
- **Celestial Temple** — Cloudstep Sanctum, Comet Archive, Starlight Orrery, Zenith Bridge, Astral Crown.
- **Ember Forge** — Cinder Bastion, Ashen Gallery, Magma Crucible, Phoenix Anvil, Inferno Throne.
- **Frostbound Citadel** — Winter Approach, Aurora Archive, Glacial Crown, Mirrorglass Pass, Frost Regalia.
- **Magnetic Nexus** — Polarity Gate, Gravity Well, Orbital Engine, Crown Convergence, Nexus Heart.

Every world drives the map background, accent colour, ambient particles and
in-level title ribbon. The same transparent gold/crystal UI art is reused by
the menu, map, HUD, power-ups, pause, level-clear and end-of-run screens.
Runtime images preserve full colour and smooth alpha edges. The additional V7 sprites use a
border-connected matte pipeline so reflective violet/red detail is never erased
by chroma removal, then downsample once with Lanczos filtering to the 256px
runtime scale. This avoids shimmering, dirty fringes and torn-looking edges.
Full-resolution masters are preserved outside the runtime bundle under
`art-source/`, so they remain in project backups without bloating `dist/` or
the public Funnel. Preserved V2 world and UI masters are rendered into the
higher-quality V3 runtime set without palette quantization.

## Integrated art and customization

The shipped core art and currently equipped orb family are loaded by
`BootScene.ts`; the Prize Vault streams the other premium families and reward
collection only when opened. This keeps first launch fast without reducing art
quality. Orb texture keys are mapped through `orbTexture()` in `config.ts`.
To replace the visual theme, use either option below while keeping gameplay
logic unchanged.

### 1. Get free, commercial-safe sprites

- **Kenney.nl** — the best starting point. Grab a puzzle/gem/candy pack (e.g.
  the *Puzzle Pack* / *Puzzle Assets*). Everything on Kenney is **CC0** — free,
  no attribution, commercial use allowed. These are glossy, beveled, and read
  perfectly as candy.
- **itch.io** — search "match 3 assets" / "bubble shooter assets" for many
  free and low-cost polished packs.
- **OpenGameArt.org** — filter by CC0 and search "gems" / "candy".

Aim for round sprites around **128×128 px** with the highlight already painted
in (that baked-in shine is what sells the look).

### 2a. Wire individual PNGs (simplest)

Put files in `public/assets/bubbles/` named per colour, then load them in
`src/scenes/BootScene.ts` → `preload()`:

```ts
this.load.image('bubble_red',    'assets/bubbles/red.png');
this.load.image('bubble_blue',   'assets/bubbles/blue.png');
this.load.image('bubble_green',  'assets/bubbles/green.png');
this.load.image('bubble_yellow', 'assets/bubbles/yellow.png');
this.load.image('bubble_purple', 'assets/bubbles/purple.png');
this.load.image('bubble_orange', 'assets/bubbles/orange.png');
```

That's it. The keys match `SKIN` in `config.ts`, so `BootScene` will use the
loaded production texture and reserve its procedural recovery art for an
interrupted or corrupt asset response.
`GameScene.scaleFor()` reads the actual texture-frame width, so differently
sized source images retain the correct physical gameplay size automatically.

### 2b. Wire a texture atlas (best for performance)

Pack your sprites into `candy.png` + `candy.json` (free tools: TexturePacker
free mode, or `free-tex-packer`), put both in `public/assets/`, then:

1. In `BootScene.ts` → `preload()`:
   ```ts
   this.load.atlas('candy', 'assets/candy.png', 'assets/candy.json');
   ```
2. In `config.ts`, set the atlas key and point `SKIN` at the frame names:
   ```ts
   export const ATLAS_KEY: string | null = 'candy';
   export const SKIN = {
     red: 'candy_red', blue: 'candy_blue', green: 'candy_green',
     yellow: 'candy_yellow', purple: 'candy_purple', orange: 'candy_orange',
   };
   ```

`GameScene.makeSprite()` already handles both modes via `ATLAS_KEY`.

### Extra polish (optional)

- **World backgrounds**: add the runtime image in `BootScene`, then extend
  `WORLD_THEMES` in `config.ts` with its texture key and accent palette.
- **Sound**: Kenney has free SFX packs — `this.load.audio('pop', 'assets/pop.mp3')`
  and `this.sound.play('pop')` in `pop()`.
- **Fonts**: use a bitmap font for crisp scoreboard numbers.
- **More colours / bigger board**: edit `GRID` in `config.ts`.

---

## Deploy

- **Production web**: use the five-gate release manager and active immutable
  release pointer described in `docs/production/release-and-rollback-runbook.md`.
- **Windows and Android**: install the same signed-manifest Phaser PWA from the
  browser's install action. No APK, native desktop binary or Unity client is
  part of this release.
- **Server**: the deployed Fastify/SQLite API reports schema 20. Public game
  traffic uses HTTPS 443; the dedicated admin transport on 8444 is tailnet-only,
  and Fastify independently rejects non-tailnet admin source addresses.

---

## Art/gameplay synchronization

The launcher artwork is not a static decoration. `GameScene` rotates it toward
the current aim, moves the loaded bubble with the muzzle, and triggers recoil,
energy flash, and directional sparks on every shot. Bubble art shares the same
textures in the menu, grid, projectile, preview, and match/drop effects.
