export const TUTORIAL_STATE = {
  DIM1: 0,
  DIM2: 1,
  TICKSPEED: 2,
  DIMBOOST: 3,
  GALAXY: 4,
  AUTOMATOR: 5
};

// Tutorial has two ways of moving on, either by Tutorial.moveOn() or by having it's condition be true
const tutorialStates = [
  {
    // Highlight the 1st dim button
    id: TUTORIAL_STATE.DIM1,
    condition: () => true
  },
  {
    // Highlight the 2nd dim button
    id: TUTORIAL_STATE.DIM2,
    condition: () => Currency.antimatter.gte(100)
  },
  {
    id: TUTORIAL_STATE.TICKSPEED,
    condition: () => AntimatterDimension(2).bought > 0
  },
  {
    id: TUTORIAL_STATE.DIMBOOST,
    condition: () => AntimatterDimension(4).amount.gte(20)
  },
  {
    id: TUTORIAL_STATE.GALAXY,
    condition: () => AntimatterDimension(8).amount.gte(80)
  },
  {
    id: TUTORIAL_STATE.AUTOMATOR,
    condition: () => Player.automatorUnlocked
  }
];

export const Tutorial = {

  isActive(atState) {
    return ui.view.tutorialState === atState && ui.view.tutorialActive;
  },

  // Turns off the visual effect
  turnOffEffect(fromState) {
    if (fromState !== player.tutorialState) return;
    player.tutorialActive = false;
    ui.view.tutorialActive = false;
    // Check if we can immediately enter next tutorial state. This is needed
    // to correctly handle buying dimension 2 + tickspeed in the same tick,
    // for example.
    this.tutorialLoop();
  },

  // Moves on to the next tutorialState, but only if parameter is current state.
  moveOn(fromState) {
    if (fromState !== player.tutorialState) return;
    player.tutorialState++;
    ui.view.tutorialState++;
    player.tutorialActive = true;
    ui.view.tutorialActive = true;
  },

  tutorialLoop() {
    const nextState = tutorialStates.find(o => o.id === player.tutorialState + 1);
    if (nextState && nextState.condition()) this.moveOn(player.tutorialState);
  }
};
