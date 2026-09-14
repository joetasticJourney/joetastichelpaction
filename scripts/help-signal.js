const MODULE_ID   = "joetastic-help-signal";
const SOCKET      = `module.${MODULE_ID}`;

// All configurable cue settings. Cues get baked into the effect (for
// trigger/expire) AND ride along on the apply-cue socket broadcast so
// every client plays the instigator's chosen sound locally on their own
// machine (scaled by each client's own volume slider).
const CUE_KEYS = [
  "applySound", "applyAnimation",
  "attackSound", "reminderSound", "attackAnimation",
  "expireSound", "expireAnimation"
];

// Three flavors of Help. `attack` is the original; `save` and `ability` were
// added later. Each variant has its own status effect, macro, item, and drag
// menus, but they share the sound + animation settings and the
// apply→trigger→expire cue lifecycle. Effect IDs must be exactly 16
// alphanumeric characters. The attack variant preserves its original
// identity (id, statusId, macro flag, item flag) for backward compat with
// existing worlds — only its cosmetic name changes from "Helped" to
// "Help-Attack".
const VARIANTS = {
  attack: {
    key: "attack",
    effectName: "Help-Attack",
    effectId: "joetastichelped0",
    statusId: "helped",
    icon: `modules/${MODULE_ID}/icons/help-advantage.svg`,
    macroName: "Apply Help-Attack",
    macroFlag: "managedMacro",
    itemName: "Help-Attack Action",
    itemFlag: "managedItem",
    isHelpFeatFlag: "isHelpFeat",
    cardButtonLabel: "▶ Apply Help-Attack",
    itemDescription:
      `<p><em>Help another creature attack a foe within 5 feet.</em></p>
       <p>Target the enemy your ally will attack, then click Apply Help-Attack.</p>
       <p>Grants advantage on the next attack roll against that target before the start of your next turn.</p>`,
    rollTypes: ["attack"],
    // Which side of a roll to look at when deciding if the mark "worked".
    // "target"  → check dnd5e.targets (attacker rolls at us — mark the enemy).
    // "speaker" → check the roller (marked creature rolls a save/check).
    matchScope: "target",
    // Which advantage direction counts as the success cue. "advantage" plays
    // the attack cue on advantage / reminder cue otherwise. "disadvantage"
    // plays the attack cue on disadvantage / reminder cue otherwise. null
    // disables the trigger cue entirely (variant is marker-only).
    triggerMode: "advantage",
    // Auto-clear the effect at start of the instigator's next turn.
    autoExpire: true
  },
  save: {
    key: "save",
    effectName: "Help-Save",
    effectId: "joetastichelpsav",
    statusId: "helpsave",
    icon: `modules/${MODULE_ID}/icons/help-save.svg`,
    macroName: "Apply Help-Save",
    macroFlag: "managedMacroSave",
    itemName: "Help-Save Action",
    itemFlag: "managedItemSave",
    isHelpFeatFlag: "isHelpSaveFeat",
    cardButtonLabel: "▶ Apply Help-Save",
    itemDescription:
      `<p><em>Hinder a foe on their next saving throw.</em></p>
       <p>Target the enemy who will roll the save, then click Apply Help-Save.</p>
       <p>Imposes disadvantage on the next saving throw that creature makes before the start of your next turn.</p>`,
    rollTypes: ["save", "concentration"],
    matchScope: "speaker",
    triggerMode: "disadvantage",
    autoExpire: true
  },
  ability: {
    key: "ability",
    effectName: "Help-Ability",
    effectId: "joetastichelpabi",
    statusId: "helpability",
    icon: `modules/${MODULE_ID}/icons/Help-ability.svg`,
    macroName: "Apply Help-Ability",
    macroFlag: "managedMacroAbility",
    itemName: "Help-Ability Action",
    itemFlag: "managedItemAbility",
    isHelpFeatFlag: "isHelpAbilityFeat",
    cardButtonLabel: "▶ Apply Help-Ability",
    itemDescription:
      `<p><em>Help another creature with an ability check.</em></p>
       <p>Target the ally who will make the check, then click Apply Help-Ability.</p>
       <p>Grants advantage on the next ability check that creature makes before the start of your next turn.</p>`,
    // Fires on any ability-check-flavored roll (raw ability, skill, or tool check).
    rollTypes: ["check", "skill", "tool", "ability"],
    // The helped ally rolls the check — match on the roller (speaker).
    matchScope: "speaker",
    // Advantage = help was used → good cue. Otherwise → reminder cue.
    triggerMode: "advantage",
    // Suppress the "help worked" cue when the ability check is on one of
    // these skill IDs. Performance is excluded because it's the Band Mate
    // trigger — we don't want the help-worked cue overlapping the Band Mate
    // sound. Other ability checks still play the success cue normally.
    suppressSuccessOnSkills: ["prf"],
    autoExpire: true
  }
};

const DEFAULT_VARIANT_KEY = "attack";

// Band Mate feature: each user gets one toggle macro per named band mate. A
// macro plays its mate's sound (globally) whenever the acting user casts a
// spell, uses Bardic Inspiration, or rolls Performance. Only one mate can be
// active at a time per user (enforced in toggleBandMate).
const BAND_MATE_ICON_ON  = `modules/${MODULE_ID}/icons/bandmate-check.svg`;
const BAND_MATE_ICON_OFF = `modules/${MODULE_ID}/icons/bandmate-x.svg`;
// Every user has exactly ONE band-mate macro (representing their current
// selection). BAND_MATE_MATE_FLAG stores which mate that macro currently
// points at — updated in place whenever the user changes selection via the
// Band Mate menu. BAND_MATE_USER_FLAG identifies the owning user so we can
// find the macro to update/delete without a full ownership scan.
const BAND_MATE_MATE_FLAG = "bandMateMateKey";
const BAND_MATE_USER_FLAG = "bandMateUserId";
// User-doc flag: the mate key the user has chosen. Read-through to derive
// which mate the user's macro should currently represent.
const BAND_MATE_SELECTED_FLAG = "selectedBandMateKey";
// Legacy flag from a very early version — used only for cleanup of stale
// macros left over from before mate/user flags were introduced.
const BAND_MATE_LEGACY_USER_FLAG = "bandMateMacroUserId";

// Each mate carries its own animation path plus ColorMatrix filter params
// (hue rotation, saturation, brightness) so the visual can be uniquely styled.
// Rainbow enables an animated hue rotation on the ColorMatrix filter.
const BAND_MATES = [
  { key: "scales",  name: "Scales",
    defaultSound: "joetastic-help-signal.scales",
    defaultAnimation: "joetastic-help-signal.music_notations.orange",
    defaultHue: 0, defaultSaturate: 1, defaultBrightness: 1, defaultRainbow: false },
  { key: "dreadie", name: "Dreadie",
    defaultSound: "joetastic-help-signal.dreadie",
    // Green source hue-shifted ~300° lands at yellow; boosted brightness +
    // reduced saturation reads as "very light yellow".
    defaultAnimation: "joetastic-help-signal.music_notations.green",
    defaultHue: 300, defaultSaturate: 0.6, defaultBrightness: 1.3, defaultRainbow: false },
  { key: "kaldur",  name: "Kaldur",
    defaultSound: "joetastic-help-signal.kaldur",
    // Saturate 0 + low brightness collapses the blue notes to near-black.
    defaultAnimation: "joetastic-help-signal.music_notations.blue",
    defaultHue: 0, defaultSaturate: 0, defaultBrightness: 0.2, defaultRainbow: false },
  { key: "enjee",   name: "Enjee",
    defaultSound: "joetastic-help-signal.enjee",
    defaultAnimation: "joetastic-help-signal.music_notations.purple",
    defaultHue: 0, defaultSaturate: 1, defaultBrightness: 1, defaultRainbow: false },
  { key: "rico",    name: "Rico",
    defaultSound: "joetastic-help-signal.rico",
    // Blue source + animated hue loop = rainbow-cycling notes.
    defaultAnimation: "joetastic-help-signal.music_notations.blue",
    defaultHue: 0, defaultSaturate: 1, defaultBrightness: 1, defaultRainbow: true }
];

const bandMateEnabledKey             = (mateKey) => `bandMateEnabled_${mateKey}`;
const bandMateSoundKey               = (mateKey) => `bandMateSound_${mateKey}`;
const bandMateAnimKey                = (mateKey) => `bandMateAnimation_${mateKey}`;
const bandMateHueKey                 = (mateKey) => `bandMateHue_${mateKey}`;
const bandMateSaturateKey            = (mateKey) => `bandMateSaturate_${mateKey}`;
const bandMateBrightnessKey          = (mateKey) => `bandMateBrightness_${mateKey}`;
const bandMateRainbowKey             = (mateKey) => `bandMateRainbow_${mateKey}`;
const bandMateTriggerSpellsKey       = (mateKey) => `bandMateTriggerSpells_${mateKey}`;
const bandMateTriggerBardicKey       = (mateKey) => `bandMateTriggerBardic_${mateKey}`;
const bandMateTriggerPerformanceKey  = (mateKey) => `bandMateTriggerPerformance_${mateKey}`;

// Band Mate state lives on the User document as flags — NOT in Foundry
// client-scoped settings. Foundry's client settings are stored in the
// browser's localStorage, which is shared across all users logged in from
// the same browser origin (last-write-wins between tabs). User flags are
// keyed by user id server-side and are properly per-user regardless of how
// the players are running their clients.
function bandMateGetFlag(key, defaultVal) {
  const v = game.user.getFlag(MODULE_ID, key);
  return v === undefined ? defaultVal : v;
}
function bandMateSetFlag(key, value) {
  return game.user.setFlag(MODULE_ID, key, value);
}
// Returns the default a specific per-mate flag should fall back to when the
// user has never explicitly set it. Kept centralized so the read helpers and
// the config dialog agree.
function bandMateDefaultFor(mate, key) {
  if (key === bandMateEnabledKey(mate.key))               return false;
  if (key === bandMateSoundKey(mate.key))                 return mate.defaultSound;
  if (key === bandMateAnimKey(mate.key))                  return mate.defaultAnimation;
  if (key === bandMateHueKey(mate.key))                   return mate.defaultHue ?? 0;
  if (key === bandMateSaturateKey(mate.key))              return mate.defaultSaturate ?? 1;
  if (key === bandMateBrightnessKey(mate.key))            return mate.defaultBrightness ?? 1;
  if (key === bandMateRainbowKey(mate.key))               return mate.defaultRainbow ?? false;
  if (key === bandMateTriggerSpellsKey(mate.key))         return true;
  if (key === bandMateTriggerBardicKey(mate.key))         return true;
  if (key === bandMateTriggerPerformanceKey(mate.key))    return true;
  return undefined;
}
function bandMateReadFor(mate, keyFn) {
  const key = keyFn(mate.key);
  return bandMateGetFlag(key, bandMateDefaultFor(mate, key));
}

// Locate the single band-mate macro belonging to a given user, regardless of
// which mate it currently represents. Every user has exactly one such doc.
function findUserBandMateMacro(userId) {
  return game.macros.find(m => m.getFlag(MODULE_ID, BAND_MATE_USER_FLAG) === userId);
}

// Resolve which mate a user has selected right now. Falls back to the first
// mate in BAND_MATES if the flag is missing (fresh user, migrating world).
function getUserSelectedMate(user) {
  const key = user?.getFlag?.(MODULE_ID, BAND_MATE_SELECTED_FLAG);
  return BAND_MATES.find(m => m.key === key) ?? BAND_MATES[0];
}

function getVariant(key) {
  return VARIANTS[key] ?? VARIANTS[DEFAULT_VARIANT_KEY];
}

function getVariantByEffectName(name) {
  return Object.values(VARIANTS).find(v => v.effectName === name) ?? null;
}

function getVariantForRollType(rollType) {
  if (!rollType) return null;
  return Object.values(VARIANTS).find(v => v.rollTypes.includes(rollType)) ?? null;
}

function getLocalCueConfig() {
  // Resolve any Sequencer DB folder paths to a concrete leaf HERE, so the
  // choice is made once on the instigator's client and baked into the
  // effect. All clients then play the exact same file when the cue fires,
  // even if broadcast mode is off.
  const cues = {};
  for (const k of CUE_KEYS) {
    const raw = game.settings.get(MODULE_ID, k);
    cues[k] = resolveDbPath(raw);
  }
  return cues;
}

const buildEffect = (variant, instigatorUuid = null, cues = null) => ({
  _id: variant.effectId,
  name: variant.effectName,
  img: variant.icon,
  statuses: [variant.statusId],
  duration: { seconds: 86400 },
  flags: {
    core: { statusId: variant.statusId },
    [MODULE_ID]: {
      variant: variant.key,
      instigatorUuid: instigatorUuid ?? null,
      cues: cues ?? null
    }
  }
});

async function applyToActor(actor, variant, instigatorUuid = null, cues = null) {
  if (!actor) return;
  if (actor.effects.find(e => e.name === variant.effectName)) return;
  await actor.createEmbeddedDocuments(
    "ActiveEffect",
    [buildEffect(variant, instigatorUuid, cues)],
    { keepId: true }
  );
}

// GM-only. Removes the effect defensively — deferred to the next tick so
// Foundry's own turn/effect-duration processing completes first, avoiding a
// race with ServerDatabaseBackend._updateDocuments on EmbeddedCollectionDelta.
function safeDeleteEffect(actor, effect) {
  if (!game.user.isGM || !actor || !effect) return;
  const uuid = effect.uuid;
  setTimeout(async () => {
    try {
      const fresh = await fromUuid(uuid);
      if (!fresh) return;
      await fresh.delete();
    } catch (e) {
      const msg = e?.message ?? "";
      if (/does not exist/i.test(msg)) return;
      console.warn(`${MODULE_ID} | safeDeleteEffect threw:`, e);
    }
  }, 50);
}

async function applyToActorUuids(uuids, variantKey, instigatorUuid = null, cues = null) {
  const variant = getVariant(variantKey);
  for (const uuid of uuids) {
    const actor = await fromUuid(uuid);
    await applyToActor(actor, variant, instigatorUuid, cues);
  }
}

async function requestApply(uuids, requesterName, variantKey = DEFAULT_VARIANT_KEY, instigatorUuid = null, cues = null) {
  if (!uuids?.length) return;
  const variant = getVariant(variantKey);

  if (game.user.isGM) {
    await applyToActorUuids(uuids, variant.key, instigatorUuid, cues);
    // ui.notifications.info(`Applied "${variant.effectName}" to ${uuids.length} target(s).`); // debug only
    return;
  }

  const gmOnline = game.users.some(u => u.isGM && u.active);
  if (!gmOnline) {
    ui.notifications.error("No active GM online to apply the effect.");
    return;
  }
  game.socket.emit(SOCKET, {
    action: "apply",
    actorUuids: uuids,
    requester: requesterName,
    variantKey: variant.key,
    instigatorUuid,
    cues
  });
  // ui.notifications.info(`Requested ${variant.effectName} for ${uuids.length} target(s).`); // debug only
}

function applyToCurrentTargets(variantKey = DEFAULT_VARIANT_KEY, explicitInstigator = null) {
  const variant = getVariant(variantKey);
  const targets = Array.from(game.user.targets);
  if (targets.length === 0) {
    ui.notifications.warn("Target one or more tokens first (press T).");
    return;
  }
  const uuids = targets.map(t => t.actor?.uuid).filter(Boolean);

  const instigatorActor = explicitInstigator
    ?? canvas.tokens?.controlled?.[0]?.actor
    ?? game.user.character;
  // Only variants that auto-expire on the instigator's turn need to know who
  // the instigator is. Marker-only variants (Help-Ability) skip the check.
  if (!instigatorActor && variant.autoExpire) {
    ui.notifications.error(
      `${variant.effectName} not applied: select your own token first so the effect knows whose turn to expire on.`
    );
    return;
  }

  if (!game.user.isGM && !game.users.some(u => u.isGM && u.active)) {
    ui.notifications.error("No active GM online to apply the effect.");
    return;
  }

  // Play the apply cue: locally for this user, plus a socket broadcast so
  // every OTHER client plays it locally on their own machine (at their own
  // volume). One sound per client; animation plays on each target token.
  const cues = getLocalCueConfig();
  const tokenUuids = targets.map(t => t.document?.uuid).filter(Boolean);
  game.socket.emit(SOCKET, { action: "applyCue", tokenUuids, cues });
  playApplyCueLocal(targets, cues);

  return requestApply(uuids, game.user.name, variant.key, instigatorActor?.uuid ?? null, cues);
}

// Play the apply cue on THIS client only. Sound is restricted via .forUsers
// so Sequencer doesn't rebroadcast; each client's own volume slider scales it.
function playApplyCueLocal(tokens, cues = null) {
  if (typeof Sequence === "undefined") return;
  const rawSound = cues?.applySound     ?? game.settings.get(MODULE_ID, "applySound");
  const rawAnim  = cues?.applyAnimation ?? game.settings.get(MODULE_ID, "applyAnimation");
  const soundPath = resolveDbPath(rawSound);
  const animPath  = rawAnim;
  const volume    = getVolume();

  const seq = new Sequence();
  let hasContent = false;
  if (soundPath) {
    seq.sound().file(soundPath).volume(volume).forUsers([game.user.id]);
    hasContent = true;
  }
  if (animPath) {
    for (const token of tokens) {
      if (!token) continue;
      seq.effect().file(animPath).atLocation(token).scaleToObject(1.5).forUsers([game.user.id]);
      hasContent = true;
    }
  }
  if (hasContent) seq.play();
}

function getVolume() {
  const v = Number(game.settings.get(MODULE_ID, "volume"));
  if (!Number.isFinite(v)) return 0.8;
  return Math.max(0, Math.min(1, v));
}

