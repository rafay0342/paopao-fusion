# PaoPao Fusion V14 Art Bible

Status: locked for candidate production. This document governs V14 only. V2 through V13 remain immutable legacy history and are not canon references unless a V14 brief names a specific visual role.

## North star

PaoPao Fusion is an original mascot-led cinematic casual-fantasy world. Its visual language combines expressive Pao spirits, pearl and crystal translucency, warm gold craft, readable silhouettes and hopeful magical landscapes. Corruption introduces tension through fractured rhythm and dimmed material response; it never turns the game into horror or combat presentation.

The player should understand the main action within five seconds. Every screen has one dominant hero focal point, one clear play action and a calm hierarchy around the active board.

## Canon anchors

### The Keeper

- One fixed, non-photoreal Keeper appears in menus, story and cinematics.
- Proportions are stylized and friendly: large readable eyes, compact hands, broad shape language and no realistic skin rendering.
- Costume language is pearl cloth, faceted crystal closures and restrained gold seams.
- The silhouette remains recognizable at 64 CSS pixels.
- Age, facial proportions, hair shape and costume construction do not change between assets.

### Lumi

- Lumi is one pearl-white, turquoise-eyed Pao guide.
- The body is a soft floating pearl form with a small crown-like crest and two expressive side fins.
- Turquoise eyes, a cyan inner glow and a gold collar mark remain fixed.
- Lumi is never replaced by a spherical purple-eyed variant or a human-like character.
- Required expression language: attentive idle, delighted confirmation, worried anticipation, focused guidance, soft recovery and celebratory pop.

### Aurora Crown

- The crown is a warm-gold crescent structure around a floating aurora crystal.
- Three asymmetrical pearl points prevent it from reading as a generic royal crown.
- Restored state uses coherent turquoise-to-violet light. Corrupted state introduces controlled hairline fractures and missing light, not spikes, gore or weapon motifs.

### Launcher

- The launcher reads as a magical instrument, not a weapon.
- Its fixed silhouette is a pearl bowl, two gold guide arms and a floating crystal cradle.
- Aim feedback uses a turquoise dotted trajectory with a bright contact bead.
- Charge, ready and release states are readable without relying on hue.

## Six Pao gameplay identities

Colour is never the only signal. Each family owns a silhouette, engraved symbol and facial cue that survives grayscale and common colour-vision simulations.

| Stable colour | Material identity | Silhouette cue | Engraved symbol | Facial cue |
|---|---|---|---|---|
| Blue | sapphire water-glass | teardrop crown | double wave | curious raised brow |
| Green | emerald leaf-glass | leaf side fins | spiral sprout | calm closed smile |
| Red | ruby ember-glass | flame crest | upward chevron | brave focused eyes |
| Yellow | sun-pearl | round sun rays | four-point star | joyful wide eyes |
| Purple | amethyst dream-glass | crescent ears | open eye | thoughtful half-lids |
| Orange | amber dawn-glass | twin rounded peaks | rising arc | playful diagonal smile |

Both Bubble Shooter and Prism Cascade Match-3 use these same identities. Material, symbol, expression and pop language remain identical across modes. Shape adjustments may fit a grid cell but may not create a different character.

## Realm grammar

All realm compositions are portrait-first and include crop bleed for mobile and desktop.

| Realm | Hopeful grammar | Corrupted grammar |
|---|---|---|
| Crystal | clear quartz gardens, cyan caustics, pearl paths | interrupted caustics, muted quartz, thin violet fractures |
| Emerald | luminous leaf vaults, moss pearls, spiral vines | stalled growth, angular vine gaps, cold shadow pockets |
| Ember | amber hearths, soft ash motes, rounded basalt | dim hearth cores, broken glow rhythm, deep indigo ash |
| Celestial | aurora clouds, star pearls, floating gold rings | displaced rings, occluded stars, uneven aurora bands |
| Frostbound | milky ice, blue-white bloom, warm refuge lights | brittle facets, reduced bloom, distant violet fissures |
| Nexus | coherent prism bridges, pearl void, ordered constellations | phase offsets, fractured bridges, sparse red-violet interference |

