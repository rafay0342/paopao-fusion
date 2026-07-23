import { LEVELS, WORLD_THEMES } from '../config';

export const STORY_TITLE = 'PAOPAO FUSION: THE SHATTERED CROWN';
export const STORY_TAGLINE = 'Six realms. Six shards. One last Prism Keeper.';

export interface StoryCharacter {
  id: string;
  name: string;
  role: string;
  description: string;
}

export interface StoryBeat {
  level: number;
  chapter: number;
  kicker: string;
  title: string;
  speaker: string;
  body: string;
  purpose: string;
  aftermath: string;
}

export interface StoryChapter {
  world: number;
  number: string;
  title: string;
  subtitle: string;
  guardian: string;
  shard: string;
  levelRange: readonly [number, number];
  summary: string;
}

export interface ChronicleLore {
  title: string;
  body: string;
}

export interface StoryProgress {
  levelsCleared: number;
  realmsRestored: number;
  shardsRecovered: number;
  crownRestored: boolean;
}

export const PREMISE =
  'For ages, the Aurora Crown kept colour, memory, flame, frost, nature and motion in harmony across six realms. The Nexus Architect shattered it into six Crown Shards, opened the Rift and bound each shard to a corrupted guardian. You are the last Prism Keeper. Guided by the sentient Pao spirits, you must heal—not destroy—the guardians and reunite the Crown.';

export const CHARACTERS: readonly StoryCharacter[] = [
  {
    id: 'keeper',
    name: 'THE LAST PRISM KEEPER',
    role: 'PLAYER HERO',
    description: 'The final bearer of the Prism Launcher. Your gift is Fusion: matching Pao spirits into harmonies strong enough to cleanse Rift corruption.',
  },
  {
    id: 'lumi',
    name: 'LUMI',
    role: 'PAO GUIDE',
    description: 'The eldest awakened Pao spirit and the voice of the Crown. Lumi remembers the realms as they were and senses the goodness still alive inside every guardian.',
  },
  {
    id: 'guardians',
    name: 'THE SIX GUARDIANS',
    role: 'WOUNDED PROTECTORS',
    description: 'Prism Warden, Heartwood Guardian, Astral Sentinel, Inferno Sovereign, Frost Regent and Nexus Architect. Each protects a Crown Shard, willingly or not.',
  },
  {
    id: 'architect',
    name: 'THE NEXUS ARCHITECT',
    role: 'FALLEN CROWNMAKER',
    description: 'Once charged with maintaining the Crown, the Architect came to fear free will as chaos. The Rift promised perfect order; its promise became a prison.',
  },
] as const;

export const STORY_CHAPTERS: readonly StoryChapter[] = [
  {
    world: 0,
    number: 'I',
    title: 'CRYSTAL KINGDOM',
    subtitle: 'THE AWAKENING',
    guardian: 'PRISM WARDEN',
    shard: 'SHARD OF LIGHT',
    levelRange: [0, 2],
    summary: 'Awaken the Prism path, break the moonlit seals and remind the first guardian whom it was sworn to protect.',
  },
  {
    world: 1,
    number: 'II',
    title: 'EMERALD WILDS',
    subtitle: 'THE LIVING FOREST',
    guardian: 'HEARTWOOD GUARDIAN',
    shard: 'SHARD OF LIFE',
    levelRange: [3, 5],
    summary: 'Follow living sparks through strangled roots and return the forest heartbeat to its ancient rhythm.',
  },
  {
    world: 2,
    number: 'III',
    title: 'CELESTIAL TEMPLE',
    subtitle: 'ABOVE THE CLOUDS',
    guardian: 'ASTRAL SENTINEL',
    shard: 'SHARD OF MEMORY',
    levelRange: [6, 8],
    summary: 'Reopen the skyway, align the silent orrery and recover the memory of the night the Crown broke.',
  },
  {
    world: 3,
    number: 'IV',
    title: 'EMBER FORGE',
    subtitle: 'THE UNBOUND FLAME',
    guardian: 'INFERNO SOVEREIGN',
    shard: 'SHARD OF FLAME',
    levelRange: [9, 11],
    summary: 'Cross the obsidian bastion, cool the Rift-fed forge and free a guardian consumed by endless fury.',
  },
  {
    world: 4,
    number: 'V',
    title: 'FROSTBOUND CITADEL',
    subtitle: 'THE ETERNAL WINTER',
    guardian: 'FROST REGENT',
    shard: 'SHARD OF STILLNESS',
    levelRange: [12, 14],
    summary: 'Crack armour made from frozen grief without breaking the memories it was built to preserve.',
  },
  {
    world: 5,
    number: 'VI',
    title: 'MAGNETIC NEXUS',
    subtitle: 'THE SHIFTING RIFT',
    guardian: 'NEXUS ARCHITECT',
    shard: 'SHARD OF MOTION',
    levelRange: [15, 17],
    summary: 'Stabilize the impossible field, close the Rift engine and prove that harmony needs choice—not control.',
  },
] as const;