// Resolve a Sequencer DB path (possibly folder-level) to a concrete file path.
// - Raw file paths (containing / or \) are passed through.
// - DB leaf paths return the file string.
// - DB category paths return a random leaf under that category.
function resolveDbPath(input) {
  if (!input) return null;
  if (input.includes("/") || input.includes("\\")) return input;
  if (typeof Sequencer === "undefined" || !Sequencer.Database) return input;
  try {
    const entry = Sequencer.Database.getEntry(input, { softFail: true });
    if (!entry) return input;
    const leaves = [];
    const collect = (v) => {
      if (typeof v === "string") leaves.push(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === "object") {
        if (typeof v.file === "string") leaves.push(v.file);
        else Object.values(v).forEach(collect);
      }
    };
    collect(entry);
    if (leaves.length === 0) return input;
    return leaves[Math.floor(Math.random() * leaves.length)];
  } catch (e) {
    console.warn(`${MODULE_ID} | resolveDbPath failed for "${input}":`, e);
    return input;
  }
}

// Find the active user linked to an instigator actor UUID. Returns null if
// nobody matching is logged in — the caller should then skip playing a cue
// (the effect still gets cleared by the GM's own hook regardless).
function findInstigatorUser(instigatorUuid) {
  if (!instigatorUuid) return null;
  return game.users.find(u => u.active && u.character?.uuid === instigatorUuid) ?? null;
}

// Plays a cue. If broadcastFromUserId is set, only that user's client actually
// plays — but the play is a Sequencer broadcast, so every client hears it.
// If null, each client that calls this plays locally (per-client mode).
function playCue(kind, token, options = {}) {
  const { animKind = kind, broadcastFromUserId = null, overrides = null } = options;
  const broadcasting = broadcastFromUserId !== null;

  if (broadcasting && broadcastFromUserId !== game.user.id) return;

  // Prefer effect-baked cues (overrides) over the local player's settings, so
  // every client hears the same sound the instigator picked at apply time.
  const soundKey = `${kind}Sound`;
  const animKey  = `${animKind}Animation`;
  const rawSound = overrides?.[soundKey] ?? game.settings.get(MODULE_ID, soundKey);
  const rawAnim  = overrides?.[animKey]  ?? game.settings.get(MODULE_ID, animKey);
  const soundPath = resolveDbPath(rawSound);
  const animPath  = rawAnim;

  const volume = getVolume();

  if (typeof Sequence !== "undefined") {
    const seq = new Sequence();
    let hasContent = false;
    if (soundPath) {
      const s = seq.sound().file(soundPath).volume(volume);
      if (!broadcasting) s.forUsers([game.user.id]);
      hasContent = true;
    }
    if (animPath && token) {
      const e = seq.effect().file(animPath).atLocation(token).scaleToObject(1.5);
      if (!broadcasting) e.forUsers([game.user.id]);
      hasContent = true;
    }
    if (hasContent) seq.play();
    return;
  }

  if (soundPath) {
    foundry.audio.AudioHelper.play(
      { src: soundPath, volume, autoplay: true, loop: false },
      broadcasting
    );
  }
}

// Everything shipped with this module — sounds AND animations — registered
// under our namespace so the module is self-contained. Sequencer treats both
// audio and video files as leaves in the same DB tree; the consumer picks
// how to play them (.sound() vs .effect()).
const HARDCODED_SOUND_ENTRIES = {
  // Audio
  sparkle: `modules/${MODULE_ID}/Sounds/Sparkle.mp3`,
  boing:   `modules/${MODULE_ID}/Sounds/boing.mp3`,
  slides: {
    slide1: `modules/${MODULE_ID}/Sounds/Slides/Slide1.mp3`,
    slide2: `modules/${MODULE_ID}/Sounds/Slides/Slide2.mp3`,
    slide3: `modules/${MODULE_ID}/Sounds/Slides/Slide3.mp3`
  },
  guitaropenings: {
    areyougonnabemygirl:  `modules/${MODULE_ID}/Sounds/GuitarOpenings/areyougonnabemygirl.mp3`,
    baracudamaybe:        `modules/${MODULE_ID}/Sounds/GuitarOpenings/baracudamaybe.mp3`,
    blueoystercult:       `modules/${MODULE_ID}/Sounds/GuitarOpenings/Blueoystercult.mp3`,
    boomboom:             `modules/${MODULE_ID}/Sounds/GuitarOpenings/boomboom.mp3`,
    browneyedgirl:        `modules/${MODULE_ID}/Sounds/GuitarOpenings/brownEyedGirl.mp3`,
    comearound:           `modules/${MODULE_ID}/Sounds/GuitarOpenings/Comearound.mp3`,
    eyeofthetiger:        `modules/${MODULE_ID}/Sounds/GuitarOpenings/EyeOfTheTiger.mp3`,
    freakout:             `modules/${MODULE_ID}/Sounds/GuitarOpenings/freakout.mp3`,
    gotmenow:             `modules/${MODULE_ID}/Sounds/GuitarOpenings/GotMeNow.mp3`,
    kidsarealright:       `modules/${MODULE_ID}/Sounds/GuitarOpenings/Kidsarealright.mp3`,
    lastresort:           `modules/${MODULE_ID}/Sounds/GuitarOpenings/LastResort.mp3`,
    messageinabottle:     `modules/${MODULE_ID}/Sounds/GuitarOpenings/MessageInABottle.mp3`,
    metalica:             `modules/${MODULE_ID}/Sounds/GuitarOpenings/metalica.mp3`,
    novemberrain:         `modules/${MODULE_ID}/Sounds/GuitarOpenings/novemberrain.mp3`,
    part1:                `modules/${MODULE_ID}/Sounds/GuitarOpenings/part1.mp3`,
    part2:                `modules/${MODULE_ID}/Sounds/GuitarOpenings/part2.mp3`,
    part3:                `modules/${MODULE_ID}/Sounds/GuitarOpenings/Part3.mp3`,
    pearljam:             `modules/${MODULE_ID}/Sounds/GuitarOpenings/pearljam.mp3`,
    prettywoman:          `modules/${MODULE_ID}/Sounds/GuitarOpenings/prettywoman.mp3`,
    purplehaze:           `modules/${MODULE_ID}/Sounds/GuitarOpenings/purplehaze.mp3`,
    satisfaction:         `modules/${MODULE_ID}/Sounds/GuitarOpenings/Satisfaction.mp3`,
    sevennationarmy:      `modules/${MODULE_ID}/Sounds/GuitarOpenings/sevennationarmy.mp3`,
    smokeonthewater:      `modules/${MODULE_ID}/Sounds/GuitarOpenings/smokeonthewater.mp3`,
    snow:                 `modules/${MODULE_ID}/Sounds/GuitarOpenings/snow.mp3`,
    somein:               `modules/${MODULE_ID}/Sounds/GuitarOpenings/somein.mp3`,
    someinnewer:          `modules/${MODULE_ID}/Sounds/GuitarOpenings/someinnewer.mp3`,
    someriff:             `modules/${MODULE_ID}/Sounds/GuitarOpenings/someriff.mp3`,
    someriffagain:        `modules/${MODULE_ID}/Sounds/GuitarOpenings/someriffagain.mp3`,
    somesong:             `modules/${MODULE_ID}/Sounds/GuitarOpenings/somesong.mp3`,
    somethingelse:        `modules/${MODULE_ID}/Sounds/GuitarOpenings/Somethingelse.mp3`,
    somethingish:         `modules/${MODULE_ID}/Sounds/GuitarOpenings/somethingish.mp3`,
    somethingjesus:       `modules/${MODULE_ID}/Sounds/GuitarOpenings/Somethingjesus.mp3`,
    somethingorother:     `modules/${MODULE_ID}/Sounds/GuitarOpenings/SomethingorOther.mp3`,
    sominagain:           `modules/${MODULE_ID}/Sounds/GuitarOpenings/sominagain.mp3`,
    song2:                `modules/${MODULE_ID}/Sounds/GuitarOpenings/song2.mp3`,
    sweethomealabama:     `modules/${MODULE_ID}/Sounds/GuitarOpenings/sweethomealabama.mp3`,
    teenspirit:           `modules/${MODULE_ID}/Sounds/GuitarOpenings/Teenspirit.mp3`,
    thatonecarchasesong:  `modules/${MODULE_ID}/Sounds/GuitarOpenings/Thatonecarchasesong.mp3`,
    thatonecarchasesong2: `modules/${MODULE_ID}/Sounds/GuitarOpenings/Thatonecarchasesong2.mp3`,
    thereisahouse:        `modules/${MODULE_ID}/Sounds/GuitarOpenings/thereIsAhouse.mp3`,
    thunderstruck:        `modules/${MODULE_ID}/Sounds/GuitarOpenings/Thunderstruck.mp3`,
    walktheline:          `modules/${MODULE_ID}/Sounds/GuitarOpenings/WalkTheLine.mp3`,
    walkthisway:          `modules/${MODULE_ID}/Sounds/GuitarOpenings/WalkthisWay.mp3`,
    wildthing:            `modules/${MODULE_ID}/Sounds/GuitarOpenings/Wildthing.mp3`,
    wildthing2:           `modules/${MODULE_ID}/Sounds/GuitarOpenings/Wildthing2.mp3`,
    wildthingslide:       `modules/${MODULE_ID}/Sounds/GuitarOpenings/Wildthingslide.mp3`
  },
  kaldur: {
    kaldur1: `modules/${MODULE_ID}/Sounds/Kaldur/kaldur1.mp3`,
    kaldur2: `modules/${MODULE_ID}/Sounds/Kaldur/kaldur2.mp3`,
    kaldur3: `modules/${MODULE_ID}/Sounds/Kaldur/kaldur3.mp3`,
    kaldur4: `modules/${MODULE_ID}/Sounds/Kaldur/kaldur4.mp3`,
    kaldur5: `modules/${MODULE_ID}/Sounds/Kaldur/kaldur5.mp3`,
    kaldur6: `modules/${MODULE_ID}/Sounds/Kaldur/kaldur6.mp3`,
    kaldur7: `modules/${MODULE_ID}/Sounds/Kaldur/kaldur7.mp3`,
    kaldur8: `modules/${MODULE_ID}/Sounds/Kaldur/kaldur8.mp3`,
    kaldur9: `modules/${MODULE_ID}/Sounds/Kaldur/kaldur9.mp3`
  },
  enjee: {
    handdrum1: `modules/${MODULE_ID}/Sounds/Enjee/hand-drum-001.ogg`,
    handdrum2: `modules/${MODULE_ID}/Sounds/Enjee/hand-drum-002.ogg`,
    handdrum3: `modules/${MODULE_ID}/Sounds/Enjee/hand-drum-003.ogg`,
    handdrum4: `modules/${MODULE_ID}/Sounds/Enjee/hand-drum-004.ogg`,
    handdrum5: `modules/${MODULE_ID}/Sounds/Enjee/hand-drum-005.ogg`,
    handdrum6: `modules/${MODULE_ID}/Sounds/Enjee/hand-drum-006.ogg`,
    handdrum7: `modules/${MODULE_ID}/Sounds/Enjee/hand-drum-007.ogg`
  },
  dreadie: {
    dreadie1:        `modules/${MODULE_ID}/Sounds/Dreadie/dreadie1.mp3`,
    dreadie2:        `modules/${MODULE_ID}/Sounds/Dreadie/Dreadie2.mp3`,
    dreadie3:        `modules/${MODULE_ID}/Sounds/Dreadie/Dreadie3.mp3`,
    dreadie4:        `modules/${MODULE_ID}/Sounds/Dreadie/Dreadie4.mp3`,
    dreadie5:        `modules/${MODULE_ID}/Sounds/Dreadie/Dreadie5.mp3`,
    dreadie6:        `modules/${MODULE_ID}/Sounds/Dreadie/Dreadie6.mp3`,
    dreadie7:        `modules/${MODULE_ID}/Sounds/Dreadie/Dreadie7.mp3`,
    dreadie8:        `modules/${MODULE_ID}/Sounds/Dreadie/Dreadie8.mp3`,
    dreadie9:        `modules/${MODULE_ID}/Sounds/Dreadie/Dreadie9.mp3`,
    dreadie10:       `modules/${MODULE_ID}/Sounds/Dreadie/Dreadie10.mp3`,
    dreadie11:       `modules/${MODULE_ID}/Sounds/Dreadie/Dreadie11.mp3`,
    dreadiealright:  `modules/${MODULE_ID}/Sounds/Dreadie/DreadieAlright.mp3`,
    dreadielong:     `modules/${MODULE_ID}/Sounds/Dreadie/DreadieLong.mp3`
  },
  // Nested by song. Path examples:
  //   joetastic-help-signal.rico                 → random across all songs
  //   joetastic-help-signal.rico.kickstart       → random Kickstart clip
  //   joetastic-help-signal.rico.panama          → random Panama clip
  //   joetastic-help-signal.rico.photograph      → random Photograph clip
  //   joetastic-help-signal.rico.welcometothejungle → random WelcomeToTheJungle
  rico: {
    kickstart: {
      kickstart1: `modules/${MODULE_ID}/Sounds/Rico/Kickstart/kickstart1.mp3`,
      kickstart2: `modules/${MODULE_ID}/Sounds/Rico/Kickstart/Kickstart2.mp3`,
      kickstart3: `modules/${MODULE_ID}/Sounds/Rico/Kickstart/Kickstart3.mp3`,
      kickstart4: `modules/${MODULE_ID}/Sounds/Rico/Kickstart/Kickstart4.mp3`
    },
    panama: {
      panama:  `modules/${MODULE_ID}/Sounds/Rico/Panama/Panama.mp3`,
      panama3: `modules/${MODULE_ID}/Sounds/Rico/Panama/Panama3.mp3`
    },
    photograph: {
      photograph1: `modules/${MODULE_ID}/Sounds/Rico/Photograph/Photograph1.mp3`,
      photograph2: `modules/${MODULE_ID}/Sounds/Rico/Photograph/Photograph2.mp3`
    },
    welcometothejungle: {
      welcometojungle1: `modules/${MODULE_ID}/Sounds/Rico/WelcomeToTheJungle/Welcometojungle1.mp3`,
      welcometojungle2: `modules/${MODULE_ID}/Sounds/Rico/WelcomeToTheJungle/welcometojungle2.mp3`,
      welcometojungle3: `modules/${MODULE_ID}/Sounds/Rico/WelcomeToTheJungle/Welcometojungle3.mp3`
    }
  },
  scales: {
    riff1:     `modules/${MODULE_ID}/Sounds/Scales/riff1.mp3`,
    saxriff2:  `modules/${MODULE_ID}/Sounds/Scales/saxriff2.mp3`,
    saxriff3:  `modules/${MODULE_ID}/Sounds/Scales/saxriff3.mp3`,
    saxriff4:  `modules/${MODULE_ID}/Sounds/Scales/saxriff4.mp3`,
    saxriff5:  `modules/${MODULE_ID}/Sounds/Scales/saxriff5.mp3`,
    saxriff6:  `modules/${MODULE_ID}/Sounds/Scales/saxriff6.mp3`,
    saxriff7:  `modules/${MODULE_ID}/Sounds/Scales/saxriff7.mp3`,
    saxriff8:  `modules/${MODULE_ID}/Sounds/Scales/Saxriff8.mp3`,
    saxriff9:  `modules/${MODULE_ID}/Sounds/Scales/Saxriff9.mp3`,
    saxriff10: `modules/${MODULE_ID}/Sounds/Scales/saxriff10.mp3`,
    saxriff11: `modules/${MODULE_ID}/Sounds/Scales/saxriff11.mp3`,
    saxriff12: `modules/${MODULE_ID}/Sounds/Scales/saxriff12.mp3`,
    saxriff13: `modules/${MODULE_ID}/Sounds/Scales/Saxriff13.mp3`,
    saxriff14: `modules/${MODULE_ID}/Sounds/Scales/saxriff14.mp3`,
    saxriff15: `modules/${MODULE_ID}/Sounds/Scales/saxriff15.mp3`,
    saxriff16: `modules/${MODULE_ID}/Sounds/Scales/saxriff16.mp3`
  },
  billandted: {
    billandted1: `modules/${MODULE_ID}/Sounds/BillandTed/billandted1.mp3`,
    billandted2: `modules/${MODULE_ID}/Sounds/BillandTed/Billandted2.mp3`,
    billandted3: `modules/${MODULE_ID}/Sounds/BillandTed/Billandted3.mp3`,
    billandted4: `modules/${MODULE_ID}/Sounds/BillandTed/BillandTed4.mp3`,
    billandted5: `modules/${MODULE_ID}/Sounds/BillandTed/BillandTed5.mp3`,
    billandted6: `modules/${MODULE_ID}/Sounds/BillandTed/Billandted6.mp3`,
    billandted7: `modules/${MODULE_ID}/Sounds/BillandTed/billandted7.mp3`,
    billandted8: `modules/${MODULE_ID}/Sounds/BillandTed/billandted8.mp3`,
    billandted9: `modules/${MODULE_ID}/Sounds/BillandTed/Billandted9.mp3`
  },
  redeemer: {
    redeemer1: `modules/${MODULE_ID}/Sounds/Redeemer/Redeemer1.mp3`,
    redeemer2: `modules/${MODULE_ID}/Sounds/Redeemer/Redeemer2.mp3`,
    redeemer3: `modules/${MODULE_ID}/Sounds/Redeemer/redeemer3.mp3`,
    redeemer4: `modules/${MODULE_ID}/Sounds/Redeemer/redeemer4.mp3`
  },
  // Miscellaneous one-offs kept out of the named mate/song groups. Nested
  // subfolders (e.g. Decayvis) each get their own sub-namespace.
  otherstuff: {
    buhbum: `modules/${MODULE_ID}/Sounds/otherstuff/buhbum.mp3`,
    decayvis: {
      bagpipeintro:   `modules/${MODULE_ID}/Sounds/otherstuff/Decayvis/BagpipeIntro.mp3`,
      blind1:         `modules/${MODULE_ID}/Sounds/otherstuff/Decayvis/blind1.mp3`,
      blindintrolong: `modules/${MODULE_ID}/Sounds/otherstuff/Decayvis/Blindintrolong.mp3`,
      blindshort2:    `modules/${MODULE_ID}/Sounds/otherstuff/Decayvis/Blindshort2.mp3`,
      blindshort3:    `modules/${MODULE_ID}/Sounds/otherstuff/Decayvis/blindshort3.mp3`
    }
  },
  // Animations (JB2A files copied in and re-registered under our namespace).
  explosion: {
    // Mirrors jb2a.explosion.06 — OutPulse burst template, 4 color variants
    "06": {
      bluewhite:   `modules/${MODULE_ID}/Animations/Explosion/OutPulse_01_Regular_BlueWhite_Burst_600x600.webm`,
      greenorange: `modules/${MODULE_ID}/Animations/Explosion/OutPulse_01_Regular_GreenOrange_Burst_600x600.webm`,
      purplepink:  `modules/${MODULE_ID}/Animations/Explosion/OutPulse_01_Regular_PurplePink_Burst_600x600.webm`,
      tealyellow:  `modules/${MODULE_ID}/Animations/Explosion/OutPulse_01_Regular_TealYellow_Burst_600x600.webm`
    }
  },
  // Nested by color so a Sequencer DB path can be color-coded:
  //   joetastic-help-signal.music_notations         → any note, any color
  //   joetastic-help-signal.music_notations.blue    → any blue note
  //   joetastic-help-signal.music_notations.orange  → any orange note (etc.)
  music_notations: {
    blue: {
      bassclef:      `modules/${MODULE_ID}/Animations/MusicNotations/Blue/BassClef_01_Regular_Blue_200x200.webm`,
      beamedquavers: `modules/${MODULE_ID}/Animations/MusicNotations/Blue/BeamedQuavers_01_Regular_Blue_200x200.webm`,
      crotchet:      `modules/${MODULE_ID}/Animations/MusicNotations/Blue/Crotchet_01_Regular_Blue_200x200.webm`,
      flat:          `modules/${MODULE_ID}/Animations/MusicNotations/Blue/Flat_01_Regular_Blue_200x200.webm`,
      quaver:        `modules/${MODULE_ID}/Animations/MusicNotations/Blue/Quaver_01_Regular_Blue_200x200.webm`,
      sharp:         `modules/${MODULE_ID}/Animations/MusicNotations/Blue/Sharp_01_Regular_Blue_200x200.webm`,
      trebleclef:    `modules/${MODULE_ID}/Animations/MusicNotations/Blue/TrebleClef_01_Regular_Blue_200x200.webm`
    },
    green: {
      bassclef:      `modules/${MODULE_ID}/Animations/MusicNotations/Green/BassClef_01_Regular_Green_200x200.webm`,
      beamedquavers: `modules/${MODULE_ID}/Animations/MusicNotations/Green/BeamedQuavers_01_Regular_Green_200x200.webm`,
      crotchet:      `modules/${MODULE_ID}/Animations/MusicNotations/Green/Crotchet_01_Regular_Green_200x200.webm`,
      flat:          `modules/${MODULE_ID}/Animations/MusicNotations/Green/Flat_01_Regular_Green_200x200.webm`,
      quaver:        `modules/${MODULE_ID}/Animations/MusicNotations/Green/Quaver_01_Regular_Green_200x200.webm`,
      sharp:         `modules/${MODULE_ID}/Animations/MusicNotations/Green/Sharp_01_Regular_Green_200x200.webm`,
      trebleclef:    `modules/${MODULE_ID}/Animations/MusicNotations/Green/TrebleClef_01_Regular_Green_200x200.webm`
    },
    orange: {
      bassclef:      `modules/${MODULE_ID}/Animations/MusicNotations/Orange/BassClef_01_Regular_Orange_200x200.webm`,
      beamedquavers: `modules/${MODULE_ID}/Animations/MusicNotations/Orange/BeamedQuavers_01_Regular_Orange_200x200.webm`,
      crotchet:      `modules/${MODULE_ID}/Animations/MusicNotations/Orange/Crotchet_01_Regular_Orange_200x200.webm`,
      flat:          `modules/${MODULE_ID}/Animations/MusicNotations/Orange/Flat_01_Regular_Orange_200x200.webm`,
      quaver:        `modules/${MODULE_ID}/Animations/MusicNotations/Orange/Quaver_01_Regular_Orange_200x200.webm`,
      sharp:         `modules/${MODULE_ID}/Animations/MusicNotations/Orange/Sharp_01_Regular_Orange_200x200.webm`,
      trebleclef:    `modules/${MODULE_ID}/Animations/MusicNotations/Orange/TrebleClef_01_Regular_Orange_200x200.webm`
    },
    purple: {
      bassclef:      `modules/${MODULE_ID}/Animations/MusicNotations/Purple/BassClef_01_Regular_Purple_200x200.webm`,
      beamedquavers: `modules/${MODULE_ID}/Animations/MusicNotations/Purple/BeamedQuavers_01_Regular_Purple_200x200.webm`,
      crotchet:      `modules/${MODULE_ID}/Animations/MusicNotations/Purple/Crotchet_01_Regular_Purple_200x200.webm`,
      flat:          `modules/${MODULE_ID}/Animations/MusicNotations/Purple/Flat_01_Regular_Purple_200x200.webm`,
      quaver:        `modules/${MODULE_ID}/Animations/MusicNotations/Purple/Quaver_01_Regular_Purple_200x200.webm`,
      sharp:         `modules/${MODULE_ID}/Animations/MusicNotations/Purple/Sharp_01_Regular_Purple_200x200.webm`,
      trebleclef:    `modules/${MODULE_ID}/Animations/MusicNotations/Purple/TrebleClef_01_Regular_Purple_200x200.webm`
    }
  },
  ontokenbuff: {
    "001": {
      "005": {
        blue:         `modules/${MODULE_ID}/Animations/OnTokenBuff/Ontoken_Buff001_005_Blue_400x400.webm`,
        bluepurple:   `modules/${MODULE_ID}/Animations/OnTokenBuff/Ontoken_Buff001_005_BluePurple_400x400.webm`,
        blueteal:     `modules/${MODULE_ID}/Animations/OnTokenBuff/Ontoken_Buff001_005_BlueTeal_400x400.webm`,
        greenpurple:  `modules/${MODULE_ID}/Animations/OnTokenBuff/Ontoken_Buff001_005_GreenPurple_400x400.webm`,
        greenyellow:  `modules/${MODULE_ID}/Animations/OnTokenBuff/Ontoken_Buff001_005_GreenYellow_400x400.webm`,
        orangeyellow: `modules/${MODULE_ID}/Animations/OnTokenBuff/Ontoken_Buff001_005_OrangeYellow_400x400.webm`,
        pinkyellow:   `modules/${MODULE_ID}/Animations/OnTokenBuff/Ontoken_Buff001_005_PinkYellow_400x400.webm`,
        purplered:    `modules/${MODULE_ID}/Animations/OnTokenBuff/Ontoken_Buff001_005_PurpleRed_400x400.webm`,
        white:        `modules/${MODULE_ID}/Animations/OnTokenBuff/Ontoken_Buff001_005_White_400x400.webm`
      }
    }
  }
};

