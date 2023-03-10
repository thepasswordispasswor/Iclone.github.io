import * as ADNotations from "@antimatter-dimensions/notations";

import { DEV } from "../devtools";

import { deepmergeAll } from "@/utility/deepmerge";

export const GameStorage = {
  currentSlot: 0,
  saves: {
    0: undefined,
    1: undefined,
    2: undefined
  },
  saved: 0,
  lastSaveTime: Date.now(),
  lastCloudSave: Date.now(),
  offlineEnabled: undefined,
  offlineTicks: undefined,

  maxOfflineTicks(simulatedMs, defaultTicks = this.offlineTicks) {
    return Math.clampMax(defaultTicks, Math.floor(simulatedMs / 50));
  },

  get localStorageKey() {
    return DEV ? "dimensionTestSave" : "dimensionSave";
  },

  load() {
    const save = localStorage.getItem(this.localStorageKey);
    const root = GameSaveSerializer.deserialize(save);

    this.loadRoot(root);
  },

  loadRoot(root) {
    if (root === undefined) {
      this.currentSlot = 0;
      this.loadPlayerObject(Player.defaultStart);
      return;
    }

    if (root.saves === undefined) {
      // Migrate old format
      this.saves = {
        0: root,
        1: undefined,
        2: undefined
      };
      this.currentSlot = 0;
      this.loadPlayerObject(root);
      this.save(true);
      return;
    }

    this.saves = root.saves;
    this.currentSlot = root.current;
    this.loadPlayerObject(this.saves[this.currentSlot]);
  },

  loadSlot(slot) {
    this.currentSlot = slot;
    // Save current slot to make sure no changes are lost
    this.save(true);
    this.loadPlayerObject(this.saves[slot] ?? Player.defaultStart);
    Tabs.all.find(t => t.id === player.options.lastOpenTab).show(true);
    Cloud.resetTempState();
    GameUI.notify.info("Game loaded");
  },

  import(saveData) {
    if (tryImportSecret(saveData) || Theme.tryUnlock(saveData)) {
      return;
    }
    const player = GameSaveSerializer.deserialize(saveData);
    if (this.checkPlayerObject(player) !== "") {
      Modal.message.show("Could not load the save (format unrecognized or invalid).");
      return;
    }
    Modal.hideAll();
    Quote.clearAll();
    AutomatorBackend.clearEditor();
    this.loadPlayerObject(player);
    GlyphAppearanceHandler.clearInvalidCosmetics();
    if (player.speedrun?.isActive) Speedrun.setSegmented(true);
    this.save(true);
    Cloud.resetTempState();

    // This is to fix a very specific exploit: When the game is ending, some tabs get hidden
    // The options tab is the first one of those, which makes the player redirect to the Pelle tab
    // You can doom your reality even if you haven't unlocked infinity yet if you import while the Pelle tab
    // is showing
    Tab.options.subtabs[0].show();
    GameUI.notify.info("Game imported");
  },

  importAsFile() {
    if (GameEnd.creditsEverClosed) return;
    const reader = new FileReader();
    const text = reader.readAsText(file);
    this.import(text);
  },

  overwriteSlot(slot, saveData) {
    this.saves[slot] = saveData;
    if (slot === this.currentSlot) {
      this.loadPlayerObject(saveData);
    }

    this.save(true);
  },

  // Some minimal save verification; if the save is valid then this returns an empty string, otherwise it returns a
  // a string roughly stating what's wrong with the save. In order for importing to work properly, this must return
  // an empty string.
  checkPlayerObject(save) {
    // Sometimes save is the output of GameSaveSerializer.deserialize, and if that function fails then it will result
    // in the input parameter here being undefined
    if (save === undefined || save === null) return "Save decoding failed (invalid format)";
    // Right now all we do is check for the existence of an antimatter prop, but if we wanted to do further save
    // verification then here's where we'd do it
    if (save.money === undefined && save.antimatter === undefined) return "Save does not have antimatter property";

    // Recursively check for any NaN props and add any we find to an array
    const invalidProps = [];
    function checkNaN(obj, path) {
      let hasNaN = false;
      for (const key in obj) {
        const prop = obj[key];
        let thisNaN;
        switch (typeof prop) {
          case "object":
            thisNaN = checkNaN(prop, `${path}.${key}`);
            hasNaN = hasNaN || thisNaN;
            break;
          case "number":
            thisNaN = Number.isNaN(prop);
            hasNaN = hasNaN || thisNaN;
            if (thisNaN) invalidProps.push(`${path}.${key}`);
            break;
          case "string":
            // If we're attempting to import, all NaN entries will still be strings
            thisNaN = prop === "NaN";
            hasNaN = hasNaN || thisNaN;
            if (thisNaN) invalidProps.push(`${path}.${key}`);
            break;
        }
      }
      return hasNaN;
    }
    checkNaN(save, "player");

    if (invalidProps.length === 0) return "";
    return `${quantify("NaN player property", invalidProps.length)} found:
      ${invalidProps.join(", ")}`;
  },

  save(silent = true, manual = false) {
    if (GameEnd.endState >= END_STATE_MARKERS.SAVE_DISABLED && !GameEnd.removeAdditionalEnd) return;
    if (GameEnd.endState >= END_STATE_MARKERS.INTERACTIVITY_DISABLED) return;
    if (GlyphSelection.active || ui.$viewModel.modal.progressBar !== undefined) return;
    this.lastSaveTime = Date.now();
    GameIntervals.save.restart();
    if (manual && ++this.saved > 99) SecretAchievement(12).unlock();
    const root = {
      current: this.currentSlot,
      saves: this.saves
    };
    localStorage.setItem(this.localStorageKey, GameSaveSerializer.serialize(root));
    if (!silent) GameUI.notify.info("Game saved");
  },

  export() {
    copyToClipboard(this.exportModifiedSave());
    GameUI.notify.info("Exported current savefile to your clipboard");
  },

  exportAsFile() {
    player.options.exportedFileCount++;
    this.save(true);
    const saveFileName = player.options.saveFileName ? ` - ${player.options.saveFileName},` : "";
    const dateObj = new Date();
    const y = dateObj.getFullYear();
    const m = dateObj.getMonth() + 1;
    const d = dateObj.getDate();
    const save = this.exportModifiedSave();
    download(
      `AD Save, Slot ${GameStorage.currentSlot + 1}${saveFileName} #${player.options.exportedFileCount} \
(${y}-${m}-${d}).txt`, save);
    GameUI.notify.info("Successfully downloaded current save file to your computer");
  },

  // There are a couple props which may need to export with different values, so we handle that here
  exportModifiedSave() {
    // Speedrun segmented is exported as true
    const segmented = player.speedrun.isSegmented;
    Speedrun.setSegmented(true);

    // Serialize the altered data, then restore the old prop values afterwards and return
    const save = GameSaveSerializer.serialize(player);
    Speedrun.setSegmented(segmented);
    return save;
  },

  hardReset() {
    this.loadPlayerObject(Player.defaultStart);
    this.save(true);
    Tab.dimensions.antimatter.show();
    Cloud.resetTempState();
  },

  loadPlayerObject(playerObject) {
    this.saved = 0;

    const checkString = this.checkPlayerObject(playerObject);
    if (playerObject === Player.defaultStart || checkString !== "") {
      if (DEV && checkString !== "") {
        // eslint-disable-next-line no-console
        console.log(`Savefile was invalid and has been reset - ${checkString}`);
      }
      player = deepmergeAll([{}, Player.defaultStart]);
      player.records.gameCreatedTime = Date.now();
      player.lastUpdate = Date.now();
      if (DEV) {
        this.devMigrations.setLatestTestVersion(player);
      }
    } else {
      const isPreviousVersionSave = playerObject.version < 13;
      player = this.migrations.patch(playerObject);
      if (isPreviousVersionSave) {
        // Needed to check some notification about reality unlock study.
        EventHub.dispatch(GAME_EVENT.SAVE_CONVERTED_FROM_PREVIOUS_VERSION);
      }
      if (DEV && player.options.testVersion !== undefined) {
        this.devMigrations.patch(player);
      }
    }

    this.saves[this.currentSlot] = player;

    if (DEV) {
      guardFromNaNValues(player);
    }

    ui.view.news = player.options.news.enabled;
    ui.view.newUI = player.options.newUI;
    ui.view.tutorialState = player.tutorialState;
    ui.view.tutorialActive = player.tutorialActive;

    ECTimeStudyState.invalidateCachedRequirements();
    recalculateAllGlyphs();
    checkPerkValidity();
    V.updateTotalRunUnlocks();
    Enslaved.boostReality = false;
    GameEnd.additionalEnd = 0;
    Theme.set(Theme.currentName());
    Glyphs.unseen = [];
    Notations.find(player.options.notation).setAsCurrent(true);
    ADNotations.Settings.exponentCommas.show = player.options.commas;

    EventHub.dispatch(GAME_EVENT.GAME_LOAD);
    AutomatorBackend.initializeFromSave();
    Lazy.invalidateAll();

    const rawDiff = Date.now() - player.lastUpdate;
    // We set offlineEnabled externally on importing; otherwise this is just a local load
    const simulateOffline = this.offlineEnabled ?? player.options.offlineProgress;
    if (simulateOffline && !Speedrun.isPausedAtStart()) {
      let diff = rawDiff;
      player.speedrun.offlineTimeUsed += diff;
      if (diff > 5 * 60 * 1000 && player.celestials.enslaved.autoStoreReal) {
        diff = Enslaved.autoStoreRealTime(diff);
      }
      if (diff > 10000) {
        // The third parameter is a `fast` parameter that we use to only
        // simulate at most 50 ticks if the player was offline for less
        // than 50 seconds.
        simulateTime(diff / 1000, false, diff < 50 * 1000);
      } else {
        // This is ugly, should fix how we deal with it...
        this.postLoadStuff();
      }
    } else {
      // Try to unlock "Don't you dare sleep" (usually this check only happens
      // during a game tick, which makes the achievement impossible to get
      // with offline progress off)
      if (!Speedrun.isPausedAtStart()) Achievement(35).tryUnlock();
      player.lastUpdate = Date.now();
      this.postLoadStuff();
    }

    // 2-week threshold for showing the catchup modal. We want to show this even if offline progress is disabled
    // because its presence and usefulness is tied to what the player experiences, not the game. setTimeout seems to be
    // the only way to get this to display, as it won't display even if called after init() entirely nor is it getting
    // actively hidden by Modal.hideAll(), so delaying it asynchronously gets past whatever is causing it to not appear.
    // Delay time is relatively long to make it more likely to work on much slower computers.
    if (rawDiff > 1000 * 86400 * 14) {
      if (["S4", "S9"].includes(Theme.current().name)) Theme.set("Normal");
      // Looks like the game takes too long to load so we need to setTimeout else it doesn't check for the notation.
      setTimeout(() => {
        if (Notations.current.isPainful) Notation.mixedScientific.setAsCurrent();
      }, 2500);
      setTimeout(() => Modal.catchup.show(rawDiff), 5000);
    }
  },
  postLoadStuff() {
    // This is called from simulateTime, if that's called; otherwise, it gets called
    // manually above
    GameIntervals.restart();
    Enslaved.nextTickDiff = player.options.updateRate;
    GameUI.update();

    for (const resource of AlchemyResources.all) {
      resource.before = resource.amount;
    }
  }
};

function download(filename, text) {
  const pom = document.createElement("a");
  pom.setAttribute("href", `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`);
  pom.setAttribute("download", filename);

  if (document.createEvent) {
    const event = document.createEvent("MouseEvents");
    event.initEvent("click", true, true);
    pom.dispatchEvent(event);
  } else {
    pom.click();
  }
}