export const STORY_BEATS: readonly StoryBeat[] = [
  {
    level: 0, chapter: 0, kicker: 'THE LAST LIGHT', title: 'A KEEPER AWAKENS', speaker: 'LUMI',
    body: 'The Aurora Crown is broken, Keeper. I felt your light answer from beneath the ruins. Wake the Pao spirits; together, we can still reach the first shard.',
    purpose: 'Open the Prism Gate and restore the road into the Crystal Kingdom.',
    aftermath: 'The sleeping path remembers your touch. Far below, something ancient turns toward the light.',
  },
  {
    level: 1, chapter: 0, kicker: 'AN ECHO IN GLASS', title: 'THE MOONLIT SEALS', speaker: 'LUMI',
    body: 'These seals were shaped to protect the Crown Vault. The Rift has turned protection into a prison. Fuse beside each crystal until its true resonance answers.',
    purpose: 'Break the corrupted seals without extinguishing the Pao light inside them.',
    aftermath: 'The final seal sings one clear note: the Prism Warden is alive—and fighting the Rift within.',
  },
  {
    level: 2, chapter: 0, kicker: 'GUARDIAN OF LIGHT', title: 'THE FIRST PROMISE', speaker: 'PRISM WARDEN',
    body: 'I remember my oath… yet the shard commands me to bar your way. Keeper, let your Fusion be stronger than its command.',
    purpose: 'Cleanse the Prism Warden and recover the Shard of Light.',
    aftermath: 'The Warden kneels, restored. The first shard rises, pointing toward a forest whose heartbeat is fading.',
  },
  {
    level: 3, chapter: 1, kicker: 'THE GREEN WHISPER', title: 'SPARKS IN THE MOSS', speaker: 'LUMI',
    body: 'The Shard of Light reveals tiny emerald Paos hiding beneath the roots. Follow their sparks; they alone know a living path through the Wilds.',
    purpose: 'Follow the emerald trail and reconnect the forest path.',
    aftermath: 'The trail opens, but every root bends toward the Heartwood Shrine as if pulled by a silent wound.',
  },
  {
    level: 4, chapter: 1, kicker: 'ROOTS REMEMBER', title: 'THE STRANGLED CANOPY', speaker: 'EMERALD PAOS',
    body: 'The vines are not our enemy. Rift thorns have bound them into knots. Free each ancient treetop and the forest will carry your light onward.',
    purpose: 'Release the vine-bound Paos and heal the canopy network.',
    aftermath: 'Sap runs bright again. Through every branch comes one shared plea: save our guardian.',
  },
  {
    level: 5, chapter: 1, kicker: 'GUARDIAN OF LIFE', title: 'THE HEART BEATS TWICE', speaker: 'HEARTWOOD GUARDIAN',
    body: 'I held the forest’s pain so no root would bear it. The shard magnified that pain until I forgot the spring. Remind me.',
    purpose: 'Purify the Heartwood Guardian and recover the Shard of Life.',
    aftermath: 'Two shards harmonize. Their song grows wings, building a stair of cloud toward the Celestial Temple.',
  },
  {
    level: 6, chapter: 2, kicker: 'THE SKYWAY', title: 'STEPS ABOVE THE STORM', speaker: 'LUMI',
    body: 'The temple once recorded every choice made beneath its stars. Its gates now drift between broken spaces. The portal Paos can bridge them.',
    purpose: 'Open the cloudstep route and reach the silent temple.',
    aftermath: 'The last portal steadies. Beyond it, the great orrery waits with half its constellations missing.',
  },
  {
    level: 7, chapter: 2, kicker: 'A NIGHT ERASED', title: 'THE SILENT ORRERY', speaker: 'LUMI',
    body: 'Align the astral rings. The Shard of Memory hid the truth here: the Architect broke the Crown during the once-a-century Prism Convergence.',
    purpose: 'Charge every portal core and restore the lost constellation.',
    aftermath: 'The sky replays the betrayal. The Astral Sentinel sealed itself inside the Crown chamber to contain the blast.',
  },
  {
    level: 8, chapter: 2, kicker: 'GUARDIAN OF MEMORY', title: 'THE STAR THAT STAYED', speaker: 'ASTRAL SENTINEL',
    body: 'I have watched that final moment forever. If memory cannot change, perhaps I cannot either. Show me a future the stars did not predict.',
    purpose: 'Free the Astral Sentinel and recover the Shard of Memory.',
    aftermath: 'Three shards reveal the Rift’s fuel: the Ember Forge is burning every possible future into one.',
  },
  {
    level: 9, chapter: 3, kicker: 'THE BLACK SEAL', title: 'FIRE WITHOUT DAWN', speaker: 'LUMI',
    body: 'The Forge once warmed all six realms. Now obsidian seals trap its heat until the pressure tears new wounds in the sky.',
    purpose: 'Break the bastion seal and give the fire somewhere safe to flow.',
    aftermath: 'A furnace wind answers. Deep within, ember Paos count down toward a chain reaction.',
  },
  {
    level: 10, chapter: 3, kicker: 'THE LAST COUNTDOWN', title: 'HEARTS OF EMBER', speaker: 'EMBER PAOS',
    body: 'Each ember carries a stolen possibility. Cool us before the Rift consumes it, and those futures can return to the Crown.',
    purpose: 'Cool every unstable ember core before it erupts.',
    aftermath: 'The crucible quiets. One flame remains: the Inferno Sovereign, raging to keep the greater fire contained.',
  },
  {
    level: 11, chapter: 3, kicker: 'GUARDIAN OF FLAME', title: 'THE FIRE THAT CHOSE', speaker: 'INFERNO SOVEREIGN',
    body: 'The Rift showed me a world without loss. I fed it every flame I had. If freedom means uncertainty, prove it is still worth defending.',
    purpose: 'Cleanse the Inferno Sovereign and recover the Shard of Flame.',
    aftermath: 'Four shards join. Their warmth reveals a frozen citadel built to preserve what the Rift could not rewrite.',
  },
  {
    level: 12, chapter: 4, kicker: 'THE FROZEN ROAD', title: 'MEMORY UNDER ICE', speaker: 'LUMI',
    body: 'The Frostbound Citadel kept the Keepers’ oldest memories. The Regent froze everything when the Crown fell—even grief. Crack the passage, not its history.',
    purpose: 'Open a careful path through the ice-armoured Paos.',
    aftermath: 'Warm light reaches the archive doors. Inside, ice cores hold the last messages of the missing Keepers.',
  },
  {
    level: 13, chapter: 4, kicker: 'VOICES PRESERVED', title: 'THE GLACIAL CROWN', speaker: 'THE LOST KEEPERS',
    body: 'If one Keeper hears us: the Crown was never power. It was a promise that no single will would rule the six realms.',
    purpose: 'Break the ancient ice cores and release the Keepers’ final testimony.',
    aftermath: 'Their truth thaws the throne. The Frost Regent lowers its shield, afraid to feel the centuries it locked away.',
  },
  {
    level: 14, chapter: 4, kicker: 'GUARDIAN OF STILLNESS', title: 'WHEN WINTER ENDS', speaker: 'FROST REGENT',
    body: 'I froze the realm to save it from change. In perfect stillness, nothing could be lost—and nothing could live. Bring back the spring.',
    purpose: 'Heal the Frost Regent and recover the Shard of Stillness.',
    aftermath: 'Five shards form an unfinished crown. Its open point aims directly into the impossible geometry of the Magnetic Nexus.',
  },
  {
    level: 15, chapter: 5, kicker: 'THE IMPOSSIBLE FIELD', title: 'GRAVITY OF THE RIFT', speaker: 'LUMI',
    body: 'The Nexus pulls every shard away from every other. Stabilize its shifting rows. The Pao spirits will hold formation as long as you give them harmony.',
    purpose: 'Cross the Polarity Gate without letting the Rift scatter the Paos.',
    aftermath: 'The gate locks into place. Ahead, the Orbital Engine turns choice itself into fuel.',
  },
  {
    level: 16, chapter: 5, kicker: 'THE MACHINE OF ONE FUTURE', title: 'ORBITAL ENGINE', speaker: 'NEXUS ARCHITECT',
    body: 'You call it freedom; I calculated only collision. Six realms cannot remain balanced while every heart chooses its own direction.',
    purpose: 'Discharge the polarity nodes and shut down the Rift engine.',
    aftermath: 'The engine stops. For the first time, the Architect stands without a perfect future to hide behind.',
  },
  {
    level: 17, chapter: 5, kicker: 'THE FINAL FUSION', title: 'A CROWN OF CHOICES', speaker: 'NEXUS ARCHITECT',
    body: 'I forged the Crown to impose harmony. When it failed, I chose control. If your living chaos is stronger, Keeper—let all six spirits answer together.',
    purpose: 'Free the Architect, recover the Shard of Motion and close the Rift.',
    aftermath: 'The six shards rise. The Crown waits for one final choice: rule the realms, or return their harmony to everyone.',
  },
  {
    level: 18, chapter: 0, kicker: 'A HIDDEN ANGLE', title: 'REFRACTION HALL', speaker: 'LUMI',
    body: 'The Gate casts a second path through the glass. Follow its broken reflections and the Crown will reveal what the Warden concealed.',
    purpose: 'Trace the hidden crystal route and release every Pao sealed behind its reflections.', aftermath: 'A pure echo answers from behind the vault wall and illuminates a forgotten royal passage.',
  },
  {
    level: 19, chapter: 0, kicker: 'LIGHT RETURNS', title: 'PRISM ECHO', speaker: 'PRISM WARDEN',
    body: 'Light is not weakened when it is shared. Send my restored resonance through every prism and carry it onward.',
    purpose: 'Master the returning light before confronting the Warden at the heart of the vault.', aftermath: 'The Crystal Kingdom opens its deepest crown road and the first guardian senses your arrival.',
  },
  {
    level: 20, chapter: 1, kicker: 'BENEATH THE ROOTS', title: 'SPORELIGHT HOLLOW', speaker: 'EMERALD PAOS',
    body: 'Small lights slept where the Rift could not see them. Wake them gently; their roots remember the road home.',
    purpose: 'Wake the sleeping root network and reconnect its scattered emerald Pao spirits.', aftermath: 'The hollow blooms in emerald light and reveals a thornbound ascent toward the forest crown.',
  },
  {
    level: 21, chapter: 1, kicker: 'THE FOREST CROWN', title: 'THORNCROWN PATH', speaker: 'LUMI',
    body: 'These thorns grew from fear, not malice. Restore their rhythm and they will guard the Wilds again.',
    purpose: 'Purify the forest crown before reaching the wounded guardian inside Heartwood Shrine.', aftermath: 'The living path bows toward its guardian as every restored branch carries your light forward.',
  },
  {
    level: 22, chapter: 2, kicker: 'FORBIDDEN MEMORY', title: 'COMET ARCHIVE', speaker: 'ASTRAL SENTINEL',
    body: 'One memory escaped the Architect: a comet recorded the Crown choosing its Keepers freely. Bring that truth back.',
    purpose: 'Recover the lost comet record and return its forbidden truth to the Celestial archive.', aftermath: 'A bridge of remembered stars forms overhead and points toward the temple’s highest chamber.',
  },
  {
    level: 23, chapter: 2, kicker: 'AT THE ZENITH', title: 'ZENITH BRIDGE', speaker: 'LUMI',
    body: 'The bridge exists only while its constellations agree. Hold their pattern and cross before the Rift rewrites the sky.',
    purpose: 'Stabilize the path between stars long enough for every celestial Pao to cross safely.', aftermath: 'The Astral Crown comes within reach while the restored constellations hold back the Rift.',
  },
  {
    level: 24, chapter: 3, kicker: 'FUTURES IN ASH', title: 'ASHEN GALLERY', speaker: 'EMBER PAOS',
    body: 'Every ember here was once a possible tomorrow. Release us, and choice can burn brightly again.',
    purpose: 'Free the captive embers without feeding the Rift or erasing the futures inside them.', aftermath: 'The liberated fire points toward an ancient anvil where possibility was once forged freely.',
  },
  {
    level: 25, chapter: 3, kicker: 'LIVING FLAME', title: 'PHOENIX ANVIL', speaker: 'INFERNO SOVEREIGN',
    body: 'A true flame changes with every breath. Forge harmony here, Keeper, and face me without fear of uncertainty.',
    purpose: 'Forge a stable resonance from living fire while preserving its power to change and choose.', aftermath: 'The way to the Inferno Throne burns clear and the Sovereign finally hears a hopeful flame.',
  },
  {
    level: 26, chapter: 4, kicker: 'KEEPER VOICES', title: 'AURORA ARCHIVE', speaker: 'THE LOST KEEPERS',
    body: 'We left our memories in ice so one future Keeper could learn from us without being ruled by us.',
    purpose: 'Thaw the ancient archive without shattering the memories and voices preserved inside it.', aftermath: 'The Keepers’ final map appears inside a mirror of frost and reveals the safest path onward.',
  },
  {
    level: 27, chapter: 4, kicker: 'FRACTURED WINTER', title: 'MIRRORGLASS PASS', speaker: 'LUMI',
    body: 'Every reflection shows a different ending. Choose the living road and let the false winters fall away.',
    purpose: 'Cross the fractured pass while identifying and preserving the realm’s true living memories.', aftermath: 'Spring light reaches the Regent’s gate and the frozen shield begins to remember warmth.',
  },
  {
    level: 28, chapter: 5, kicker: 'WITHOUT AN ANCHOR', title: 'GRAVITY WELL', speaker: 'LUMI',
    body: 'The Rift is pulling every Pao toward a single silent orbit. Anchor them with Fusion before choice disappears.',
    purpose: 'Stabilize the gravity well and rescue every Pao before the Rift silences their choices.', aftermath: 'Six distinct resonances survive the pull and begin forming a free constellation together.',
  },
  {
    level: 29, chapter: 5, kicker: 'SIX VOICES', title: 'CROWN CONVERGENCE', speaker: 'THE PAO CHORUS',
    body: 'We do not sing because the Crown commands us. We sing because every realm has chosen to answer.',
    purpose: 'Unite every restored resonance without forcing their voices into one before the final battle.', aftermath: 'The Nexus Heart opens for the last choice as all six realms answer of their own free will.',
  },
] as const;