// Recursively scan the module's Sounds folder for any files not in the
// hardcoded list. Enrichment only — never the sole source of truth, because
// FilePicker.browse returns empty for many client configurations.
async function scanSoundsFolder() {
  const files = [];
  const base = `modules/${MODULE_ID}/Sounds`;
  const audioExt = /\.(mp3|wav|ogg|webm|m4a|flac|opus)$/i;

  const walk = async (path) => {
    let listing;
    try {
      listing = await FilePicker.browse("data", path);
    } catch (e) {
      console.warn(`${MODULE_ID} | FilePicker.browse("${path}") threw:`, e);
      return;
    }
    for (const f of listing.files) {
      if (audioExt.test(f)) files.push(f);
    }
    for (const d of listing.dirs) await walk(d);
  };

  await walk(base);
  return files;
}

// Register every sound file under modules/<id>/Sounds into the Sequencer
// database and preload them so they're cached and ready to play. Idempotent:
// re-registering just overwrites the same entries.
async function registerSounds() {
  if (typeof Sequencer === "undefined" || !Sequencer.Database) {
    console.warn(`${MODULE_ID} | Sequencer not available; skipping sound registration.`);
    return;
  }

  const entries = foundry.utils.deepClone(HARDCODED_SOUND_ENTRIES);

  // Enrichment: pull anything else the FilePicker can find beyond the hardcoded list.
  const scanned = await scanSoundsFolder();
  if (scanned.length > 0) {
    const base = `modules/${MODULE_ID}/Sounds/`;
    for (const file of scanned) {
      const decoded = decodeURIComponent(file);
      if (!decoded.startsWith(base)) continue;
      const rel = decoded.slice(base.length);
      const parts = rel.split("/");
      const filename = parts.pop();
      const name = filename.replace(/\.[^.]+$/, "").toLowerCase();
      let target = entries;
      for (const part of parts) {
        const key = part.toLowerCase();
        target[key] = target[key] ?? {};
        target = target[key];
      }
      if (!target[name]) target[name] = file;
    }
  }

  try {
    Sequencer.Database.registerEntries(MODULE_ID, entries);
  } catch (e) {
    console.warn(`${MODULE_ID} | Sequencer.Database.registerEntries failed:`, e);
  }

  // Preload only the apply-cue defaults on world load, since the apply cue
  // fires immediately (no window to preload later). Attack/reminder/expire
  // cues get preloaded per-effect via the createActiveEffect hook instead.
  const applyDefaults = [entries.billandted, entries.ontokenbuff];
  const preloadPaths = [];
  const collect = (v) => {
    if (typeof v === "string") preloadPaths.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(collect);
  };
  applyDefaults.forEach(collect);
  if (preloadPaths.length && Sequencer.Preloader) {
    try {
      await Sequencer.Preloader.preload(preloadPaths);
    } catch (e) {
      console.warn(`${MODULE_ID} | apply-cue preload failed:`, e);
    }
  }
}

// Create/refresh the per-variant macro. Idempotent: existing macros are
// updated in place so name/icon/command changes flow through on reload.
async function ensureMacro(variant) {
  if (!game.user.isGM) return null;

  // Help-Attack gets an extra preamble so a hotbar click "just works" from a
  // hover: if the player hasn't got one of their own tokens selected, pick
  // one for them (prefer a PC over a companion/summon); if a token is under
  // the cursor, target it. Save/Ability keep the plain call — those flows
  // are player-driven enough that auto-selection hurts more than it helps.
  const applyCall =
    `game.modules.get("${MODULE_ID}").api.applyToCurrentTargets(${JSON.stringify(variant.key)});`;
  const expectedCommand = variant.key === "attack"
    ? `if (!game.user.isGM && !canvas.tokens.controlled.some(t => t.actor?.isOwner)) {
  const owned = canvas.tokens.placeables.filter(t => t.actor?.isOwner);
  if (owned.length) {
    const pc = owned.find(t => t.actor?.type === "character");
    (pc ?? owned[0]).control({ releaseOthers: true });
  }
}
const hover = canvas.tokens.hover ?? (() => {
  const p = canvas.mousePosition;
  if (!p) return null;
  return canvas.tokens.placeables.find(t => t.bounds?.contains(p.x, p.y));
})();
if (hover) hover.setTarget(true, { releaseOthers: true, groupSelection: false });
${applyCall}`
    : applyCall;

  const existing = game.macros.find(m => m.getFlag(MODULE_ID, variant.macroFlag));
  if (existing) {
    const updates = {};
    if (existing.name !== variant.macroName) updates.name = variant.macroName;
    if (existing.img !== variant.icon) updates.img = variant.icon;
    if (existing.command !== expectedCommand) updates.command = expectedCommand;
    if (Object.keys(updates).length) await existing.update(updates);
    return existing;
  }
  const macro = await Macro.create({
    name: variant.macroName,
    type: "script",
    img: variant.icon,
    command: expectedCommand,
    flags: { [MODULE_ID]: { [variant.macroFlag]: true, variant: variant.key } },
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
  });
  ui.notifications.info(
    `Joetastic Help Signal: created "${variant.macroName}" macro. Players can drag it from the Macros sidebar to their hotbar.`
  );
  return macro;
}

// Create/refresh the per-variant "Help" item. Description embeds a
// clickable link (`.jhs-apply-from-card` with `data-variant`) that the
// renderChatMessage hook wires up to the apply flow, so clicking the chat
// card triggers the apply even if dnd5e's use-hooks don't fire for this
// activity-less feat.
async function ensureItem(variant) {
  if (!game.user.isGM) return null;

  const applyButton = `
    <p style="text-align:center;margin-top:0.5em;">
      <a class="jhs-apply-from-card" data-variant="${variant.key}"
         style="display:inline-block;padding:0.35em 1em;border:1px solid #dc2626;
                border-radius:6px;font-weight:bold;text-decoration:none;cursor:pointer;">
        ${variant.cardButtonLabel}
      </a>
    </p>`;

  const description = `${variant.itemDescription}${applyButton}`;

  const existing = game.items.find(i => i.getFlag(MODULE_ID, variant.itemFlag));
  if (existing) {
    const updates = {};
    if (existing.name !== variant.itemName) updates.name = variant.itemName;
    if (existing.img !== variant.icon) updates.img = variant.icon;
    if (existing.system?.description?.value !== description) {
      updates["system.description.value"] = description;
    }
    if (Object.keys(updates).length) await existing.update(updates);
    return existing;
  }

  const item = await Item.create({
    name: variant.itemName,
    type: "feat",
    img: variant.icon,
    system: {
      description: { value: description },
      activation: { type: "action", cost: 1 },
      target: { value: 1, type: "creature" },
      range: { value: 5, units: "ft" }
    },
    flags: {
      [MODULE_ID]: {
        [variant.itemFlag]: true,
        [variant.isHelpFeatFlag]: true,
        variant: variant.key
      }
    },
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
  });
  ui.notifications.info(
    `Joetastic Help Signal: created "${variant.itemName}" item. Players can drag it onto their character sheets.`
  );
  return item;
}

// Return the variant an item document represents by checking each variant's
// isHelpFeatFlag. Used by the sheet-use trigger to route the click.
function variantForItem(item) {
  if (!item?.getFlag) return null;
  for (const variant of Object.values(VARIANTS)) {
    if (item.getFlag(MODULE_ID, variant.isHelpFeatFlag)) return variant;
  }
  return null;
}

// Wires up a set of draggable elements inside a rendered popup. Each element
// carries a `data-uuid` and `data-drag-type` — we serialize those into the
// standard Foundry drag payload so drops land on the hotbar / sheet.
function bindDragTargets(html, selector) {
  const root = html?.[0] ?? html;
  const drags = root?.querySelectorAll?.(selector) ?? [];
  for (const drag of drags) {
    drag.addEventListener("dragstart", (ev) => {
      const uuid = drag.dataset.uuid;
      const type = drag.dataset.dragType;
      if (!uuid || !type) return;
      const payload = JSON.stringify({ type, uuid });
      ev.dataTransfer.setData("text/plain", payload);
      ev.dataTransfer.effectAllowed = "copy";
    });
  }
}