Corruption is a material and rhythm state. It does not add fighting poses, weapons, copied monsters or franchise iconography.

## Composition and safe zones

Every environment master preserves:

- top HUD safety: the upper 14 percent carries low-frequency detail and no faces;
- shooter safety: the central 58 percent keeps strong silhouettes away from the hex board;
- Match-3 safety: the central square remains contrast-stable behind the grid;
- launcher safety: the lower 18 percent keeps the cradle and hand guide legible;
- desktop bleed: at least 12 percent lateral crop tolerance;
- mobile bleed: at least 8 percent vertical crop tolerance.

Background, midground, gameplay plane, foreground, atmosphere and optional corruption overlays remain separable. A flattened preview never replaces the editable layered source.

## Surface and light

- Pearl uses broad soft highlights with a faint subsurface tint.
- Crystal uses two or three readable facet families, restrained internal caustics and controlled edge bloom.
- Gold is warm and crafted, with moderate roughness; it is never mirror chrome.
- Magical light is motivated by a visible crystal, crown, portal or Pao.
- Bloom never erases engraved gameplay symbols or facial cues.
- Runtime variants preserve the same value hierarchy at performance, balanced and ultra quality.

## Animation language

- Anticipation compresses before movement; release expands along the action direction.
- Pao motion uses soft squash, short overshoot and a stable bottom-centre anchor.
- Frame one remains locked when a strip must loop or transition continuously.
- Selected, anticipation, pop and recovery states preserve identity marks.
- Reduced motion removes camera travel and decorative loops while retaining state changes, contact confirmation and rewards.
- Cinematics use continuous layered motion. Storyboards are planning evidence, not final slideshow delivery.

## UI and typography

Panels, buttons, durable labels and simple icons remain deterministic SVG or Phaser artwork. Generated imagery is used for character, realm, illustrated item, story, promotion and VFX sources.

- normal text contrast is at least 4.5:1;
- body text is at least 16 CSS pixels;
- durable labels are at least 14 CSS pixels;
- interactive targets are at least 44 by 44 CSS pixels;
- controls never cover the live board or the hand-tracking contact point;
- important states pair colour with shape, icon and plain-language copy.

Generated imagery contains no baked words, logos, signatures or watermarks.

## Generation and continuity

Each canon anchor receives three genuinely independent candidates. A contact sheet is approved before dependent production begins. The approved image becomes the seed reference for every later pose, strip, cinematic layer and promotional crop.

Simple isolated subjects use a removable chroma background, followed by soft matte extraction and despill. Character animation is generated as one complete strip edit from the approved seed; frames are not generated independently.

The manifest records the final prompt, negative constraints, reference roles and hashes, actual tool and mode, generation timestamp, rights statement and source digest. Model, seed and output ID remain `null` unless the generation tool actually returns them.

## Disallowed outcomes

- photoreal Keeper or inconsistent age and anatomy;
- a second Lumi design;
- copied franchise mascots, film characters or studio-specific imitation;
- fighting-game content, weapons or combat presentation;
- generic geometric documentation boards presented as finished art;
- random semantic values without authored production meaning;
- baked typography, watermarks, signatures or approval marks;
- unintended crop, alpha halo, chroma spill, malformed anatomy or drifting animation anchors;
- synthetic upscaling described as native generated detail.

## Approval evidence

Every approved PF source must have:

1. the three-candidate or continuity review contact sheet;
2. an actual-scale Phaser capture;
3. a mobile and desktop capture for client-facing compositions;
4. grayscale and colour-vision checks for gameplay pieces;
5. source integrity and provenance recorded in `art-source/v14/manifest.json`;
6. at least one concrete runtime usage reference;
7. the assigned gate marked approved only after all 100 IDs pass.
