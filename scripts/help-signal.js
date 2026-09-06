const MODULE_ID   = "joetastic-help-signal";
const SOCKET      = `module.${MODULE_ID}`;

// Cues that get baked into the effect and travel via socket. The apply
// cue is played immediately/locally from the macro on the instigator's
// client, so it isn't included here.
const CUE_KEYS = [
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
      `<p><em>Marker-only status.</em></p>
       <p>Target one or more creatures, then click Apply Help-Ability.</p>
       <p>Applies the Help-Ability status effect for tracking. Does not auto-expire or listen for rolls — clear it manually when done.</p>`,
    // Marker-only: no roll type triggers, no auto-expire.
    rollTypes: [],
    matchScope: "speaker",
    triggerMode: null,
    autoExpire: false
  }
};

const DEFAULT_VARIANT_KEY = "attack";

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
    ui.notifications.info(`Applied "${variant.effectName}" to ${uuids.length} target(s).`);
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
  ui.notifications.info(`Requested ${variant.effectName} for ${uuids.length} target(s).`);
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

  // Play the apply cue once, broadcast to everyone, before the socket round-trip.
  // One sound total; animation plays on each target token so multiple applies
  // in the same click all get a visual, but only a single sound plays.
  playApplyCueGlobal(targets);

  return requestApply(uuids, game.user.name, variant.key, instigatorActor?.uuid ?? null, getLocalCueConfig());
}

// Broadcasts the apply sound + animation from THIS client. Called from the
// macro entry point, once per macro click regardless of target count.
function playApplyCueGlobal(tokens) {
  if (typeof Sequence === "undefined") return;
  const rawSound = game.settings.get(MODULE_ID, "applySound");
  const rawAnim  = game.settings.get(MODULE_ID, "applyAnimation");
  const soundPath = resolveDbPath(rawSound);
  const animPath  = rawAnim;

  const seq = new Sequence();
  let hasContent = false;
  if (soundPath) {
    seq.sound().file(soundPath).volume(0.8);
    hasContent = true;
  }
  if (animPath) {
    for (const token of tokens) {
      if (!token) continue;
      seq.effect().file(animPath).atLocation(token).scaleToObject(1.5);
      hasContent = true;
    }
  }
  if (hasContent) seq.play();
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

  console.log(`${MODULE_ID} | cue "${kind}" broadcast=${broadcasting} → sound="${rawSound}" → resolved="${soundPath}" | anim="${animPath}"`);

  if (typeof Sequence !== "undefined") {
    const seq = new Sequence();
    let hasContent = false;
    if (soundPath) {
      const s = seq.sound().file(soundPath).volume(0.8);
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
      { src: soundPath, volume: 0.8, autoplay: true, loop: false },
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
    areyougonnabemygirl: `modules/${MODULE_ID}/Sounds/GuitarOpenings/areyougonnabemygirl.mp3`,
    boomboom:            `modules/${MODULE_ID}/Sounds/GuitarOpenings/boomboom.mp3`,
    sevennationarmy:     `modules/${MODULE_ID}/Sounds/GuitarOpenings/sevennationarmy.mp3`,
    snow:                `modules/${MODULE_ID}/Sounds/GuitarOpenings/snow.mp3`,
    walktheline:         `modules/${MODULE_ID}/Sounds/GuitarOpenings/WalkTheLine.mp3`
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
    console.log(`${MODULE_ID} | Sounds/ scan enrichment found ${scanned.length} file(s):`, scanned);
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
  } else {
    console.log(`${MODULE_ID} | scan enrichment returned 0 (FilePicker restricted); using hardcoded entries only.`);
  }

  try {
    Sequencer.Database.registerEntries(MODULE_ID, entries);
    console.log(`${MODULE_ID} | registered sound entries with Sequencer under "${MODULE_ID}.*"`, entries);
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
      console.log(`${MODULE_ID} | preloaded ${preloadPaths.length} apply-cue default file(s)`);
    } catch (e) {
      console.warn(`${MODULE_ID} | apply-cue preload failed:`, e);
    }
  }
}

// Create/refresh the per-variant macro. Idempotent: existing macros are
// updated in place so name/icon/command changes flow through on reload.
async function ensureMacro(variant) {
  if (!game.user.isGM) return null;
  const expectedCommand =
    `game.modules.get("${MODULE_ID}").api.applyToCurrentTargets(${JSON.stringify(variant.key)});`;

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
      console.log(`${MODULE_ID} | dragstart`, payload);
    });
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
});

Hooks.once("ready", () => {
  game.socket.on(SOCKET, async (data) => {
    if (!game.user.isGM) return;

    if (data?.action === "apply") {
      const variant = getVariant(data.variantKey);
      await applyToActorUuids(data.actorUuids ?? [], variant.key, data.instigatorUuid ?? null, data.cues ?? null);
      ui.notifications.info(
        `Applied "${variant.effectName}" to ${data.actorUuids.length} target(s) at ${data.requester}'s request.`
      );
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

    console.log(`${MODULE_ID} | palette add-when-exists (${variant.key}) → converting to delete`);
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
  // are cached and ready. The apply cue is fired directly from the macro
  // (playApplyCueGlobal), not from this hook.
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
      .then(() => console.log(`${MODULE_ID} | preloaded ${paths.length} baked cue file(s) for effect ${effect.id}`))
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
        playCue("attack", token, { broadcastFromUserId: broadcasterId, overrides: cues });
      } else {
        playCue("reminder", token, { animKind: "attack", broadcastFromUserId: broadcasterId, overrides: cues });
      }

      safeDeleteEffect(actor, effect);
    }
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
        console.log(`${MODULE_ID} | combat ended → clearing instigator-less ${effect.name} from ${actor.name}`);
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
  // so one variant's failure doesn't abort the rest, and logs progress so
  // the browser console shows why anything is missing.
  async function ensureAll() {
    if (!game.user.isGM) {
      console.log(`${MODULE_ID} | ensureAll skipped — not GM`);
      return;
    }
    for (const variant of Object.values(VARIANTS)) {
      try {
        const macro = await ensureMacro(variant);
        console.log(`${MODULE_ID} | ensureMacro(${variant.key}) →`, macro?.name ?? "(none)");
      } catch (e) {
        console.error(`${MODULE_ID} | ensureMacro(${variant.key}) threw:`, e);
      }
    }
    for (const variant of Object.values(VARIANTS)) {
      try {
        const item = await ensureItem(variant);
        console.log(`${MODULE_ID} | ensureItem(${variant.key}) →`, item?.name ?? "(none)");
      } catch (e) {
        console.error(`${MODULE_ID} | ensureItem(${variant.key}) threw:`, e);
      }
    }
  }

  game.modules.get(MODULE_ID).api = {
    apply: requestApply,
    applyToCurrentTargets,
    ensureMacro,
    ensureItem,
    ensureAll,
    variants: VARIANTS
  };

  ensureAll();

  // Trigger the apply flow when a "Help" item is used from a sheet. Reads
  // the variant from the item's flag. Debounced to avoid firing twice if
  // both use-hooks fire for the same use.
  let lastHelpItemTrigger = 0;
  const tryTriggerFromItem = (item, source) => {
    const variant = variantForItem(item);
    if (!variant) return;
    const now = Date.now();
    if (now - lastHelpItemTrigger < 500) return;
    lastHelpItemTrigger = now;
    console.log(`${MODULE_ID} | ${variant.itemName} used (${source}) → triggering apply`);
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