// A user's single Band Mate macro, kept in sync with the mate they've
// selected in the menu. Idempotent — call any time to bring the existing doc
// up to date, or create it if missing.
//
// Called in two situations:
//  1. GM sweep on ready / userConnected — creates any missing macros with
//     the right ownership so the user can update their own icon on toggle.
//  2. When any user changes their selection in the menu — reroutes their
//     macro to the new mate. The user owns the macro so they can update it
//     directly; falls back to a GM socket delegation if ownership got
//     stripped somehow (see updateBandMateMacroImg's socket pattern).
async function ensureBandMateMacro(user) {
  if (!user) return null;

  const mate = getUserSelectedMate(user);
  const isOn = !!user.getFlag(MODULE_ID, bandMateEnabledKey(mate.key));
  const expectedName    = `${mate.name} (${user.name})`;
  const expectedCommand = `game.modules.get("${MODULE_ID}").api.toggleBandMate(${JSON.stringify(mate.key)});`;
  const expectedImg     = isOn ? BAND_MATE_ICON_ON : BAND_MATE_ICON_OFF;

  const existing = findUserBandMateMacro(user.id);
  if (existing) {
    const updates = {};
    if (existing.name    !== expectedName)    updates.name    = expectedName;
    if (existing.command !== expectedCommand) updates.command = expectedCommand;
    if (existing.img     !== expectedImg)     updates.img     = expectedImg;
    if (existing.getFlag(MODULE_ID, BAND_MATE_MATE_FLAG) !== mate.key) {
      updates[`flags.${MODULE_ID}.${BAND_MATE_MATE_FLAG}`] = mate.key;
    }
    if (Object.keys(updates).length === 0) return existing;
    if (game.user.isGM || existing.isOwner) {
      await existing.update(updates);
    } else if (game.users.some(u => u.isGM && u.active)) {
      // Rare fallback — user lacks OWNER on their macro. Delegate to GM.
      game.socket.emit(SOCKET, {
        action: "updateBandMateMacro",
        macroUuid: existing.uuid,
        updates
      });
    }
    return existing;
  }

  if (!game.user.isGM) return null; // Only GMs create fresh docs.

  return await Macro.create({
    name: expectedName,
    type: "script",
    img: expectedImg,
    command: expectedCommand,
    flags: {
      [MODULE_ID]: {
        [BAND_MATE_MATE_FLAG]: mate.key,
        [BAND_MATE_USER_FLAG]: user.id
      }
    },
    ownership: {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
      [user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
    }
  });
}

// Change which mate a user's macro represents. Any currently-active mate is
// switched OFF first (only makes sense to call on the local user, since flag
// writes on another user's doc need GM perms anyway).
async function setUserSelectedMate(mateKey) {
  const mate = BAND_MATES.find(m => m.key === mateKey);
  if (!mate) return;

  // Turn off any mate that's currently ON — matches the one-active-mate rule.
  for (const other of BAND_MATES) {
    if (other.key === mate.key) continue;
    if (bandMateGetFlag(bandMateEnabledKey(other.key), false)) {
      await bandMateSetFlag(bandMateEnabledKey(other.key), false);
    }
  }

  await bandMateSetFlag(BAND_MATE_SELECTED_FLAG, mate.key);
  // Regenerate the user's single macro to point at the new mate.
  await ensureBandMateMacro(game.user);
}

// One-shot cleanup: delete any macros left over from the single-macro version
// of Band Mate. Safe to call every ready sweep — no-ops after the first pass.
async function cleanupLegacyBandMateMacros() {
  if (!game.user.isGM) return;
  // Two legacy shapes to sweep:
  //  (a) very-early single-macro version, missing the mate-key flag entirely.
  //  (b) per-mate-per-user era (5 macros per user) — collapses to 1 per user.
  const stale = game.macros.filter(m =>
    m.getFlag(MODULE_ID, BAND_MATE_LEGACY_USER_FLAG) &&
    !m.getFlag(MODULE_ID, BAND_MATE_MATE_FLAG)
  );
  for (const m of stale) {
    try { await m.delete(); }
    catch (e) { console.warn(`${MODULE_ID} | cleanupLegacyBandMateMacros delete failed:`, e); }
  }

  // Collapse per-(user,mate) macros down to one macro per user. Keep the
  // macro whose mate matches the user's selected key (or the first macro if
  // the user has no selection yet), delete the rest, and stamp the selection
  // flag so future ensureBandMateMacro calls preserve it.
  for (const user of game.users) {
    const owned = game.macros.filter(m =>
      m.getFlag(MODULE_ID, BAND_MATE_USER_FLAG) === user.id
    );
    if (owned.length <= 1) continue;
    const selectedKey = user.getFlag(MODULE_ID, BAND_MATE_SELECTED_FLAG);
    const keeper = owned.find(m => m.getFlag(MODULE_ID, BAND_MATE_MATE_FLAG) === selectedKey)
                ?? owned[0];
    for (const m of owned) {
      if (m.id === keeper.id) continue;
      try { await m.delete(); }
      catch (e) { console.warn(`${MODULE_ID} | collapse band-mate macros: delete failed:`, e); }
    }
    if (!selectedKey) {
      const key = keeper.getFlag(MODULE_ID, BAND_MATE_MATE_FLAG);
      if (key) {
        try { await user.setFlag(MODULE_ID, BAND_MATE_SELECTED_FLAG, key); }
        catch (e) { console.warn(`${MODULE_ID} | seed selectedBandMateKey failed:`, e); }
      }
    }
  }
}

// Update the current user's single band-mate macro's img to reflect ON/OFF.
// Direct update when the user owns it; otherwise delegates to the GM via
// socket. Only relevant when the toggled mate matches the macro's current
// mate — a stale toggle of a non-selected mate is silently ignored (there's
// no macro for that mate to update).
async function updateBandMateMacroImg(mateKey, on) {
  const macro = findUserBandMateMacro(game.user.id);
  if (!macro) return;
  if (macro.getFlag(MODULE_ID, BAND_MATE_MATE_FLAG) !== mateKey) return;
  const newImg = on ? BAND_MATE_ICON_ON : BAND_MATE_ICON_OFF;
  if (macro.img === newImg) return;
  if (game.user.isGM || macro.isOwner) {
    try { await macro.update({ img: newImg }); }
    catch (e) { console.warn(`${MODULE_ID} | updateBandMateMacroImg direct update failed:`, e); }
  } else if (game.users.some(u => u.isGM && u.active)) {
    game.socket.emit(SOCKET, {
      action: "setBandMateImg",
      macroUuid: macro.uuid,
      img: newImg
    });
  }
}

// Called by a Band Mate macro on click. Flips this user's toggle for the
// mate the macro is currently pointing at. Only one mate is allowed on at a
// time — turning one ON forces every other mate OFF first (which is mostly
// theoretical now that only one macro exists per user, but kept for safety
// during the migration window).
async function toggleBandMate(mateKey) {
  const mate = BAND_MATES.find(m => m.key === mateKey);
  if (!mate) {
    console.warn(`${MODULE_ID} | toggleBandMate: unknown mate "${mateKey}"`);
    return;
  }
  const next = !bandMateGetFlag(bandMateEnabledKey(mate.key), false);

  if (next) {
    for (const other of BAND_MATES) {
      if (other.key === mate.key) continue;
      if (bandMateGetFlag(bandMateEnabledKey(other.key), false)) {
        await bandMateSetFlag(bandMateEnabledKey(other.key), false);
      }
    }
  }

  await bandMateSetFlag(bandMateEnabledKey(mate.key), next);
  await updateBandMateMacroImg(mate.key, next);
  ui.notifications.info(`${mate.name}: ${next ? "ON ✓" : "OFF ✗"}`);
}

// Reset: turn every Band Mate off for the local user and flip the macro back
// to X. Since only one macro exists per user, only the currently-selected
// mate's img changes here — the other mates just have their flags cleared.
async function turnOffAllBandMates() {
  let changed = 0;
  for (const mate of BAND_MATES) {
    const key = bandMateEnabledKey(mate.key);
    if (bandMateGetFlag(key, false)) {
      await bandMateSetFlag(key, false);
      changed++;
    }
  }
  const selected = getUserSelectedMate(game.user);
  await updateBandMateMacroImg(selected.key, false);
  ui.notifications.info(
    changed === 0
      ? "No Band Mates were on."
      : `Turned off ${changed} Band Mate${changed === 1 ? "" : "s"}.`
  );
}

// Play the Band Mate cue globally: for every mate the firing user has ON,
// play that mate's sound. Sequencer rebroadcasts to every connected client,
// and each client scales by their own volume slider. Animation is the active
// mate's per-mate animation (falling back to the shared default), with the
// mate's ColorMatrix filter values applied. Rainbow mode animates the hue.
function playBandMateCue(token = null) {
  const dbg = game.settings.get(MODULE_ID, "debugBandMate");
  const log = (...args) => { if (dbg) console.log(`${MODULE_ID} | BandMateCue |`, ...args); };

  const fallbackAnim = bandMateGetFlag("bandMateAnimation", "joetastic-help-signal.music_notations");
  const volume = getVolume();
  log(`volume=${volume}, sequencerSoundsEnabled=${game.settings.get?.("sequencer","soundsEnabled") ?? "?"}, viewedScene=${game.user.viewedScene}`);

  // Collect ON mates and their sounds. Since only one mate can be active at a
  // time, activeMate will be at most one — but the loop keeps the structure
  // flexible if that constraint is ever relaxed.
  const soundPaths = [];
  let activeMate = null;
  for (const mate of BAND_MATES) {
    if (!bandMateReadFor(mate, bandMateEnabledKey)) continue;
    if (!activeMate) activeMate = mate;
    const raw = bandMateReadFor(mate, bandMateSoundKey);
    const resolved = resolveDbPath(raw);
    log(`mate=${mate.key} soundRaw="${raw}" resolved="${resolved}"`);
    if (resolved) soundPaths.push(resolved);
  }

  const animPath = activeMate
    ? (bandMateReadFor(activeMate, bandMateAnimKey) || fallbackAnim)
    : fallbackAnim;

  if (soundPaths.length === 0 && !(animPath && token)) return;

  if (typeof Sequence !== "undefined") {
    const seq = new Sequence();
    let hasContent = false;
    for (const soundPath of soundPaths) {
      seq.sound().file(soundPath).volume(volume);
      hasContent = true;
    }
    if (animPath && token) {
      // Anchor the effect's bottom-center at the token center so the animation
      // appears to rise from the token instead of extending below it.
      const eff = seq.effect()
        .file(animPath)
        .atLocation(token)
        .scaleToObject(3.0)
        .anchor({ x: 0.5, y: 1 });

      if (activeMate) {
        const hue        = Number(bandMateReadFor(activeMate, bandMateHueKey)) || 0;
        const saturate   = Number(bandMateReadFor(activeMate, bandMateSaturateKey));
        const brightness = Number(bandMateReadFor(activeMate, bandMateBrightnessKey));
        const rainbow    = bandMateReadFor(activeMate, bandMateRainbowKey);

        const sat = Number.isFinite(saturate)   ? saturate   : 1;
        const bri = Number.isFinite(brightness) ? brightness : 1;

        if (rainbow) {
          // Animated hue loop = rainbow. Filter starts at hue 0; loopProperty
          // cycles it 0→360 continuously via the ColorMatrixFilter setter
          // Sequencer exposes on sprite.colorMatrixFilter.
          eff.filter("ColorMatrix", { hue: 0, saturate: sat, brightness: bri })
             .loopProperty("sprite.colorMatrixFilter", "hue", {
               from: 0, to: 360, duration: 800, ease: "linear"
             });
        } else if (hue !== 0 || sat !== 1 || bri !== 1) {
          eff.filter("ColorMatrix", { hue, saturate: sat, brightness: bri });
        }
      }

      hasContent = true;
    }
    if (hasContent) seq.play();
    return;
  }

  for (const soundPath of soundPaths) {
    // Second arg true → broadcast to every client.
    foundry.audio.AudioHelper.play({ src: soundPath, volume, autoplay: true, loop: false }, true);
  }
}

// True when this user has at least one Band Mate toggled ON. Used to gate the
// chat hook early so we don't waste time on every message when no mate fires.
function anyBandMateOn() {
  return BAND_MATES.some(m => bandMateReadFor(m, bandMateEnabledKey));
}

// Resolve the token that produced a chat message — used to place the Band
// Mate animation on the acting token.
function getBandMateActingToken(message) {
  const tokenId = message.speaker?.token;
  if (tokenId) {
    const t = canvas?.tokens?.get(tokenId);
    if (t) return t;
  }
  const actor = ChatMessage.getSpeakerActor?.(message.speaker)
             ?? game.actors.get(message.speaker?.actor);
  return actor?.getActiveTokens()?.[0] ?? null;
}

// Inspect a chat message and identify which Band Mate trigger it represents
// (spell cast, Bardic Inspiration use, Performance check). Returns "spell",
// "bardic", "performance", or null. Bardic is checked before spell so a
// Bardic Inspiration item that's typed as "spell" still classifies as bardic.
function getBandMateTriggerReason(message) {
  const dnd = message.flags?.dnd5e;
  if (!dnd) return null;

  const roll = dnd.roll;

  const skillId = roll?.skillId ?? roll?.key;
  if (roll?.type === "skill" && skillId === "prf") return "performance";

  // Spell / Bardic fire only on the item USE card (no roll flag). Attack /
  // damage / save rolls from a spell also carry flags.dnd5e.item pointing
  // back to the source, which is why the roll gate filters them out.
  if (roll) return null;

  const itemFlag = dnd.item;
  if (!itemFlag) return null;

  let isSpell = itemFlag.type === "spell";
  let isBardic = itemFlag.name && /bardic\s+inspiration/i.test(itemFlag.name);

  if ((!isSpell && !isBardic) && itemFlag.uuid) {
    try {
      const item = fromUuidSync(itemFlag.uuid);
      if (item) {
        isSpell = isSpell || item.type === "spell";
        isBardic = isBardic || /bardic\s+inspiration/i.test(item.name ?? "");
      }
    } catch { /* item may have been consumed — ignore */ }
  }

  if (isBardic) return "bardic";
  if (isSpell) return "spell";
  return null;
}

// Map a trigger reason to the settings key that enables/disables it per mate.
function bandMateTriggerSettingKey(mateKey, reason) {
  switch (reason) {
    case "spell":       return bandMateTriggerSpellsKey(mateKey);
    case "bardic":      return bandMateTriggerBardicKey(mateKey);
    case "performance": return bandMateTriggerPerformanceKey(mateKey);
    default: return null;
  }
}

// Popup that lists every variant's macro as a draggable icon, so all three
// Help flavors sit behind one settings-menu button.
class HelpMacrosMenuApp extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: `${MODULE_ID}-macro-menu`,
      title: "Help Macros — Drag to Hotbar",
      template: `modules/${MODULE_ID}/templates/macro-menu.hbs`,
      width: 640,
      height: "auto",
      classes: [MODULE_ID]
    });
  }

  async getData() {
    const variants = Object.values(VARIANTS).map(variant => {
      const macro = game.macros.find(m => m.getFlag(MODULE_ID, variant.macroFlag));
      return {
        key: variant.key,
        iconPath: variant.icon,
        macroName: macro?.name ?? variant.macroName,
        macroUuid: macro?.uuid ?? null,
        exists: !!macro
      };
    });
    return { variants };
  }

  activateListeners(html) {
    super.activateListeners(html);
    bindDragTargets(html, ".jhs-macro-drag");
  }

  async _updateObject() {}
}

// Popup that lists every variant's item as a draggable feat.
class HelpItemsMenuApp extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: `${MODULE_ID}-item-menu`,
      title: "Help Action Items — Drag to Character Sheet",
      template: `modules/${MODULE_ID}/templates/item-menu.hbs`,
      width: 640,
      height: "auto",
      classes: [MODULE_ID]
    });
  }

  async getData() {
    const variants = Object.values(VARIANTS).map(variant => {
      const item = game.items.find(i => i.getFlag(MODULE_ID, variant.itemFlag));
      return {
        key: variant.key,
        iconPath: variant.icon,
        itemName: item?.name ?? variant.itemName,
        itemUuid: item?.uuid ?? null,
        exists: !!item
      };
    });
    return { variants };
  }

  activateListeners(html) {
    super.activateListeners(html);
    bindDragTargets(html, ".jhs-item-drag");
  }

  async _updateObject() {}
}

// Right-click config dialog: exposes the per-mate sound, animation, coloring,
// and trigger checkboxes in a single form so the user doesn't have to hunt
// through the module settings pane.
function openBandMateConfigDialog(mateKey) {
  const mate = BAND_MATES.find(m => m.key === mateKey);
  if (!mate) return;

  const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const cur = {
    sound:      bandMateReadFor(mate, bandMateSoundKey),
    animation:  bandMateReadFor(mate, bandMateAnimKey),
    hue:        Number(bandMateReadFor(mate, bandMateHueKey)) || 0,
    saturate:   Number(bandMateReadFor(mate, bandMateSaturateKey)),
    brightness: Number(bandMateReadFor(mate, bandMateBrightnessKey)),
    rainbow:    !!bandMateReadFor(mate, bandMateRainbowKey),
    triggerSpells:      !!bandMateReadFor(mate, bandMateTriggerSpellsKey),
    triggerBardic:      !!bandMateReadFor(mate, bandMateTriggerBardicKey),
    triggerPerformance: !!bandMateReadFor(mate, bandMateTriggerPerformanceKey)
  };
  if (!Number.isFinite(cur.saturate))   cur.saturate = 1;
  if (!Number.isFinite(cur.brightness)) cur.brightness = 1;

  const content = `
    <form class="jhs-mate-config" style="padding:0.25em 0;">
      <p style="margin:0 0 0.75em 0; opacity:0.85;">
        Configure <b>${esc(mate.name)}</b>. Changes save when you click <b>Save</b>.
      </p>
      <div class="form-group">
        <label>Sound</label>
        <input type="text" name="sound" value="${esc(cur.sound)}"
               placeholder="Sequencer DB path or file path"/>
      </div>
      <div class="form-group">
        <label>Animation</label>
        <input type="text" name="animation" value="${esc(cur.animation)}"
               placeholder="Sequencer DB path"/>
      </div>
      <hr/>
      <p style="margin:0.5em 0 0.25em 0;"><b>Coloring</b></p>
      <div class="form-group">
        <label>Hue (0–359°)</label>
        <input type="number" name="hue" min="0" max="359" step="1" value="${cur.hue}"/>
      </div>
      <div class="form-group">
        <label>Saturation (0–2)</label>
        <input type="number" name="saturate" min="0" max="2" step="0.05" value="${cur.saturate}"/>
      </div>
      <div class="form-group">
        <label>Brightness (0–2)</label>
        <input type="number" name="brightness" min="0" max="2" step="0.05" value="${cur.brightness}"/>
      </div>
      <div class="form-group">
        <label>
          <input type="checkbox" name="rainbow" ${cur.rainbow ? "checked" : ""}/>
          Rainbow (animated hue cycle — overrides Hue value)
        </label>
      </div>
      <hr/>
      <p style="margin:0.5em 0 0.25em 0;"><b>Play sound for</b></p>
      <div class="form-group">
        <label>
          <input type="checkbox" name="triggerSpells" ${cur.triggerSpells ? "checked" : ""}/>
          Spells
        </label>
      </div>
      <div class="form-group">
        <label>
          <input type="checkbox" name="triggerBardic" ${cur.triggerBardic ? "checked" : ""}/>
          Bardic Inspiration
        </label>
      </div>
      <div class="form-group">
        <label>
          <input type="checkbox" name="triggerPerformance" ${cur.triggerPerformance ? "checked" : ""}/>
          Performance checks
        </label>
      </div>
    </form>
  `;

  return new Promise((resolve) => {
    new Dialog({
      title: `Configure ${mate.name}`,
      content,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: "Save",
          callback: async (html) => {
            const root = html?.[0] ?? html;
            const form = root.querySelector?.("form") ?? root.find?.("form")[0];
            const readStr  = (n) => form.querySelector(`[name="${n}"]`).value ?? "";
            const readNum  = (n) => Number(form.querySelector(`[name="${n}"]`).value);
            const readBool = (n) => !!form.querySelector(`[name="${n}"]`).checked;

            await bandMateSetFlag(bandMateSoundKey(mate.key),      readStr("sound").trim());
            await bandMateSetFlag(bandMateAnimKey(mate.key),       readStr("animation").trim());
            await bandMateSetFlag(bandMateHueKey(mate.key),        Math.max(0, Math.min(359, Math.round(readNum("hue")) || 0)));
            await bandMateSetFlag(bandMateSaturateKey(mate.key),   Number.isFinite(readNum("saturate"))   ? readNum("saturate")   : 1);
            await bandMateSetFlag(bandMateBrightnessKey(mate.key), Number.isFinite(readNum("brightness")) ? readNum("brightness") : 1);
            await bandMateSetFlag(bandMateRainbowKey(mate.key),    readBool("rainbow"));
            await bandMateSetFlag(bandMateTriggerSpellsKey(mate.key),      readBool("triggerSpells"));
            await bandMateSetFlag(bandMateTriggerBardicKey(mate.key),      readBool("triggerBardic"));
            await bandMateSetFlag(bandMateTriggerPerformanceKey(mate.key), readBool("triggerPerformance"));
            ui.notifications.info(`${mate.name}: settings saved.`);
            resolve(true);
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel",
          callback: () => resolve(false)
        }
      },
      default: "save",
      close: () => resolve(false)
    }).render(true);
  });
}