export const CHRONICLE_LORE: readonly ChronicleLore[] = [
  {
    title: 'PAO SPIRITS & FUSION',
    body: 'Paos are living notes of Aurora energy. Matching three lets them resonate; chains, bank shots and falling clusters make the harmony stronger. They fight beside the Keeper by choice.',
  },
  {
    title: 'KEEPER RELICS',
    body: 'The Mystery Vault contains tools left by vanished Prism Keepers. Its artifacts, orb forms and badges are recovered history—not random treasure conjured from nowhere.',
  },
  {
    title: 'DAILY PRISM ECHOES',
    body: 'The Rift repeats stable echoes of past battles. Daily Prism challenges let Keepers enter the same echo, under the same conditions, and compare how they restore it.',
  },
  {
    title: 'THE GUARDIAN OATH',
    body: 'A guardian cannot be restored by force alone. Every boss battle is a cleansing ritual: Fusion weakens the corruption until the guardian can choose its oath again.',
  },
] as const;

export const ENDING_PASSAGES = [
  'Six Crown Shards answer six restored realms.',
  'The Pao spirits lend their light freely. No chain commands them.',
  'The Nexus Architect sees a future no machine predicted: imperfect, shared and alive.',
  'The Aurora Crown reforms—not above the realms, but between them.',
  'You remain their Keeper, never their ruler. The Rift closes. A new constellation begins.',
] as const;