// Popup for the local user's Band Mate management. Shows five selector
// buttons (one per mate) — clicking one makes the user's single Band Mate
// macro represent that mate. Right-click opens the per-mate config dialog
// (sound / animation / triggers). Below the selectors: the user's macro as
// a draggable target for the hotbar plus a Turn-Off-All button.
class BandMateMacrosMenuApp extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: `${MODULE_ID}-band-mate-menu`,
      title: "Band Mate — Select and Drag",
      template: `modules/${MODULE_ID}/templates/band-mate-menu.hbs`,
      width: 640,
      height: "auto",
      classes: [MODULE_ID]
    });
  }

  async getData() {
    const selected = getUserSelectedMate(game.user);
    const activeKey = BAND_MATES.find(m => bandMateReadFor(m, bandMateEnabledKey))?.key ?? null;
    const mates = BAND_MATES.map(mate => ({
      key: mate.key,
      name: mate.name,
      selected: mate.key === selected.key,
      active:   mate.key === activeKey
    }));
    const macro = findUserBandMateMacro(game.user.id);
    return {
      mates,
      selectedName: selected.name,
      macroUuid: macro?.uuid ?? null,
      macroImg:  macro?.img  ?? BAND_MATE_ICON_OFF,
      macroName: macro?.name ?? `${selected.name} (${game.user.name})`,
      macroExists: !!macro,
      isOn: activeKey === selected.key
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html?.[0] ?? html;

    // Selector buttons — click selects (regenerates macro), right-click
    // opens the per-mate config dialog (sound / animation / triggers).
    const selectors = root?.querySelectorAll?.(".jhs-band-mate-select") ?? [];
    for (const btn of selectors) {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const mateKey = btn.dataset.mateKey;
        if (!mateKey) return;
        await setUserSelectedMate(mateKey);
        this.render(true);
      });
      btn.addEventListener("contextmenu", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const mateKey = btn.dataset.mateKey;
        if (!mateKey) return;
        await openBandMateConfigDialog(mateKey);
        this.render(true);
      });
    }

    // Drag the single macro to the hotbar; click toggles it.
    const drag = root?.querySelector?.(".jhs-macro-drag");
    if (drag) {
      bindDragTargets(html, ".jhs-macro-drag");
      drag.addEventListener("dragstart", () => { drag.dataset.jhsDragging = "1"; });
      drag.addEventListener("dragend",   () => {
        setTimeout(() => { delete drag.dataset.jhsDragging; }, 100);
      });
      drag.addEventListener("click", async (ev) => {
        if (drag.dataset.jhsDragging === "1") return;
        ev.preventDefault();
        ev.stopPropagation();
        const selected = getUserSelectedMate(game.user);
        await toggleBandMate(selected.key);
        this.render(true);
      });
    }

    const offBtn = root?.querySelector?.(".jhs-band-mate-off-all");
    if (offBtn) {
      offBtn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        await turnOffAllBandMates();
        this.render(true);
      });
    }
  }

  async _updateObject() {}
}

// ============================================================================
// Sound Board
// ----------------------------------------------------------------------------
// Users configure a board of sounds (name + volume + loop) in a setup dialog,
// hit Save, and get a macro they can drag to their hotbar. Clicking the macro
// opens a grid of buttons; clicking a button broadcasts the sound to every
// client via the module socket so everyone hears it. Looping sounds show a
// PLAYING state and stop on second click.
//
// Board data lives on the generated macro as flags[MODULE_ID].soundBoard.
// Dropping an existing sound-board macro into the setup dialog loads its data
// for editing (Save then updates that macro in place instead of creating a new
// one).
// ============================================================================

const SOUND_BOARD_FLAG         = "soundBoard";
const SOUND_BOARD_MACRO_TAG    = "soundBoardMacro"; // = true on all board macros
// First line of every generated macro's command. Doubles as a human-readable
// marker AND a fallback identifier for the setup dialog's drop handler — if
// the flag is somehow missing on a macro (manual edit, cross-world import),
// the comment is still enough to recognise our macros.
const SOUND_BOARD_MACRO_HEADER = "// jhs-sound-board :: DO NOT EDIT — generated by Joetastic Help Signal (Sound Board)";

// True when a macro doc came out of this module's Sound Board feature. Any of
// the three signals (flag, tag, header comment) is sufficient — belt-and-
// suspenders so older-format macros still validate after the header was added.
function _isSoundBoardMacro(macro) {
  if (!macro) return false;
  try {
    if (macro.getFlag?.(MODULE_ID, SOUND_BOARD_MACRO_TAG)) return true;
    if (macro.getFlag?.(MODULE_ID, SOUND_BOARD_FLAG))     return true;
  } catch { /* ignore */ }
  const cmd = typeof macro.command === "string" ? macro.command : "";
  return cmd.startsWith(SOUND_BOARD_MACRO_HEADER);
}

// Personal, per-client scalar applied to every sound board's playback on
// this machine. Registered as a hidden client-scoped setting (config: false)
// in init — see `soundBoardVolume` below. One value shared across every
// board, which sidesteps the orphan-user-flag problem the earlier per-board
// design had when a sound board's macro was deleted.
function _getBoardVolume() {
  try {
    const v = Number(game.settings.get(MODULE_ID, "soundBoardVolume"));
    if (!Number.isFinite(v)) return 1;
    return Math.max(0, Math.min(1, v));
  } catch { return 1; }
}
async function _setBoardVolume(value) {
  const n = Math.max(0, Math.min(1, Number(value) || 0));
  try { await game.settings.set(MODULE_ID, "soundBoardVolume", n); }
  catch (e) { console.warn(`${MODULE_ID} | soundBoardVolume persist failed:`, e); }
  return n;
}

// One-time cleanup: earlier versions stored the sound-board slider as
// per-board User flags (`soundBoardVolume_<boardId>`). The universal client
// setting supersedes those, and any leftover flags are pure orphans. Sweeps
// this user's own flags on ready — no permissions needed since each user
// unsets their own.
async function _cleanupLegacyBoardVolumeFlags() {
  const flags = game.user?.flags?.[MODULE_ID];
  if (!flags) return;
  const stale = Object.keys(flags).filter(k => k.startsWith("soundBoardVolume_"));
  for (const key of stale) {
    try { await game.user.unsetFlag(MODULE_ID, key); }
    catch (e) { console.warn(`${MODULE_ID} | unset legacy flag "${key}" failed:`, e); }
  }
  if (stale.length) {
    console.log(`${MODULE_ID} | cleaned up ${stale.length} legacy soundBoardVolume_* flag(s) on User doc`);
  }
}

// Client-scoped registry of currently playing sound-board instances (loop
// AND non-loop). Keyed by instanceId so soundBoardStopLocal can find + stop
// the right Sound handle. Each entry carries the raw (pre-scaling) volume so
// the shared board slider can live-adjust playing loops on this client.
// Entries auto-remove on the Sound's "end"/"stop" events, so non-loop sounds
// clean themselves up when they finish naturally.
const _soundBoardSounds = new Map();

// Instances stopped while their Sound was still loading. AudioHelper.play is
// async — a fast "click then close" flow can issue the stop *before* the
// play has finished resolving, leaving the Sound handle absent from the map
// and the stop a no-op. Any instanceId parked here is stopped the moment
// its Sound lands in soundBoardPlayLocal, closing the race. Entries expire
// after 30s so a genuinely unmatched stop can't leak forever.
const _soundBoardPendingCancellations = new Set();

// Preview a sound locally (never broadcast) at its configured per-sound
// volume × the local module volume. Skips the shared board slider so the
// preview reflects what's actually saved in the row, not what the user set
// on their board-volume slider. Fire-and-forget, no loop.
async function _soundBoardPreviewLocal(ref, volume) {
  if (!ref || !ref.trim()) {
    ui.notifications.warn("Nothing to preview — enter a sound reference first.");
    return;
  }
  const resolved = resolveDbPath(ref.trim());
  if (!resolved) {
    ui.notifications.warn(`Couldn't resolve "${ref}" to a sound.`);
    return;
  }
  const rawVolume   = Math.max(0, Math.min(1, Number(volume) || 0));
  const finalVolume = rawVolume * getVolume();
  try {
    await foundry.audio.AudioHelper.play(
      { src: resolved, volume: finalVolume, loop: false, autoplay: true },
      false
    );
  } catch (e) {
    ui.notifications.error(`Preview failed: ${e?.message ?? e}`);
    console.warn(`${MODULE_ID} | preview failed for "${resolved}":`, e);
  }
}

// Fallback label chain for a sound button when the user left the Name field
// blank in the setup. Prefers the explicit name; else the filename (no ext);
// else the Sequencer DB tail; else a generic placeholder.
function _soundBoardDisplayName(entry) {
  const explicit = String(entry?.name ?? "").trim();
  if (explicit) return explicit;
  const ref = String(entry?.ref ?? "").trim();
  if (!ref) return "(unnamed)";
  if (ref.includes("/") || ref.includes("\\")) {
    const base = ref.split(/[\\\/]/).pop() ?? ref;
    return base.replace(/\.[^.]+$/, "") || ref;
  }
  const tail = ref.split(".").pop();
  return tail || ref;
}

function _sanitizeBoardData(raw) {
  // Stable per-board id — used to key the per-user volume flag and loop
  // instance ids. Minted here if the incoming data doesn't carry one so a
  // brand-new setup dialog gets a fresh id on first save. Preserved across
  // export/import because it lives inside the board data itself, not on the
  // macro doc.
  const boardId = String(raw?.boardId ?? "").trim() || foundry.utils.randomID();
  const name = String(raw?.name ?? "Sound Board").slice(0, 80);
  const sounds = Array.isArray(raw?.sounds) ? raw.sounds : [];
  const cleaned = sounds.map(s => ({
    ref:    String(s?.ref ?? "").trim(),
    name:   String(s?.name ?? "").trim(),
    volume: Math.max(0, Math.min(1, Number(s?.volume ?? 1))),
    loop:   !!s?.loop
  })).filter(s => s.ref.length > 0);
  return { boardId, name, sounds: cleaned };
}

// Play the given sound on THIS client. Every play (loop or not) is tracked
// in _soundBoardSounds so soundBoardStopLocal can find + stop the handle
// mid-playback. Non-loop sounds also register end/stop listeners so their
// entry is dropped from the map when they finish naturally — the map stays
// tidy, and the "is this instance still playing?" check in the UI stays
// accurate.
//
// Returns the Sound handle so the sender can attach its own listeners to
// update UI state on natural end.
//
// Final volume = per-sound (saved in macro) × universal board slider (client
// setting) × per-client module volume.
async function soundBoardPlayLocal({ instanceId, path, volume, loop }) {
  const resolved = resolveDbPath(path);
  if (!resolved) return null;
  const rawVolume   = Math.max(0, Math.min(1, Number(volume) || 0));
  const finalVolume = rawVolume * _getBoardVolume() * getVolume();
  try {
    const sound = await foundry.audio.AudioHelper.play(
      { src: resolved, volume: finalVolume, loop: !!loop, autoplay: true },
      false
    );
    // Race guard: a stop for this instanceId may have arrived while the
    // Sound was loading. Honour it now and skip registering the handle.
    if (instanceId && _soundBoardPendingCancellations.has(instanceId)) {
      _soundBoardPendingCancellations.delete(instanceId);
      try { sound?.stop?.(); } catch { /* Sound may still be initialising */ }
      return null;
    }
    if (sound && instanceId) {
      _soundBoardSounds.set(instanceId, { sound, rawVolume });
      // Auto-cleanup on natural end (non-loop) or explicit stop.
      if (typeof sound.addEventListener === "function") {
        const cleanup = () => _soundBoardSounds.delete(instanceId);
        sound.addEventListener("end",  cleanup);
        sound.addEventListener("stop", cleanup);
      }
    }
    return sound;
  } catch (e) {
    console.warn(`${MODULE_ID} | soundBoardPlayLocal failed for "${resolved}":`, e);
    return null;
  }
}

// Live-adjust every currently-playing sound-board Sound on THIS client
// (loop or in-flight non-loop) to match a new board-volume value. Called
// from the slider input handler so the user hears the change immediately
// instead of on next play.
function _adjustAllPlayingVolumesLocal(newBoardVolume) {
  const moduleVolume = getVolume();
  const clampedBoard = Math.max(0, Math.min(1, Number(newBoardVolume) || 0));
  for (const entry of _soundBoardSounds.values()) {
    const target = Math.max(0, Math.min(1, entry.rawVolume ?? 1)) * clampedBoard * moduleVolume;
    try { if (entry.sound) entry.sound.volume = target; }
    catch (e) { console.warn(`${MODULE_ID} | live volume adjust failed:`, e); }
  }
}

async function soundBoardStopLocal(instanceId) {
  if (!instanceId) return;
  const entry = _soundBoardSounds.get(instanceId);
  if (!entry) {
    // Play may still be in flight — park the stop until the Sound lands.
    _soundBoardPendingCancellations.add(instanceId);
    setTimeout(() => _soundBoardPendingCancellations.delete(instanceId), 30000);
    return;
  }
  try { entry.sound.stop(); } catch { /* Sound may have already stopped */ }
  _soundBoardSounds.delete(instanceId);
}

// Nuclear option — stops every currently-playing sound-board Sound on every
// client. Exposed via the module API so a user with a stuck loop after a
// browser crash / bad race can hit it from console or a macro:
//   game.modules.get("joetastic-help-signal").api.stopAllSoundBoardSounds();
function stopAllSoundBoardSounds() {
  game.socket.emit(SOCKET, { action: "soundBoardStopAll" });
  _stopAllSoundBoardSoundsLocal();
}
function _stopAllSoundBoardSoundsLocal() {
  for (const entry of _soundBoardSounds.values()) {
    try { entry.sound.stop(); } catch { /* ignore */ }
  }
  _soundBoardSounds.clear();
  _soundBoardPendingCancellations.clear();
}

// Broadcast play/stop over the module socket AND execute locally so the
// clicker hears it too.
// Broadcasts play, then plays locally on the sender. Returns the Sender's
// Sound handle so callers can attach end/stop listeners to update their own
// UI when the sound finishes naturally (non-loop) or is stopped remotely.
async function soundBoardPlay({ instanceId, path, volume, loop }) {
  // Resolve Sequencer DB category paths (e.g. "…enjee") to a concrete leaf
  // ONCE on the sender's client, then broadcast the resolved path. If we
  // broadcast the raw category, every client would pick its own random leaf
  // and users would hear different sounds simultaneously. Concrete paths
  // pass through resolveDbPath unchanged.
  const resolved = resolveDbPath(path) ?? path;
  const payload = { action: "soundBoardPlay", instanceId, path: resolved, volume, loop };
  game.socket.emit(SOCKET, payload);
  return await soundBoardPlayLocal(payload);
}

function soundBoardStop(instanceId) {
  game.socket.emit(SOCKET, { action: "soundBoardStop", instanceId });
  soundBoardStopLocal(instanceId);
}

// Build the macro command string. The whole board (name, sounds list, and
// stable boardId) is embedded as a JS literal so the macro is self-contained
// and portable — you can export it and import it into another world, and as
// long as that world has this module installed it will Just Work.
//
// String-concatenated (not a template literal) so backticks or ${} inside
// user-supplied sound names can't break out of the command.
function _soundBoardMacroCommand(board) {
  const json = JSON.stringify(board);
  return [
    SOUND_BOARD_MACRO_HEADER,
    "// Sound board data is embedded below. To edit, drag this macro onto",
    "// the module's Create Sound Board dialog.",
    "const board = " + json + ";",
    "const api = game.modules.get(\"" + MODULE_ID + "\")?.api;",
    "if (api?.openSoundBoardFromData) api.openSoundBoardFromData(board);",
    "else ui.notifications?.error?.(\"This macro needs the 'Joetastic Help Signal' module to be installed and enabled.\");"
  ].join("\n");
}

async function _createOrUpdateBoardMacro(boardData, editingMacroUuid = null) {
  const clean = _sanitizeBoardData(boardData);
  if (clean.sounds.length === 0) {
    ui.notifications.warn("Add at least one sound before saving.");
    return null;
  }

  const command = _soundBoardMacroCommand(clean);

  // Existing macro path: update everything in place so any macro references
  // the user has already dragged into a hotbar stay live.
  if (editingMacroUuid) {
    const existing = await fromUuid(editingMacroUuid);
    if (existing) {
      const updates = {
        command,
        [`flags.${MODULE_ID}.${SOUND_BOARD_MACRO_TAG}`]: true,
        [`flags.${MODULE_ID}.${SOUND_BOARD_FLAG}`]:      clean
      };
      if (existing.name !== clean.name) updates.name = clean.name;
      await existing.update(updates);
      ui.notifications.info(`Updated sound-board macro "${clean.name}".`);
      return existing;
    }
    // Fall through to create if the referenced macro is gone.
  }

  const macro = await Macro.create({
    name: clean.name,
    type: "script",
    img: "icons/svg/sound.svg",
    command,
    flags: {
      [MODULE_ID]: {
        [SOUND_BOARD_MACRO_TAG]: true,
        [SOUND_BOARD_FLAG]: clean
      }
    }
  });
  if (macro) {
    ui.notifications.info(`Created sound-board macro "${clean.name}" — drag it to your hotbar.`);
  }
  return macro;
}

// Resolve a macro reference (id, name, or uuid — passed from the macro's own
// command) to the macro doc, then extract its board data.
function _resolveBoardMacro(ref) {
  if (!ref) return null;
  return game.macros.get(ref)
      ?? game.macros.getName?.(ref)
      ?? game.macros.find(m => m.uuid === ref)
      ?? null;
}

// Preferred macro entry point (v1.5.1+). The macro's command embeds the board
// data as a JS literal and calls into this function directly, so the macro is
// self-contained — export it, hand it to a friend, they import it, it works
// (as long as their world has this module installed and enabled).
async function openSoundBoardFromData(board) {
  const clean = _sanitizeBoardData(board);
  if (clean.sounds.length === 0) {
    ui.notifications.warn("This sound board has no sounds configured.");
    return null;
  }

  const boardId = clean.boardId;

  // Single-sound shortcut: skip the grid window and just play — the macro
  // becomes a one-shot trigger. Uses a stable per-macro instance id so a
  // second click while the sound is still playing (loop OR mid-non-loop)
  // stops it; once the sound has ended naturally the map entry is gone,
  // so the next click starts fresh.
  if (clean.sounds.length === 1) {
    const sound = clean.sounds[0];
    const instanceId = `single-${boardId}`;
    if (_soundBoardSounds.has(instanceId)) {
      soundBoardStop(instanceId);
    } else {
      soundBoardPlay({
        instanceId,
        path: sound.ref,
        volume: sound.volume,
        loop: !!sound.loop
      });
    }
    return null;
  }

  const app = new SoundBoardPlayerApp({}, { boardData: clean });
  app.render(true);
  return app;
}

// Back-compat entry point for v1.5.0 macros whose command still calls
// openSoundBoard(macroId). We look up the macro by id, pull the board data
// out of its flag, and delegate to the data-driven path. Uses macro.id as
// the boardId when the flag doesn't carry one, matching v1.5.0 behaviour so
// any per-user volume flag they saved stays keyed the same way.
async function openSoundBoard(ref) {
  const macro = _resolveBoardMacro(ref);
  const data = macro?.getFlag(MODULE_ID, SOUND_BOARD_FLAG);
  if (!data) {
    ui.notifications.error("Sound board data not found on this macro.");
    return null;
  }
  return openSoundBoardFromData({ boardId: data.boardId ?? macro.id, ...data });
}

function openSoundBoardSetup() {
  const app = new SoundBoardSetupApp();
  app.render(true);
  return app;
}

// Setup dialog. Registered as a settings menu button; also opened via the API.
class SoundBoardSetupApp extends FormApplication {
  constructor(options = {}, initial = null) {
    super({}, options);
    // Loaded board data — mutated as the user edits rows. Sanitized on save.
    const seed = _sanitizeBoardData(initial ?? { name: "Sound Board", sounds: [] });
    this._board = seed;
    // Tracks the macro currently being edited/generated. Set on drop-in or
    // after a successful Generate. Subsequent Generate clicks update this
    // macro in place instead of creating a new one, so the hotbar reference
    // the user already dragged out stays live.
    this._currentMacroUuid = null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: `${MODULE_ID}-sound-board-setup`,
      title: "Sound Board — Setup",
      template: `modules/${MODULE_ID}/templates/sound-board-setup.hbs`,
      classes: [MODULE_ID],
      width: 720,
      height: "auto",
      resizable: true,
      submitOnChange: false,
      submitOnClose: false,
      closeOnSubmit: false
    });
  }

  async getData() {
    const sounds = this._board.sounds.length
      ? this._board.sounds
      : [{ ref: "", name: "", volume: 1, loop: false }];
    let currentMacro = null;
    if (this._currentMacroUuid) {
      const doc = await fromUuid(this._currentMacroUuid).catch(() => null);
      if (doc) currentMacro = { uuid: doc.uuid, name: doc.name, img: doc.img };
      else this._currentMacroUuid = null;
    }
    return {
      boardName: this._board.name,
      sounds: sounds.map(s => ({ ...s, volumePercent: Math.round((s.volume ?? 1) * 100) })),
      currentMacro,
      // Only GMs can meaningfully browse Foundry's data / the Forge Assets
      // Library from a FilePicker — hide the browse button for players.
      isGM: !!game.user?.isGM
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html?.[0] ?? html;
    if (!root) return;

    // Read the form state back into this._board so re-render doesn't lose
    // in-progress edits.
    const readForm = () => {
      const name = root.querySelector('[name="boardName"]')?.value ?? "";
      const rows = Array.from(root.querySelectorAll(".jhs-sb-row"));
      const sounds = rows.map(row => ({
        ref:    row.querySelector(".jhs-sb-ref")?.value ?? "",
        name:   row.querySelector(".jhs-sb-name")?.value ?? "",
        volume: Number(row.querySelector(".jhs-sb-volume")?.value ?? 1),
        loop:   !!row.querySelector(".jhs-sb-loop")?.checked
      }));
      this._board = { name, sounds };
    };

    // Volume slider — live label update. Doesn't need to re-render.
    root.querySelectorAll(".jhs-sb-row").forEach(row => {
      const slider = row.querySelector(".jhs-sb-volume");
      const label  = row.querySelector(".jhs-sb-volume-label");
      slider?.addEventListener("input", () => {
        if (label) label.textContent = `${Math.round((Number(slider.value) || 0) * 100)}%`;
      });
    });

    // Preview a row's sound locally (never broadcast). Reads the current
    // ref+volume values so previews reflect unsaved edits in the form.
    root.querySelectorAll(".jhs-sb-preview").forEach(btn => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        const row = btn.closest(".jhs-sb-row");
        if (!row) return;
        const ref    = row.querySelector(".jhs-sb-ref")?.value ?? "";
        const volume = Number(row.querySelector(".jhs-sb-volume")?.value ?? 1);
        _soundBoardPreviewLocal(ref, volume);
      });
    });

    // Delete row.
    root.querySelectorAll(".jhs-sb-delete").forEach(btn => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        readForm();
        const idx = Number(btn.closest(".jhs-sb-row")?.dataset.idx ?? -1);
        if (idx >= 0) this._board.sounds.splice(idx, 1);
        this.render(true);
      });
    });

    // Add row.
    root.querySelector(".jhs-sb-add-row")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      readForm();
      this._board.sounds.push({ ref: "", name: "", volume: 1, loop: false });
      this.render(true);
    });

    // Browse-for-audio-file button on each row. Only rendered for GMs (see
    // the template's {{#if ../isGM}} gate), but we double-check here in case
    // a partially-rendered HTML from a permission flip left the button in
    // place. On Forge, when the field is empty, default to the user's Forge
    // Assets Library ("forgevtt" source) instead of the local Data root.
    // If the field already contains a path, FilePicker auto-detects the
    // source from the URL, which is friendlier than forcing forgevtt.
    root.querySelectorAll(".jhs-sb-browse").forEach(btn => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        if (!game.user?.isGM) return;
        const input = btn.closest("td")?.querySelector(".jhs-sb-ref");
        if (!input) return;

        const options = {
          type: "audio",
          current: input.value || "",
          callback: (path) => { input.value = path; }
        };
        if (!options.current && window.ForgeVTT?.usingTheForge) {
          options.activeSource = "forgevtt";
        }
        new FilePicker(options).render(true);
      });
    });

    // Close + Generate. Generate does NOT close the dialog — it (re)creates
    // the macro and rerenders so the draggable icon is visible for the user
    // to drop into their hotbar. Subsequent clicks update the same macro.
    root.querySelector(".jhs-sb-cancel")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      this.close();
    });
    root.querySelector(".jhs-sb-generate")?.addEventListener("click", async (ev) => {
      ev.preventDefault();
      readForm();
      const macro = await _createOrUpdateBoardMacro(this._board, this._currentMacroUuid);
      if (macro) {
        this._currentMacroUuid = macro.uuid;
        this.render(true);
      }
    });

    // Wire drag on the generated macro icon so it lands on the hotbar as a
    // real macro reference (Foundry parses the {type,uuid} JSON payload).
    bindDragTargets(html, ".jhs-macro-drag");

    // Whole-dialog drop target so users can drop a macro anywhere on it.
    // Everything here is guarded so dropping arbitrary items/actors/text on
    // the dialog just no-ops or warns, never throws.
    root.addEventListener("dragover", (ev) => { ev.preventDefault(); });
    root.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      let payload;
      try {
        const raw = ev.dataTransfer?.getData?.("text/plain");
        if (!raw) return;
        payload = JSON.parse(raw);
      } catch { return; }

      if (payload?.type !== "Macro") {
        if (payload?.type) ui.notifications.warn("Only sound-board macros can be dropped here.");
        return;
      }

      let macro = null;
      try {
        if (payload.uuid)     macro = await fromUuid(payload.uuid);
        else if (payload.id)  macro = game.macros.get(payload.id);
      } catch (e) {
        console.warn(`${MODULE_ID} | sound-board drop: macro lookup failed:`, e);
      }
      if (!macro) {
        ui.notifications.warn("Couldn't resolve the dropped macro.");
        return;
      }

      if (!_isSoundBoardMacro(macro)) {
        ui.notifications.warn(`"${macro.name}" isn't a Joetastic sound board macro.`);
        return;
      }

      const data = macro.getFlag(MODULE_ID, SOUND_BOARD_FLAG);
      // v1.5.0 macros used macro.id as the implicit boardId. When editing one,
      // keep that id so any per-user board-volume flag the player set stays
      // valid across the upgrade to the data-embedded command format.
      const seed = data
        ? { ...data, boardId: data.boardId ?? macro.id }
        : { boardId: macro.id, name: macro.name, sounds: [] };
      this._board = _sanitizeBoardData(seed);
      this._currentMacroUuid = macro.uuid;
      this.render(true);
    });
  }

  // Foundry's FormApplication insists on this, but we handle save via a
  // button click so the form-submit path is a no-op.
  async _updateObject() {}
}