export function storyBeatForLevel(level: number): StoryBeat {
  const safeLevel = Math.min(Math.max(0, Math.trunc(level)), STORY_BEATS.length - 1);
  return STORY_BEATS[safeLevel];
}

export function storyChapterForLevel(level: number): StoryChapter {
  return STORY_CHAPTERS[storyBeatForLevel(level).chapter];
}

export function storyProgressFromStars(stars: readonly number[]): StoryProgress {
  const levelsCleared = LEVELS.reduce((total, _level, index) => total + ((stars[index] ?? 0) > 0 ? 1 : 0), 0);
  const realmsRestored = STORY_CHAPTERS.reduce(
    (total, chapter) => total + ((stars[chapter.levelRange[1]] ?? 0) > 0 ? 1 : 0),
    0,
  );
  return {
    levelsCleared,
    realmsRestored,
    shardsRecovered: realmsRestored,
    crownRestored: realmsRestored === STORY_CHAPTERS.length,
  };
}

export function validateStoryCanon(): boolean {
  if (STORY_BEATS.length !== LEVELS.length || STORY_CHAPTERS.length !== WORLD_THEMES.length) return false;
  return STORY_BEATS.every((beat, level) => (
    beat.level === level
    && beat.chapter === LEVELS[level].world
    && STORY_CHAPTERS[beat.chapter]?.title === WORLD_THEMES[beat.chapter]?.name
  ));
}