// Player: opened by the generated macro. Grid of buttons; broadcasts play/stop
// via the module socket so every client hears the sounds.
class SoundBoardPlayerApp extends Application {
  constructor(options = {}, { boardData = null } = {}) {
    super(options);
    // _sanitizeBoardData mints a boardId if the incoming data didn't carry
    // one, so this._boardId is always populated exactly once from the board.
    this._board = _sanitizeBoardData(boardData ?? { name: "Sound Board", sounds: [] });
    this._boardId = this._board.boardId;
    // buttonIndex -> instanceId of the sound this app is currently tracking.
    this._playing = new Map();
    // Sounds keep playing after this app is closed (by design). When the
    // user reopens the board, we rehydrate _playing from the global
    // _soundBoardSounds registry so the buttons show PLAYING again and
    // clicking them stops the sound properly.
    this._reconcilePlaying();
    // Personal, persistent scalar applied to every sound this player plays.
    // Client-scoped setting shared by all sound boards on this machine.
    this._boardVolume = _getBoardVolume();
    // Locate the macro this data came from so right-click edits can persist
    // back to it. v1.5.1+ macros carry the boardId in flags.soundBoard;
    // v1.5.0 macros used their doc id as the implicit boardId (fall back to
    // that if the flag doesn't match).
    this._sourceMacro =
      game.macros.find(m => m.getFlag(MODULE_ID, SOUND_BOARD_FLAG)?.boardId === this._boardId)
      ?? game.macros.get(this._boardId)
      ?? null;
    // Popover state + debounced persist timer.
    this._rowMenu = null;
    this._persistTimer = null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: `${MODULE_ID}-sound-board-player`,
      title: "Sound Board",
      template: `modules/${MODULE_ID}/templates/sound-board-player.hbs`,
      classes: [MODULE_ID],
      width: 520,
      height: "auto",
      resizable: true,
      popOut: true
    });
  }

  get title() { return this._board.name || "Sound Board"; }

  async getData() {
    return {
      boardName: this._board.name,
      hasSounds: this._board.sounds.length > 0,
      boardVolume: this._boardVolume,
      boardVolumePercent: Math.round(this._boardVolume * 100),
      // Owners can right-click to edit and see the New Sound button; non-
      // owners just get a play grid (edits wouldn't persist for them anyway).
      isOwner: !!this._sourceMacro?.isOwner,
      isGM: !!game.user?.isGM,
      sounds: this._board.sounds.map(s => ({
        ...s,
        displayName:   _soundBoardDisplayName(s),
        volumePercent: Math.round((s.volume ?? 1) * 100)
      }))
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html?.[0] ?? html;
    if (!root) return;

    // Board volume slider. Label updates continuously; the persistent write
    // only fires on `change` (slider release) to avoid spamming setFlag.
    // Live-adjusts any currently-playing loops from this board on this client.
    const slider = root.querySelector(".jhs-sb-board-volume");
    const label  = root.querySelector(".jhs-sb-board-volume-label");
    if (slider) {
      slider.addEventListener("input", () => {
        const v = Math.max(0, Math.min(1, Number(slider.value) || 0));
        this._boardVolume = v;
        if (label) label.textContent = `${Math.round(v * 100)}%`;
        _adjustAllPlayingVolumesLocal(v);
      });
      slider.addEventListener("change", () => {
        _setBoardVolume(this._boardVolume)
          .catch(e => console.warn(`${MODULE_ID} | board volume persist failed:`, e));
      });
    }

    // "New Sound" button — appends an empty entry and opens the edit popover
    // in add mode. Owner-only (template gates it too, but be defensive here).
    // Explicitly closes any prior menu FIRST so that if a previous add-mode
    // popover left an empty placeholder in the sounds array, it gets spliced
    // out before we push our new placeholder — otherwise the indices we
    // capture next would drift when close fires later.
    root.querySelector(".jhs-sb-new-sound")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      if (!this._sourceMacro?.isOwner) return;
      this._closeRowMenu();
      this._board.sounds.push({ ref: "", name: "", volume: 1, loop: false });
      const idx = this._board.sounds.length - 1;
      this._openRowMenu(idx, ev, { mode: "add" });
    });

    const buttons = root.querySelectorAll(".jhs-sb-play");
    buttons.forEach(btn => {
      // Right-click → inline edit popover (owners only, since edits persist).
      btn.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        if (!this._sourceMacro?.isOwner) return;
        const idx = Number(btn.dataset.idx);
        if (Number.isFinite(idx)) this._openRowMenu(idx, ev);
      });

      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const idx = Number(btn.dataset.idx);
        const entry = this._board.sounds[idx];
        if (!entry) return;

        // Toggle off if this button's sound is currently playing (loop OR a
        // still-in-flight non-loop). Guarantees a second click of the same
        // button always means "stop."
        const currentInstance = this._playing.get(idx);
        if (currentInstance) {
          soundBoardStop(currentInstance);
          this._playing.delete(idx);
          this._setButtonPlaying(btn, false);
          return;
        }

        // Multiple sounds can play concurrently — just start this one. Only
        // this same button being clicked again will stop it (toggle-off
        // branch above), and each other button manages its own instance.
        const instanceId = `${this._boardId}-${idx}-${foundry.utils.randomID(6)}`;
        this._playing.set(idx, instanceId);
        this._setButtonPlaying(btn, true);

        const sound = await soundBoardPlay({
          instanceId,
          path: entry.ref,
          volume: entry.volume,
          loop: !!entry.loop
        });

        // Clear the button visual when the local Sound emits "end" (non-
        // loop finishes) or "stop" (someone stopped it — us, another user
        // via broadcast, or the browser cleanup). Guard against races where
        // the same idx has since been used by a fresher play.
        if (typeof sound?.addEventListener === "function") {
          const cleanup = () => {
            if (this._playing.get(idx) !== instanceId) return;
            this._playing.delete(idx);
            const laterBtn = this.element?.[0]?.querySelector(`.jhs-sb-play[data-idx="${idx}"]`);
            this._setButtonPlaying(laterBtn, false);
          };
          sound.addEventListener("end",  cleanup);
          sound.addEventListener("stop", cleanup);
        }
      });
    });

    // Re-renders (New Sound, cancelled add, etc.) rebuild the button DOM, so
    // any loops still in-flight need their PLAYING visual restored — they're
    // tracked in this._playing which survives re-render.
    for (const idx of this._playing.keys()) {
      const btn = root.querySelector(`.jhs-sb-play[data-idx="${idx}"]`);
      this._setButtonPlaying(btn, true);
    }
  }

  // Stop every sound this window is tracking (loops and any in-flight non-
  // loops). Optionally resets the visual state of the corresponding buttons
  // if a DOM root is passed (during a click).
  _stopAllSounds(root = null) {
    for (const [otherIdx, instanceId] of this._playing.entries()) {
      soundBoardStop(instanceId);
      if (root) {
        const btn = root.querySelector(`.jhs-sb-play[data-idx="${otherIdx}"]`);
        this._setButtonPlaying(btn, false);
      }
    }
    this._playing.clear();
  }

  // Rebuild _playing by scanning the global registry for instanceIds that
  // belong to this board. Called from the constructor so a reopened board
  // resumes tracking any sounds that were still playing after the previous
  // close. Also attaches cleanup listeners so those sounds clear the button
  // visuals when they eventually end (naturally or via stop).
  _reconcilePlaying() {
    const prefix = `${this._boardId}-`;
    for (const [instanceId, entry] of _soundBoardSounds.entries()) {
      if (!instanceId.startsWith(prefix)) continue;
      const remainder = instanceId.slice(prefix.length);
      const dash = remainder.indexOf("-");
      if (dash < 0) continue;
      const idx = Number(remainder.slice(0, dash));
      if (!Number.isFinite(idx)) continue;
      this._playing.set(idx, instanceId);

      if (entry?.sound && typeof entry.sound.addEventListener === "function") {
        const cleanup = () => {
          if (this._playing.get(idx) !== instanceId) return;
          this._playing.delete(idx);
          const laterBtn = this.element?.[0]?.querySelector(`.jhs-sb-play[data-idx="${idx}"]`);
          this._setButtonPlaying(laterBtn, false);
        };
        entry.sound.addEventListener("end",  cleanup);
        entry.sound.addEventListener("stop", cleanup);
      }
    }
  }

  _setButtonPlaying(btn, on) {
    if (!btn) return;
    const state = btn.querySelector(".jhs-sb-btn-state");
    if (on) {
      btn.classList.add("jhs-sb-playing");
      // Reveal via visibility so the button doesn't grow — the span was
      // reserving its space with visibility:hidden.
      if (state) state.style.visibility = "";
      Object.assign(btn.style, { background: "#3f0f0f", borderColor: "#fca5a5" });
    } else {
      btn.classList.remove("jhs-sb-playing");
      if (state) state.style.visibility = "hidden";
      Object.assign(btn.style, { background: "#0a0a0f", borderColor: "#dc2626" });
    }
  }

  // Live-refresh a single grid button's label/meta after an inline edit,
  // so we don't need a full re-render (which would kill scroll position and
  // reset the loop-play visuals).
  _refreshButton(idx) {
    const root = this.element?.[0];
    if (!root) return;
    const btn = root.querySelector(`.jhs-sb-play[data-idx="${idx}"]`);
    if (!btn) return;
    const entry = this._board.sounds[idx];
    if (!entry) return;
    const displayName = _soundBoardDisplayName(entry);
    const volumePct   = Math.round((entry.volume ?? 1) * 100);
    const nameSpan = btn.querySelector(".jhs-sb-btn-name");
    const metaSpan = btn.querySelector(".jhs-sb-btn-meta");
    if (nameSpan) nameSpan.textContent = displayName;
    if (metaSpan) metaSpan.textContent = `${volumePct}%${entry.loop ? " · LOOP" : ""}`;
    btn.dataset.loop = String(entry.loop);
    btn.title = displayName;
  }

  // Debounced write of the whole board back to the source macro. Any inline
  // edit fires this; multiple rapid edits coalesce into one macro update.
  _persistBoardChanges() {
    if (!this._sourceMacro?.isOwner) return;
    clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
      _createOrUpdateBoardMacro(this._board, this._sourceMacro.uuid)
        .catch(e => console.warn(`${MODULE_ID} | inline sound edit persist failed:`, e));
    }, 300);
  }

  _openRowMenu(idx, ev, { mode = "edit" } = {}) {
    this._closeRowMenu();
    const entry = this._board.sounds[idx];
    if (!entry) return;

    const popover = document.createElement("div");
    popover.className = "jhs-sb-rowmenu";
    // Foundry Applications assign an inline zIndex that climbs each time a
    // window is focused (via Application._maxZ). Set the popover ABOVE the
    // player app's current zIndex, with a hard floor well above any other
    // typical Foundry window.
    const appZ = Number(this.element?.[0]?.style?.zIndex) || 0;
    const popoverZ = Math.max(appZ + 5, 10000);
    Object.assign(popover.style, {
      position: "fixed",
      left:  `${(ev.clientX ?? 0) + 6}px`,
      top:   `${(ev.clientY ?? 0) + 6}px`,
      zIndex: String(popoverZ),
      minWidth: "320px",
      padding: "0.65em 0.8em",
      borderRadius: "8px",
      border: "1px solid #dc2626",
      background: "#0a0a0f",
      color: "#f5f5f4",
      boxShadow: "0 6px 22px rgba(0,0,0,0.5)"
    });

    const isGM  = !!game.user?.isGM;
    const title = mode === "add" ? "Add new sound" : "Edit sound";
    popover.innerHTML = `
      <div style="font-weight:700; font-size:0.9em; margin-bottom:0.4em;">${title}</div>
      <div style="margin-bottom:0.5em;">
        <label style="display:block; font-size:0.8em; opacity:0.8; margin-bottom:0.15em;">Sound Reference</label>
        <div style="display:flex; align-items:center; gap:0.25em; width:100%;">
          <input type="text" class="jhs-rm-ref"
                 placeholder="Sequencer DB path or file path"
                 style="flex:1 1 0; min-width:0; width:100%; box-sizing:border-box;"/>
          ${isGM ? `
            <button type="button" class="jhs-rm-browse" title="Browse for audio file"
                    style="flex:0 0 28px; width:28px; height:28px; padding:0; line-height:1;
                           display:inline-flex; align-items:center; justify-content:center;">
              <i class="fas fa-folder-open"></i>
            </button>` : ""}
        </div>
      </div>
      <div style="margin-bottom:0.5em;">
        <label style="display:block; font-size:0.8em; opacity:0.8; margin-bottom:0.15em;">Display Name</label>
        <input type="text" class="jhs-rm-name" style="width:100%; box-sizing:border-box;"/>
      </div>
      <div style="margin-bottom:0.5em;">
        <label style="display:block; font-size:0.8em; opacity:0.8; margin-bottom:0.15em;">Volume</label>
        <div style="display:flex; align-items:center; gap:0.4em;">
          <input type="range" class="jhs-rm-volume" min="0" max="1" step="0.05"
                 style="flex:1 1 0; min-width:0;"/>
          <span class="jhs-rm-vol-label" style="min-width:2.75em; text-align:right; font-size:0.85em;"></span>
        </div>
      </div>
      <div style="margin-bottom:0.55em;">
        <label style="display:inline-flex; align-items:center; gap:0.4em; font-size:0.9em;">
          <input type="checkbox" class="jhs-rm-loop"/> Loop
        </label>
      </div>
      <div style="display:flex; justify-content:flex-end;">
        <button type="button" class="jhs-rm-close" style="padding:0.25em 0.75em;">Close</button>
      </div>
    `;
    document.body.appendChild(popover);

    // Populate values programmatically so user-typed strings never need HTML
    // escaping — no injection risk from a maliciously-named sound.
    const refInput  = popover.querySelector(".jhs-rm-ref");
    const browseBtn = popover.querySelector(".jhs-rm-browse");
    const nameInput = popover.querySelector(".jhs-rm-name");
    const volSlider = popover.querySelector(".jhs-rm-volume");
    const volLabel  = popover.querySelector(".jhs-rm-vol-label");
    const loopBox   = popover.querySelector(".jhs-rm-loop");
    const closeBtn  = popover.querySelector(".jhs-rm-close");
    refInput.value  = entry.ref ?? "";
    nameInput.value = entry.name ?? "";
    volSlider.value = String(entry.volume ?? 1);
    volLabel.textContent = `${Math.round((entry.volume ?? 1) * 100)}%`;
    loopBox.checked = !!entry.loop;

    const commit = () => {
      entry.ref    = (refInput.value ?? "").trim();
      entry.name   = nameInput.value ?? "";
      entry.volume = Math.max(0, Math.min(1, Number(volSlider.value) || 0));
      entry.loop   = !!loopBox.checked;
      // Only refresh the button when it exists in the DOM. In "add" mode
      // the button is created on popover close via re-render, so refresh
      // here would no-op — the re-render will build it from board data.
      if (mode !== "add") this._refreshButton(idx);
      this._persistBoardChanges();
    };

    refInput.addEventListener("input", commit);
    nameInput.addEventListener("input", commit);
    volSlider.addEventListener("input", () => {
      volLabel.textContent = `${Math.round((Number(volSlider.value) || 0) * 100)}%`;
      commit();
    });
    loopBox.addEventListener("change", commit);
    closeBtn.addEventListener("click", () => this._closeRowMenu());

    // Browse button — GM-only, mirrors the setup dialog's picker behaviour.
    browseBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      if (!game.user?.isGM) return;
      const options = {
        type: "audio",
        current: refInput.value || "",
        callback: (path) => { refInput.value = path; commit(); }
      };
      if (!options.current && window.ForgeVTT?.usingTheForge) {
        options.activeSource = "forgevtt";
      }
      new FilePicker(options).render(true);
    });

    // Dismiss on click-outside or Escape. Delay attaching so the current
    // right-click / New-Sound click doesn't immediately count as outside.
    const outsideClick = (e) => {
      // Ignore clicks inside the FilePicker window that the browse button
      // spawned — otherwise picking a file dismisses the popover.
      if (popover.contains(e.target)) return;
      if (e.target.closest?.(".filepicker")) return;
      this._closeRowMenu();
    };
    const escKey = (e) => {
      if (e.key === "Escape") this._closeRowMenu();
    };
    setTimeout(() => {
      document.addEventListener("mousedown", outsideClick);
      document.addEventListener("keydown", escKey);
    }, 0);

    this._rowMenu = { popover, outsideClick, escKey, idx, mode };
    // In add mode the ref is the first thing the user needs; in edit mode
    // start on the name field (most common tweak).
    const focusTarget = mode === "add" ? refInput : nameInput;
    focusTarget.focus();
    focusTarget.select();
  }

  _closeRowMenu() {
    if (!this._rowMenu) return;
    const { popover, outsideClick, escKey, idx, mode } = this._rowMenu;
    document.removeEventListener("mousedown", outsideClick);
    document.removeEventListener("keydown", escKey);
    popover.remove();
    this._rowMenu = null;

    if (mode === "add") {
      // Discard the placeholder entry if the user closed without entering
      // a sound reference. Either way, re-render so the grid reflects the
      // final state (new button appearing, or the placeholder vanishing).
      const entry = this._board.sounds[idx];
      if (!entry?.ref?.trim()) {
        this._board.sounds.splice(idx, 1);
      }
      this.render(false);
    }
  }

  async close(options) {
    this._closeRowMenu();
    // Flush any pending debounced write immediately so a fast close doesn't
    // drop the user's last edit.
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
      if (this._sourceMacro?.isOwner) {
        try { await _createOrUpdateBoardMacro(this._board, this._sourceMacro.uuid); }
        catch (e) { console.warn(`${MODULE_ID} | inline edit final persist failed:`, e); }
      }
    }
    // Sounds intentionally keep playing after the app closes. Reopening the
    // board rehydrates the playing state via _reconcilePlaying in the
    // constructor, so the user can find and stop any lingering loops. If
    // something needs killed without reopening, the API method
    // `stopAllSoundBoardSounds()` broadcasts a kill to every client.
    return super.close(options);
  }
}

Hooks.once("init", () => {
  // Register each variant's status effect so Foundry's token-overlay pipeline
  // treats it as first-class and paints the correct icon. Also mirror into
  // dnd5e's condition palette so the token HUD condition grid shows them.
  for (const variant of Object.values(VARIANTS)) {
    CONFIG.statusEffects.push({
      _id: variant.effectId,
      id: variant.statusId,
      name: variant.effectName,
      img: variant.icon
    });

    if (CONFIG.DND5E?.conditionTypes) {
      CONFIG.DND5E.conditionTypes[variant.statusId] = {
        name: variant.effectName,
        img: variant.icon,
        pseudo: false,
        reference: null,
        statuses: [variant.statusId]
      };
    }
  }

  // Registered first so it lands at the very top of the module's settings
  // section. renderSettingsConfig then wraps this menu row in a highlighted
  // box so it visually reads as the primary entry point.
  game.settings.registerMenu(MODULE_ID, "bandMateMenu", {
    name: "Band Mate Macros",
    label: "Show Band Mate Icons",
    hint: "Open a dialog with your five personal Band Mate toggle macros (Scales, Dreadie, Kaldur, Enjee, Rico). Drag any to your hotbar; each toggles independently (check when ON, X when OFF). Right-click an icon to configure its sound, animation, coloring, and triggers.",
    icon: "fas fa-guitar",
    type: BandMateMacrosMenuApp,
    restricted: false
  });

  // Per-client volume slider. Registered next so it renders below the Band
  // Mate menu. Every cue this module plays (apply, trigger, expire) scales
  // by this value on the local client.
  game.settings.register(MODULE_ID, "volume", {
    name: "Sound Volume",
    hint: "Local volume for all Help Signal sounds. Each user sets their own.",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: 0.8
  });

  const registerString = (key, name, hint, def) =>
    game.settings.register(MODULE_ID, key, {
      name, hint, scope: "client", config: true, type: String, default: def
    });

  registerString("applySound", "On-Apply Sound",
    "Sound played when Help is applied. File path under Data/ or Sequencer DB path. Blank to disable.",
    "joetastic-help-signal.billandted");
  registerString("applyAnimation", "On-Apply Animation",
    "Sequencer DB path. Blank to disable.",
    "joetastic-help-signal.ontokenbuff.001.005");

  registerString("attackSound", "On-Trigger Sound (help worked)",
    "Played when the marked target's roll used the expected direction — ADVANTAGE for Help-Attack (ally rolled with advantage), DISADVANTAGE for Help-Save (marked enemy rolled with disadvantage). Accepts a raw file path or a Sequencer DB path. If the DB path is a folder, a random file from that folder plays. Blank to disable.",
    "joetastic-help-signal.guitaropenings");
  registerString("reminderSound", "On-Trigger Sound (help forgotten)",
    "Played when the marked target's roll did NOT have the expected direction — a nudge that Help was available and wasn't used. Blank to disable.",
    "joetastic-help-signal.boing");
  registerString("attackAnimation", "On-Trigger Animation",
    "Sequencer DB path. Plays on the marked target whenever a trigger roll fires, regardless of outcome. Blank to disable.",
    "joetastic-help-signal.explosion.06");

  registerString("expireSound", "On-Expire Sound",
    "Played when the Help effect expires at the start of the instigator's next turn. Blank to disable.",
    "");
  registerString("expireAnimation", "On-Expire Animation",
    "Sequencer DB path. Blank to disable.",
    "");

  game.settings.register(MODULE_ID, "autoClearOnTurnStart", {
    name: "Auto-Clear on Turn Start",
    hint: "Automatically remove Help effects at the start of the instigating token's next turn (the token that took the Help action). Turn off to keep the effect until manually cleared or a trigger fires.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "broadcastCues", {
    name: "Broadcast Cues from Instigator",
    hint: "When ON: only the instigating player's client plays each cue, but broadcasts the sound + animation to everyone. Everyone hears the instigator's chosen sound. When OFF: each client plays its own configured cue locally, so different players can hear different sounds.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.registerMenu(MODULE_ID, "macroMenu", {
    name: "Apply Help Macros",
    label: "Show Draggable Icons",
    hint: "Open a dialog with draggable macro icons for all Help flavors (Attack, Save, Ability). Drop any of them into a hotbar slot to bind it.",
    icon: "fas fa-hand-rock",
    type: HelpMacrosMenuApp,
    restricted: false
  });

  game.settings.registerMenu(MODULE_ID, "itemMenu", {
    name: "Help Action Items",
    label: "Show Draggable Items",
    hint: "Open a dialog with draggable Help feat items (Attack, Save, Ability). Drop any of them onto a character sheet to add it.",
    icon: "fas fa-hand-holding",
    type: HelpItemsMenuApp,
    restricted: false
  });

  game.settings.registerMenu(MODULE_ID, "soundBoardSetup", {
    name: "Create Sound Board",
    label: "Open Sound Board Setup",
    hint: "Configure a list of sounds (name, volume, loop) and generate a macro that opens a click-to-play grid. Sounds broadcast to all clients when played. Drag an existing sound-board macro onto the setup dialog to edit it.",
    icon: "fas fa-music",
    type: SoundBoardSetupApp,
    restricted: false
  });

  // Hidden client-scoped setting: the sound-board slider value. One number
  // per client, shared by every sound board (no per-board flags, no orphan
  // risk when boards get deleted).
  game.settings.register(MODULE_ID, "soundBoardVolume", {
    scope: "client",
    config: false,
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: 1
  });

  // NOTE: Band Mate settings (enabled/sound/animation/hue/saturate/
  // brightness/rainbow/trigger toggles + fallback animation) are NOT
  // registered as Foundry settings. They live on the User document as flags
  // (see bandMateGetFlag / bandMateSetFlag). Foundry client-scoped settings
  // share localStorage between all users in the same browser origin, which
  // caused two players in different tabs to overwrite each other's toggles.
  // User flags are keyed by user id server-side and correctly isolate state
  // per user regardless of how the clients are running.

  game.settings.register(MODULE_ID, "debugBandMate", {
    name: "Band Mate — Debug Logging",
    hint: "When ON, prints trace messages to the browser console (F12) each time a chat message is inspected by the Band Mate hook, showing which gate accepts or rejects the cue. Useful for diagnosing 'nothing plays' issues.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });

  // Highlight the Band Mate Macros row in the module settings pane so it
  // stands out as the primary entry point. Runs on every render of the
  // settings dialog. Handles both the classic (v11-) and new (v12+) DOM.
  Hooks.on("renderSettingsConfig", (app, html) => {
    const root = html?.[0] ?? html?.jquery ? html[0] : html;
    if (!root?.querySelector) return;
    const btn = root.querySelector(`button[data-key="${MODULE_ID}.bandMateMenu"]`);
    const row = btn?.closest(".form-group") ?? btn?.closest(".submenu");
    if (!row) return;
    Object.assign(row.style, {
      border: "2px solid #dc2626",
      borderRadius: "8px",
      padding: "0.75em 1em",
      margin: "0.75em 0 1em 0",
      background: "linear-gradient(0deg, rgba(220,38,38,0.08), rgba(220,38,38,0.14))",
      boxShadow: "0 0 8px rgba(220,38,38,0.35)"
    });
  });
});

Hooks.once("ready", () => {
  game.socket.on(SOCKET, async (data) => {
    // Every client (not just the GM) plays the apply cue locally on their
    // own machine. Sound is scaled by each client's own volume slider.
    if (data?.action === "applyCue") {
      const tokens = [];
      for (const uuid of data.tokenUuids ?? []) {
        const doc = await fromUuid(uuid);
        if (!doc) continue;
        tokens.push(doc.object ?? doc);
      }
      playApplyCueLocal(tokens, data.cues ?? null);
      return;
    }

    // Sound board play/stop. Broadcast to every client — each plays locally
    // so their own volume slider scales it and stops route to their own
    // Sound handle.
    if (data?.action === "soundBoardPlay") {
      await soundBoardPlayLocal(data);
      return;
    }
    if (data?.action === "soundBoardStop") {
      await soundBoardStopLocal(data.instanceId);
      return;
    }
    if (data?.action === "soundBoardStopAll") {
      _stopAllSoundBoardSoundsLocal();
      return;
    }

    if (!game.user.isGM) return;

    if (data?.action === "apply") {
      const variant = getVariant(data.variantKey);
      await applyToActorUuids(data.actorUuids ?? [], variant.key, data.instigatorUuid ?? null, data.cues ?? null);
      // ui.notifications.info(
      //   `Applied "${variant.effectName}" to ${data.actorUuids.length} target(s) at ${data.requester}'s request.`
      // ); // debug only
      return;
    }

    if (data?.action === "delete") {
      try {
        const effect = await fromUuid(data.effectUuid);
        if (effect) await effect.delete();
      } catch (e) {
        if (!/does not exist/i.test(e?.message ?? "")) console.warn(e);
      }
      return;
    }

    // Delegated Band Mate img update from a user who lacks OWNER on their macro.
    if (data?.action === "setBandMateImg") {
      try {
        const macro = await fromUuid(data.macroUuid);
        if (macro && macro.img !== data.img) await macro.update({ img: data.img });
      } catch (e) {
        if (!/does not exist/i.test(e?.message ?? "")) console.warn(e);
      }
      return;
    }

    // Delegated full Band Mate macro update (name/command/img/mate-flag) —
    // used when a user changes their mate selection but doesn't own the doc.
    if (data?.action === "updateBandMateMacro") {
      try {
        const macro = await fromUuid(data.macroUuid);
        if (macro) await macro.update(data.updates ?? {});
      } catch (e) {
        if (!/does not exist/i.test(e?.message ?? "")) console.warn(e);
      }
      return;
    }
  });

  // Block duplicate Help effects and convert a "duplicate add" attempt (e.g.
  // the HUD palette click when the palette doesn't visually reflect the
  // existing effect) into a DELETE of the existing effect. So the palette
  // icon works as a functional toggle even when its highlight state is wrong.
  Hooks.on("preCreateActiveEffect", (effect, data, options, userId) => {
    const variant = getVariantByEffectName(effect.name);
    if (!variant) return true;
    const actor = effect.parent;
    if (!actor?.effects) return true;
    const existing = actor.effects.find(e => e.name === variant.effectName && e.id !== effect.id);
    if (!existing) return true;

    if (userId === game.user.id) {
      const uuid = existing.uuid;
      if (game.user.isGM) {
        setTimeout(async () => {
          try {
            const fresh = await fromUuid(uuid);
            if (fresh) await fresh.delete();
          } catch (e) {
            if (!/does not exist/i.test(e?.message ?? "")) console.warn(e);
          }
        }, 50);
      } else {
        game.socket.emit(SOCKET, { action: "delete", effectUuid: uuid });
      }
      ui.notifications.info(`Removed "${variant.effectName}" from ${actor.name}.`);
    }
    return false;
  });

  // Preload each effect's baked cue files on creation so trigger/expire cues
  // are cached and ready. The apply cue is played directly on all clients
  // via the applyCue socket message, not from this hook.
  Hooks.on("createActiveEffect", (effect) => {
    if (!getVariantByEffectName(effect.name)) return;
    const cues = effect.getFlag(MODULE_ID, "cues");
    if (!cues) return;
    if (typeof Sequencer === "undefined" || !Sequencer.Preloader) return;

    const paths = [];
    for (const value of Object.values(cues)) {
      if (!value) continue;
      const resolved = resolveDbPath(value);
      if (resolved && !paths.includes(resolved)) paths.push(resolved);
    }
    if (paths.length === 0) return;

    Sequencer.Preloader.preload(paths)
      .catch(e => console.warn(`${MODULE_ID} | baked-cue preload failed:`, e));
  });

  // Trigger cue: when a chat message is a roll type a variant listens for,
  // find every actor involved in the roll that has that variant's Help
  // effect and fire the trigger cue. Which "involved" means depends on the
  // variant's matchScope:
  //   attack   → dnd5e.targets (mark the enemy; ally attacks them)
  //   save     → speaker (marked enemy rolls a save)
  //   ability  → n/a — variant has no rollTypes, doesn't fire here
  //
  // Which side of the roll "worked" also depends on the variant:
  //   Help-Attack → advantage means the player used the help → attack cue.
  //   Help-Save   → disadvantage means the mark hit → attack cue.
  Hooks.on("createChatMessage", async (message) => {
    const dnd = message.flags?.dnd5e;
    const rollType = dnd?.roll?.type ?? dnd?.messageType;
    const variant = getVariantForRollType(rollType);
    if (!variant?.triggerMode) return;

    const roll = message.rolls?.[0];
    const advantageMode = roll?.options?.advantageMode ?? 0;
    const hadAdvantage    = roll?.hasAdvantage    === true || advantageMode > 0;
    const hadDisadvantage = roll?.hasDisadvantage === true || advantageMode < 0;
    const success = variant.triggerMode === "advantage" ? hadAdvantage : hadDisadvantage;

    const candidateUuids = new Set();
    if (variant.matchScope === "target" || variant.matchScope === "either") {
      for (const t of (dnd?.targets ?? [])) {
        if (t.uuid) candidateUuids.add(t.uuid);
      }
    }
    if (variant.matchScope === "speaker" || variant.matchScope === "either") {
      const speakerActor = ChatMessage.getSpeakerActor?.(message.speaker)
                        ?? game.actors.get(message.speaker?.actor);
      if (speakerActor) candidateUuids.add(speakerActor.uuid);
    }

    for (const uuid of candidateUuids) {
      const actor = await fromUuid(uuid);
      if (!actor) continue;

      const effect = actor.effects?.find(e => e.name === variant.effectName);
      if (!effect) continue;

      const token = actor.getActiveTokens()[0];

      const broadcastMode = game.settings.get(MODULE_ID, "broadcastCues");
      const broadcasterId = broadcastMode ? (message.user?.id ?? null) : null;
      const cues = effect.getFlag(MODULE_ID, "cues");

      if (success) {
        // Some variants suppress the "worked" cue for specific skills —
        // e.g. Help-Ability skips it on Performance so the Band Mate sound
        // isn't stepped on. Other successes still play the cue.
        const rollSkillId = message.flags?.dnd5e?.roll?.skillId ?? message.flags?.dnd5e?.roll?.key;
        const suppress = variant.suppressSuccessOnSkills?.includes(rollSkillId);
        if (!suppress) {
          playCue("attack", token, { broadcastFromUserId: broadcasterId, overrides: cues });
        }
      } else {
        playCue("reminder", token, { animKind: "attack", broadcastFromUserId: broadcasterId, overrides: cues });
      }

      safeDeleteEffect(actor, effect);
    }
  });

  // Band Mate: every client sees every chat message. Gate to fire exactly
  // once, on the right client:
  //   Player → the message's actor is one they own (their PC, companions,
  //            summons — regardless of who initiated the roll).
  //   GM     → testing-only. Fires only when the GM has a matching token
  //            selected. Band Mate is expected OFF for the GM in normal play.
  console.log(`${MODULE_ID} | BandMate | createChatMessage hook registered on ${game.user.isGM ? "GM" : "player"} client (user: ${game.user.name})`);
  Hooks.on("createChatMessage", (message) => {
    // Unconditional entry log — proves the hook fires on this client. Keep
    // it terse so it's not too noisy.
    console.log(`${MODULE_ID} | BandMate | hook fired | user=${game.user.name} isGM=${game.user.isGM} msgUser=${message.user?.name} speakerActor=${message.speaker?.actor}`);
    const dbg = game.settings.get(MODULE_ID, "debugBandMate");
    const log = (...args) => { if (dbg) console.log(`${MODULE_ID} | BandMate |`, ...args); };

    if (!anyBandMateOn()) {
      log("skip: no mate is ON on this client");
      return;
    }
    const reason = getBandMateTriggerReason(message);
    if (!reason) {
      log("skip: message is not a trigger", {
        rollType: message.flags?.dnd5e?.roll?.type,
        skillId:  message.flags?.dnd5e?.roll?.skillId ?? message.flags?.dnd5e?.roll?.key,
        itemType: message.flags?.dnd5e?.item?.type,
        itemName: message.flags?.dnd5e?.item?.name
      });
      return;
    }
    log("trigger reason detected:", reason);

    const activeMate = BAND_MATES.find(m => bandMateReadFor(m, bandMateEnabledKey));
    if (!activeMate) {
      log("skip: no active mate found (anyBandMateOn was true but find returned null?)");
      return;
    }
    log("active mate:", activeMate.key);

    const triggerKey = bandMateTriggerSettingKey(activeMate.key, reason);
    const triggerValue = triggerKey ? bandMateGetFlag(triggerKey, true) : false;
    if (!triggerKey || !triggerValue) {
      log(`skip: trigger '${reason}' disabled for ${activeMate.key} (setting ${triggerKey}=${triggerValue})`);
      return;
    }

    if (game.user.isGM) {
      // GM testing mode only — fire when the GM has a token selected that
      // matches the message speaker. Band Mate is expected to be OFF for the
      // GM in normal play; this branch exists only for at-table diagnostics.
      const selectedActorIds = new Set(
        (canvas?.tokens?.controlled ?? []).map(t => t.actor?.id).filter(Boolean)
      );
      if (selectedActorIds.size === 0) {
        log("skip (GM branch): no token selected");
        return;
      }
      const speakerActorId = message.speaker?.actor;
      if (!speakerActorId || !selectedActorIds.has(speakerActorId)) {
        log("skip (GM branch): speaker actor not among selected tokens", { speakerActorId, selectedActorIds: [...selectedActorIds] });
        return;
      }
    } else {
      // Player mode: fire when the acting actor is owned by THIS user. This
      // covers their PC, companions, summons, and any other actor they own —
      // regardless of who initiated the action (e.g. GM rolling on their
      // behalf).
      const speakerActor = ChatMessage.getSpeakerActor?.(message.speaker)
                        ?? game.actors.get(message.speaker?.actor);
      if (!speakerActor) {
        log("skip (player branch): no speaker actor resolved from message", { speaker: message.speaker });
        return;
      }
      const ownerLevel = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
      const testFn = speakerActor.testUserPermission?.bind(speakerActor);
      const isOwner = testFn
        ? testFn(game.user, ownerLevel)
        : (speakerActor.getUserLevel?.(game.user) ?? 0) >= ownerLevel;
      if (!isOwner) {
        log("skip (player branch): speaker actor not owned by this user", {
          actorName: speakerActor.name, actorId: speakerActor.id, userId: game.user.id
        });
        return;
      }
    }

    const token = getBandMateActingToken(message);
    log("FIRING cue", { mate: activeMate.key, reason, tokenId: token?.id ?? token?.document?.id });
    playBandMateCue(token);
  });

  // On combat end, sweep any Help effects that have no instigator (they'd
  // otherwise stick around forever until someone manually clears them).
  // Effects WITH an instigator are handled per-turn by the updateCombat hook.
  // Marker-only variants (autoExpire=false) opt out entirely — they persist
  // until manually cleared.
  Hooks.on("deleteCombat", async (combat) => {
    if (!game.user.isGM) return;
    for (const combatant of combat.combatants) {
      const actor = combatant.actor;
      if (!actor) continue;
      for (const effect of (actor.effects ?? [])) {
        const variant = getVariantByEffectName(effect.name);
        if (!variant || !variant.autoExpire) continue;
        if (effect.getFlag(MODULE_ID, "instigatorUuid")) continue;
        safeDeleteEffect(actor, effect);
      }
    }
  });

  Hooks.on("updateCombat", async (combat, changed) => {
    if (!("turn" in changed) && !("round" in changed)) return;

    const autoClear = game.settings.get(MODULE_ID, "autoClearOnTurnStart");
    if (!autoClear) return;

    const current = combat.combatant;
    if (!current?.actor) return;
    const currentUuid = current.actor.uuid;

    // Find every combatant whose Help effect was applied BY the current
    // combatant (they took the Help action; effect expires at start of their
    // next turn). Legacy effects lacking an instigator flag fall back to
    // being kept until manual clear.
    for (const combatant of combat.combatants) {
      const actor = combatant.actor;
      if (!actor) continue;

      for (const effect of (actor.effects ?? [])) {
        const variant = getVariantByEffectName(effect.name);
        if (!variant || !variant.autoExpire) continue;

        const instigatorUuid = effect.getFlag(MODULE_ID, "instigatorUuid");
        // No instigator → the effect was applied manually (e.g. via the token
        // HUD condition palette). It must be cleared manually.
        if (!instigatorUuid) continue;
        if (instigatorUuid !== currentUuid) continue;

        const token = combatant.token?.object ?? actor.getActiveTokens()[0];
        const cues = effect.getFlag(MODULE_ID, "cues");

        const broadcastMode = game.settings.get(MODULE_ID, "broadcastCues");
        if (broadcastMode) {
          const broadcasterId = findInstigatorUser(instigatorUuid)?.id;
          if (broadcasterId) playCue("expire", token, { broadcastFromUserId: broadcasterId, overrides: cues });
        } else {
          playCue("expire", token, { overrides: cues });
        }

        safeDeleteEffect(actor, effect);
      }
    }
  });

  // Ensure every variant's macro + item exists. Wraps each call in try/catch
  // so one variant's failure doesn't abort the rest.
  async function ensureAll() {
    if (!game.user.isGM) return;
    for (const variant of Object.values(VARIANTS)) {
      try {
        await ensureMacro(variant);
      } catch (e) {
        console.error(`${MODULE_ID} | ensureMacro(${variant.key}) threw:`, e);
      }
    }
    for (const variant of Object.values(VARIANTS)) {
      try {
        await ensureItem(variant);
      } catch (e) {
        console.error(`${MODULE_ID} | ensureItem(${variant.key}) threw:`, e);
      }
    }
    try { await cleanupLegacyBandMateMacros(); }
    catch (e) { console.error(`${MODULE_ID} | cleanupLegacyBandMateMacros threw:`, e); }

    for (const user of game.users) {
      try {
        await ensureBandMateMacro(user);
      } catch (e) {
        console.error(`${MODULE_ID} | ensureBandMateMacro(${user.name}) threw:`, e);
      }
    }
  }

  // Late-join safety net: if a user logs in after the GM's ready sweep ran,
  // give them their single Band Mate macro on the fly.
  Hooks.on("userConnected", (user, connected) => {
    if (!game.user.isGM || !connected) return;
    ensureBandMateMacro(user)
      .catch(e => console.warn(`${MODULE_ID} | userConnected ensureBandMateMacro failed:`, e));
  });

  game.modules.get(MODULE_ID).api = {
    apply: requestApply,
    applyToCurrentTargets,
    ensureMacro,
    ensureItem,
    ensureAll,
    toggleBandMate,
    setUserSelectedMate,
    turnOffAllBandMates,
    openBandMateConfigDialog,
    openSoundBoard,
    openSoundBoardFromData,
    openSoundBoardSetup,
    stopAllSoundBoardSounds,
    bandMates: BAND_MATES,
    variants: VARIANTS
  };

  ensureAll();

  // One-time per-user sweep of orphaned per-board volume flags left over from
  // earlier sound-board versions. Cheap no-op if the user has none.
  _cleanupLegacyBoardVolumeFlags()
    .catch(e => console.warn(`${MODULE_ID} | legacy board-volume cleanup failed:`, e));

  // Trigger the apply flow when a "Help" item is used from a sheet. Reads
  // the variant from the item's flag. Debounced to avoid firing twice if
  // both use-hooks fire for the same use.
  let lastHelpItemTrigger = 0;
  const tryTriggerFromItem = (item) => {
    const variant = variantForItem(item);
    if (!variant) return;
    const now = Date.now();
    if (now - lastHelpItemTrigger < 500) return;
    lastHelpItemTrigger = now;
    applyToCurrentTargets(variant.key);
  };

  // Chat-card apply-button in the item description. Click reads the item's
  // actor from the chat message and uses it as the instigator, so players
  // don't need to have their token selected. The button's data-variant
  // tells us which flavor of Help to apply. Hidden entirely from clients
  // that don't own the acting actor (GM always sees it).
  Hooks.on("renderChatMessage", (message, html) => {
    const $links = html.find?.(".jhs-apply-from-card")
                ?? (html[0]?.querySelectorAll?.(".jhs-apply-from-card") ?? []);
    const nodes = ("length" in $links) ? Array.from($links) : [$links];
    if (nodes.length === 0) return;

    let actor = null;
    const itemUuid = message.flags?.dnd5e?.item?.uuid;
    const actorPart = itemUuid?.match(/^Actor\.[A-Za-z0-9]+/)?.[0];
    if (actorPart) actor = fromUuidSync(actorPart);
    if (!actor) {
      actor = ChatMessage.getSpeakerActor?.(message.speaker)
           ?? game.actors.get(message.speaker?.actor);
    }

    const canUse = game.user.isGM || actor?.isOwner;

    for (const el of nodes) {
      if (!el) continue;
      if (!canUse) {
        el.style.display = "none";
        continue;
      }
      if (el.dataset.jhsBound) continue;
      el.dataset.jhsBound = "1";
      el.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const variantKey = el.dataset.variant ?? DEFAULT_VARIANT_KEY;
        applyToCurrentTargets(variantKey, actor);
      });
    }
  });

  if (typeof Sequencer !== "undefined" && Sequencer.Database) {
    registerSounds();
  } else {
    Hooks.once("sequencer.ready", () => registerSounds());
  }

  console.log(`${MODULE_ID} | ready`);
});
