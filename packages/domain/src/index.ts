export * from "./adventure-module";
export * from "./advancement";
export * from "./table-run";

export type PlayerId = `player-${string}`;
export type CharacterId = `character-${string}`;
export type LocationId = `location-${string}`;
export type FactionId = `faction-${string}`;
export type HookId = `hook-${string}`;
export type StoreId = `store-${string}`;
export type ItemId = `item-${string}`;
export type EventId = `event-${string}`;
export type RollId = `roll-${string}`;

export type AbilityName = "strength" | "intelligence" | "wisdom" | "dexterity" | "constitution" | "charisma";
export type AbilityScores = Record<AbilityName, number>;
export type OseClass = "fighter" | "cleric" | "magic-user" | "thief" | "dwarf" | "elf" | "halfling";
export type CampaignWatch = "morning" | "afternoon" | "evening" | "night";

export type Player = {
  id: PlayerId;
  name: string;
  personality: string;
};

export type Character = {
  id: CharacterId;
  playerId: PlayerId;
  name: string;
  stats: {
    hp: number;
    armorClass: number;
  };
  inventory: string[];
  knowledge: string[];
  locationId?: LocationId;
  abilities?: AbilityScores;
  className?: OseClass;
  level?: number;
  xp?: number;
  goldGp?: number;
  alignment?: "lawful" | "neutral" | "chaotic";
  deity?: string;
  reasonExceptional?: string;
  supplies?: {
    rationDays: number;
  };
  creationSource?: "kimi" | "repaired_kimi" | "unknown";
};

export type Location = {
  id: LocationId;
  name: string;
  kind: "urban_hub" | "rural_town" | "wilderness" | "adventure_site" | "tavern";
  publicDescription: string;
  exits: LocationId[];
};

export type Faction = {
  id: FactionId;
  name: string;
  publicGoal: string;
  hiddenAgenda: string;
  clock: number;
  clockMax: number;
};

export type AdventureHook = {
  id: HookId;
  title: string;
  locationId: LocationId;
  publicSummary: string;
  rumoredReward: string;
  danger: "low" | "medium" | "high";
  factionIds: FactionId[];
  status: "available" | "pursued" | "resolved";
};

export type AdventureChoice = {
  playerId: PlayerId;
  hookId: HookId;
  approach: "cautious" | "bold" | "social" | "stealthy" | "mystic" | "other";
  tableSpeech?: string;
  innerMonologue?: string;
  goal?: string;
  fear?: string;
  reason?: string;
};

export type StoreItem = {
  id: ItemId;
  name: string;
  category: "food" | "light" | "container" | "tool" | "weapon" | "armor" | "service" | "travel" | "holy";
  costGp: number;
  supplyDays?: number;
  armorClass?: number;
};

export type Store = {
  id: StoreId;
  name: string;
  kind: "tavern_inn" | "general_store" | "armorer_weaponsmith" | "stable_feed" | "temple_shrine" | "healer_apothecary" | "hireling_board" | "market_food";
  items: StoreItem[];
};

export type Purchase = {
  itemId: ItemId;
  quantity: number;
};

export type CharacterCreationDraft = {
  playerId: PlayerId;
  rawAbilities: AbilityScores;
  startingGoldGp: number;
};

export type CharacterCreationPlan = {
  playerId: PlayerId;
  name: string;
  className: OseClass;
  abilitySwap?: {
    first: AbilityName;
    second: AbilityName;
  };
  alignment: "lawful" | "neutral" | "chaotic";
  deity?: string;
  reasonExceptional: string;
  purchases: Purchase[];
  innerMonologue?: string;
  goal?: string;
  fear?: string;
  planSource?: "kimi" | "repaired_kimi" | "unknown";
};

export type PublicEvent = {
  id: EventId;
  visibility: "public";
  kind: "scene_revealed" | "table_action" | "outcome" | "dice_roll" | "world_event" | "faction_clock" | "session_zero" | "player_choice" | "travel" | "referee_narration";
  text: string;
  actor?: CharacterId;
  createdAt: string;
};

export type RefereeAuditEvent = {
  id: EventId;
  visibility: "referee";
  kind: "character_creation" | "world_tick" | "adventure_choice" | "referee_reasoning";
  playerId?: PlayerId;
  characterId?: CharacterId;
  declaredAction?: string;
  refereeIntent?: string;
  note: string;
  createdAt: string;
};

export type DiceRoll = {
  id: RollId;
  actorId?: CharacterId;
  playerId?: PlayerId;
  formula: string;
  terms: number[];
  result: number;
  reason: string;
  visibility: "public" | "referee";
  createdAt: string;
};

export type RefereeOutcome = {
  publicNarration: string;
  pressure: string;
  nextQuestion: string;
  privateReasoning: string;
};

export type Campaign = {
  id: string;
  status: "seeded" | "session_zero" | "tavern_start" | "awaiting_player_intent" | "resolving" | "round_committed";
  time: {
    day: number;
    watch: CampaignWatch;
  };
  players: Record<PlayerId, Player>;
  characters: Record<CharacterId, Character>;
  world: {
    startingLocationId: LocationId;
    locations: Record<LocationId, Location>;
  };
  factions: Record<FactionId, Faction>;
  hooks: Record<HookId, AdventureHook>;
  party: {
    currentLocationId: LocationId;
    chosenHookId?: HookId;
    destinationId?: LocationId;
  };
  stores: Record<StoreId, Store>;
  publicEvents: PublicEvent[];
  refereeAuditEvents: RefereeAuditEvent[];
  diceLedger: DiceRoll[];
};

export type RandomInt = (sides: number) => number;

let idCounter = 0;

function nextId<TPrefix extends string>(prefix: TPrefix): `${TPrefix}-${string}` {
  idCounter += 1;
  return `${prefix}-${idCounter.toString().padStart(4, "0")}`;
}

function now(): string {
  return new Date(0).toISOString();
}

function event(text: string, kind: PublicEvent["kind"], actor?: CharacterId): PublicEvent {
  return {
    id: nextId("event"),
    visibility: "public",
    kind,
    text,
    ...(actor ? { actor } : {}),
    createdAt: now()
  };
}

function audit(note: string, data: Omit<RefereeAuditEvent, "id" | "visibility" | "createdAt" | "note">): RefereeAuditEvent {
  return {
    id: nextId("event"),
    visibility: "referee",
    note,
    ...data,
    createdAt: now()
  };
}

function emptyWorld(): Campaign["world"] {
  const tavern: Location = {
    id: "location-golden-eel-tavern",
    name: "The Golden Eel Tavern",
    kind: "tavern",
    publicDescription: "A smoky dockside tavern where hungry adventurers hear rumors before they earn glory.",
    exits: ["location-archmarket", "location-willowby", "location-blackfen-road"]
  };
  const urbanHub: Location = {
    id: "location-archmarket",
    name: "Archmarket",
    kind: "urban_hub",
    publicDescription: "A walled river city with guild courts, bell towers, hungry merchants, and too many locked cellars.",
    exits: [tavern.id, "location-willowby", "location-stagmere"]
  };
  const ruralTownA: Location = {
    id: "location-willowby",
    name: "Willowby",
    kind: "rural_town",
    publicDescription: "A sheep town where the wells taste of iron and the reeve pays quietly for monster news.",
    exits: [tavern.id, urbanHub.id, "location-moss-crowned-door"]
  };
  const ruralTownB: Location = {
    id: "location-stagmere",
    name: "Stagmere",
    kind: "rural_town",
    publicDescription: "A peat-cutting village on the marsh edge, loyal to old saints and older fears.",
    exits: [urbanHub.id, "location-blue-vault"]
  };
  const wilderness: Location = {
    id: "location-blackfen-road",
    name: "The Blackfen Road",
    kind: "wilderness",
    publicDescription: "A rutted trade road between black reeds, lonely shrines, and wolf-haunted copses.",
    exits: [tavern.id, "location-sunken-shrine", ruralTownB.id]
  };
  const siteA: Location = {
    id: "location-moss-crowned-door",
    name: "The Moss-Crowned Door",
    kind: "adventure_site",
    publicDescription: "A tilted stone door in a hill north of Willowby. Damp air leaks out after sunset.",
    exits: [ruralTownA.id]
  };
  const siteB: Location = {
    id: "location-sunken-shrine",
    name: "The Sunken Shrine",
    kind: "adventure_site",
    publicDescription: "A half-drowned shrine said to ring its bell underwater when the dead get restless.",
    exits: [wilderness.id]
  };
  const siteC: Location = {
    id: "location-blue-vault",
    name: "The Blue-Tiled Vault",
    kind: "adventure_site",
    publicDescription: "A sealed tilework vault beneath Stagmere's abandoned bathhouse.",
    exits: [ruralTownB.id]
  };

  return {
    startingLocationId: tavern.id,
    locations: {
      [tavern.id]: tavern,
      [urbanHub.id]: urbanHub,
      [ruralTownA.id]: ruralTownA,
      [ruralTownB.id]: ruralTownB,
      [wilderness.id]: wilderness,
      [siteA.id]: siteA,
      [siteB.id]: siteB,
      [siteC.id]: siteC
    }
  };
}

function startingFactions(): Record<FactionId, Faction> {
  return {
    "faction-ash-cobra-cult": {
      id: "faction-ash-cobra-cult",
      name: "Ash-Cobra Cult",
      publicGoal: "Seek relics and omen-sites tied to a sleeping serpent saint.",
      hiddenAgenda: "Wake the ash-cobra below the Blue-Tiled Vault before the next dark moon.",
      clock: 1,
      clockMax: 6
    },
    "faction-river-guild": {
      id: "faction-river-guild",
      name: "River Guild Factors",
      publicGoal: "Keep Archmarket trade safe and profitable.",
      hiddenAgenda: "Monopolize salvage rights before villagers learn what the shrine contains.",
      clock: 0,
      clockMax: 6
    },
    "faction-stagmere-saints": {
      id: "faction-stagmere-saints",
      name: "Old Saints of Stagmere",
      publicGoal: "Protect marsh villages from curses, snakes, and hungry nobles.",
      hiddenAgenda: "Hide the saint-bell beneath Stagmere even if outsiders die looking for it.",
      clock: 2,
      clockMax: 6
    }
  };
}

function startingAdventureHooks(): Record<HookId, AdventureHook> {
  return {
    "hook-moss-crowned-door": {
      id: "hook-moss-crowned-door",
      title: "Copper-Sealed Door North of Willowby",
      locationId: "location-moss-crowned-door",
      publicSummary: "A shepherd saw green fire under a tilted stone door after rain. The Willowby reeve wants quiet help before panic spreads.",
      rumoredReward: "Reeve's purse, salvage rights, and first claim on lawful treasure.",
      danger: "medium",
      factionIds: ["faction-river-guild"],
      status: "available"
    },
    "hook-drowned-bell": {
      id: "hook-drowned-bell",
      title: "The Bell That Rings Underwater",
      locationId: "location-sunken-shrine",
      publicSummary: "Fishers swear a shrine bell rings beneath black water whenever something dead walks the reed beds.",
      rumoredReward: "Temple favor, village gratitude, and old shrine silver if recovered cleanly.",
      danger: "medium",
      factionIds: ["faction-stagmere-saints"],
      status: "available"
    },
    "hook-blue-tiled-vault": {
      id: "hook-blue-tiled-vault",
      title: "Blue Tiles Beneath Stagmere",
      locationId: "location-blue-vault",
      publicSummary: "A peat-cutter broke into blue tile under the abandoned bathhouse. Snake-charms appeared on three doors the next morning.",
      rumoredReward: "Vault coin, forbidden relics, and a name that travels faster than fear.",
      danger: "high",
      factionIds: ["faction-ash-cobra-cult"],
      status: "available"
    }
  };
}

export function startingTownStores(): Record<StoreId, Store> {
  const generalItems: StoreItem[] = [
    { id: "item-backpack", name: "Backpack", category: "container", costGp: 5 },
    { id: "item-rope-50", name: "Rope, 50 ft.", category: "tool", costGp: 1 },
    { id: "item-tinderbox", name: "Tinderbox", category: "tool", costGp: 3 },
    { id: "item-iron-spikes", name: "Iron spikes, bundle", category: "tool", costGp: 1 },
    { id: "item-ten-foot-pole", name: "10-foot pole", category: "tool", costGp: 1 },
    { id: "item-waterskin", name: "Waterskin", category: "travel", costGp: 1 }
  ];

  return {
    "store-golden-eel-inn": {
      id: "store-golden-eel-inn",
      name: "The Golden Eel Inn",
      kind: "tavern_inn",
      items: [
        { id: "item-common-meal", name: "Common meal", category: "food", costGp: 1, supplyDays: 1 },
        { id: "item-lodging-common", name: "Common room lodging", category: "service", costGp: 1 }
      ]
    },
    "store-bent-nail-general": {
      id: "store-bent-nail-general",
      name: "Bent Nail General Store",
      kind: "general_store",
      items: [
        ...generalItems,
        { id: "item-torches", name: "Torches, bundle", category: "light", costGp: 1 },
        { id: "item-lantern", name: "Lantern", category: "light", costGp: 10 },
        { id: "item-oil-flask", name: "Oil flask", category: "light", costGp: 2 }
      ]
    },
    "store-iron-bell-smithy": {
      id: "store-iron-bell-smithy",
      name: "Iron Bell Smithy",
      kind: "armorer_weaponsmith",
      items: [
        { id: "item-club", name: "Club", category: "weapon", costGp: 3 },
        { id: "item-dagger", name: "Dagger", category: "weapon", costGp: 3 },
        { id: "item-hand-axe", name: "Hand axe", category: "weapon", costGp: 4 },
        { id: "item-mace", name: "Mace", category: "weapon", costGp: 5 },
        { id: "item-spear", name: "Spear", category: "weapon", costGp: 3 },
        { id: "item-staff", name: "Staff", category: "weapon", costGp: 2 },
        { id: "item-short-sword", name: "Short sword", category: "weapon", costGp: 7 },
        { id: "item-sword", name: "Sword", category: "weapon", costGp: 10 },
        { id: "item-shortbow", name: "Short bow", category: "weapon", costGp: 25 },
        { id: "item-longbow", name: "Long bow", category: "weapon", costGp: 40 },
        { id: "item-arrows", name: "Arrows, quiver of 20", category: "weapon", costGp: 5 },
        { id: "item-sling", name: "Sling", category: "weapon", costGp: 2 },
        { id: "item-war-hammer", name: "War hammer", category: "weapon", costGp: 5 },
        { id: "item-shield", name: "Shield", category: "armor", costGp: 10, armorClass: 1 },
        { id: "item-leather-armor", name: "Leather armor", category: "armor", costGp: 20, armorClass: 12 },
        { id: "item-chain-mail", name: "Chain mail", category: "armor", costGp: 40, armorClass: 14 }
      ]
    },
    "store-stable-feed": {
      id: "store-stable-feed",
      name: "Gull's Stable and Feed",
      kind: "stable_feed",
      items: [
        { id: "item-mule-feed", name: "Mule feed", category: "travel", costGp: 1 },
        { id: "item-stabling", name: "Stabling", category: "service", costGp: 1 }
      ]
    },
    "store-temple-shrine": {
      id: "store-temple-shrine",
      name: "Shrine of the Seven Lanterns",
      kind: "temple_shrine",
      items: [
        { id: "item-holy-symbol", name: "Holy symbol", category: "holy", costGp: 25 },
        { id: "item-blessing", name: "Simple blessing", category: "service", costGp: 5 }
      ]
    },
    "store-healer-apothecary": {
      id: "store-healer-apothecary",
      name: "Mallow's Bitter Cabinet",
      kind: "healer_apothecary",
      items: [
        { id: "item-bandages", name: "Bandages and salve", category: "tool", costGp: 5 },
        { id: "item-healer-visit", name: "Healer visit", category: "service", costGp: 10 }
      ]
    },
    "store-hireling-board": {
      id: "store-hireling-board",
      name: "Eel Door Hireling Board",
      kind: "hireling_board",
      items: [{ id: "item-retainer-posting", name: "Retainer posting", category: "service", costGp: 1 }]
    },
    "store-market-food": {
      id: "store-market-food",
      name: "Old Archmarket Food Stalls",
      kind: "market_food",
      items: [
        { id: "item-rations-week", name: "Rations (standard, 7 days)", category: "food", costGp: 5, supplyDays: 7 },
        { id: "item-iron-rations-week", name: "Rations (iron, 7 days)", category: "food", costGp: 15, supplyDays: 7 }
      ]
    }
  };
}

export function seedTavernCampaign(id = "agent-dungeon-campaign"): Campaign {
  const world = emptyWorld();
  const players: Record<PlayerId, Player> = {
    "player-a": {
      id: "player-a",
      name: "Mara",
      personality: "Cautious, suspicious, and fond of testing surfaces before trusting them."
    },
    "player-b": {
      id: "player-b",
      name: "Tovin",
      personality: "Bold, chatty, and eager to impress the party with decisive action."
    }
  };

  return {
    id,
    status: "session_zero",
    time: { day: 1, watch: "evening" },
    players,
    characters: {},
    world,
    factions: startingFactions(),
    hooks: startingAdventureHooks(),
    party: { currentLocationId: world.startingLocationId },
    stores: startingTownStores(),
    publicEvents: [event("Session 0 begins in the Golden Eel Tavern. Hungry would-be adventurers gather under smoke-dark rafters to make names worth singing.", "session_zero")],
    refereeAuditEvents: [audit("Campaign seeded for autonomous tavern-start play.", { kind: "world_tick" })],
    diceLedger: []
  };
}

export function projectForMonitor(campaign: Campaign) {
  return {
    id: campaign.id,
    status: campaign.status,
    time: campaign.time,
    players: campaign.players,
    party: campaign.party,
    characters: Object.fromEntries(
      Object.entries(campaign.characters).map(([id, character]) => [
        id,
        {
          id: character.id,
          playerId: character.playerId,
          name: character.name,
          stats: character.stats,
          inventory: character.inventory,
          locationId: character.locationId,
          abilities: character.abilities,
          className: character.className,
          level: character.level,
          xp: character.xp,
          goldGp: character.goldGp,
          alignment: character.alignment,
          deity: character.deity,
          reasonExceptional: character.reasonExceptional,
          supplies: character.supplies,
          creationSource: character.creationSource
        }
      ])
    ),
    world: {
      startingLocationId: campaign.world.startingLocationId,
      locations: campaign.world.locations
    },
    factions: Object.fromEntries(
      Object.entries(campaign.factions).map(([id, faction]) => [
        id,
        {
          id: faction.id,
          name: faction.name,
          publicGoal: faction.publicGoal,
          clock: faction.clock,
          clockMax: faction.clockMax
        }
      ])
    ),
    hooks: campaign.hooks,
    stores: campaign.stores,
    publicEvents: campaign.publicEvents,
    diceLedger: campaign.diceLedger.filter((roll) => roll.visibility === "public")
  };
}

export function projectForDevMonitor(campaign: Campaign) {
  return {
    ...projectForMonitor(campaign),
    devMode: true,
    refereeAuditEvents: campaign.refereeAuditEvents
  };
}

export function commitRefereeOutcome(campaign: Campaign, outcome: RefereeOutcome): Campaign {
  const next = cloneCampaign(campaign);
  next.publicEvents.push(event(outcome.publicNarration, "referee_narration"));
  next.publicEvents.push(event(`Pressure: ${outcome.pressure}`, "outcome"));
  next.publicEvents.push(event(`Referee asks: ${outcome.nextQuestion}`, "outcome"));
  next.refereeAuditEvents.push(
    audit(outcome.privateReasoning, {
      kind: "referee_reasoning"
    })
  );
  return next;
}

export function commitAdventureChoice(campaign: Campaign, choices: AdventureChoice[]): Campaign {
  const next = cloneCampaign(campaign);
  const validChoices = choices.filter((choice) => next.players[choice.playerId] && next.hooks[choice.hookId]?.status !== "resolved");

  for (const choice of validChoices) {
    const hook = next.hooks[choice.hookId];
    if (!hook) continue;
    const character = Object.values(next.characters).find((candidate) => candidate.playerId === choice.playerId);
    const actorName = character?.name ?? next.players[choice.playerId]?.name ?? choice.playerId;
    if (choice.tableSpeech && character) {
      next.publicEvents.push(event(`${actorName}: “${choice.tableSpeech}”`, "table_action", character.id));
    }
    next.publicEvents.push(event(`${actorName} wants to pursue “${hook.title}” with a ${choice.approach} approach.`, "player_choice", character?.id));
    const privateChoiceNotes = [
      choice.reason ? `reason=${choice.reason}` : undefined,
      choice.goal ? `goal=${choice.goal}` : undefined,
      choice.fear ? `fear=${choice.fear}` : undefined,
      choice.innerMonologue ? `inner=${choice.innerMonologue}` : undefined
    ].filter(Boolean).join(" | ");
    next.refereeAuditEvents.push(
      audit(privateChoiceNotes || "Player chose an adventure hook.", {
        kind: "adventure_choice",
        playerId: choice.playerId,
        ...(character ? { characterId: character.id } : {})
      })
    );
  }

  if (validChoices.length === 0) {
    next.publicEvents.push(event("The tavern noise wins for now. No clear lead is chosen.", "outcome"));
    return next;
  }

  const chosenHookId = chooseHookByVote(validChoices);
  const chosenHook = next.hooks[chosenHookId];
  if (!chosenHook) return next;

  next.hooks[chosenHook.id] = { ...chosenHook, status: "pursued" };
  next.party = {
    ...next.party,
    chosenHookId: chosenHook.id,
    destinationId: chosenHook.locationId
  };
  next.status = "awaiting_player_intent";
  next.publicEvents.push(event(`The party commits to ${chosenHook.title}. The road now points toward ${next.world.locations[chosenHook.locationId]?.name ?? chosenHook.locationId}.`, "outcome"));

  for (const hook of Object.values(next.hooks)) {
    if (hook.id === chosenHook.id) continue;
    for (const factionId of hook.factionIds) {
      const faction = next.factions[factionId];
      if (!faction) continue;
      faction.clock = Math.min(faction.clockMax, faction.clock + 1);
      next.publicEvents.push(event(`While the party ignores “${hook.title}”, ${faction.name}'s clock advances to ${faction.clock}/${faction.clockMax}.`, "faction_clock"));
    }
  }

  return next;
}

function chooseHookByVote(choices: AdventureChoice[]): HookId {
  const counts = new Map<HookId, number>();
  for (const choice of choices) counts.set(choice.hookId, (counts.get(choice.hookId) ?? 0) + 1);
  let winner = choices[0]?.hookId;
  let winnerCount = winner ? counts.get(winner) ?? 0 : 0;
  for (const [hookId, count] of counts.entries()) {
    if (count > winnerCount) {
      winner = hookId;
      winnerCount = count;
    }
  }
  if (!winner) throw new Error("No adventure hook choice available");
  return winner;
}

export function rollCharacterCreationDraft(campaign: Campaign, playerId: PlayerId, randomInt: RandomInt): { campaign: Campaign; draft: CharacterCreationDraft } {
  if (!campaign.players[playerId]) throw new Error(`No player ${playerId}`);

  const next = cloneCampaign(campaign);
  const rawAbilities: AbilityScores = {
    strength: rollAndRecord(next, "3d6", randomInt, `Session 0 strength for ${playerId}`, "public", playerId).result,
    intelligence: rollAndRecord(next, "3d6", randomInt, `Session 0 intelligence for ${playerId}`, "public", playerId).result,
    wisdom: rollAndRecord(next, "3d6", randomInt, `Session 0 wisdom for ${playerId}`, "public", playerId).result,
    dexterity: rollAndRecord(next, "3d6", randomInt, `Session 0 dexterity for ${playerId}`, "public", playerId).result,
    constitution: rollAndRecord(next, "3d6", randomInt, `Session 0 constitution for ${playerId}`, "public", playerId).result,
    charisma: rollAndRecord(next, "3d6", randomInt, `Session 0 charisma for ${playerId}`, "public", playerId).result
  };
  const startingGoldGp = rollAndRecord(next, "3d6", randomInt, `Session 0 starting gold x10 for ${playerId}`, "public", playerId).result * 10;

  return { campaign: next, draft: { playerId, rawAbilities, startingGoldGp } };
}

export function commitCharacterCreation(campaign: Campaign, draft: CharacterCreationDraft, plan: CharacterCreationPlan, randomInt: RandomInt): Campaign {
  if (draft.playerId !== plan.playerId) throw new Error("Character creation plan player does not match draft");
  if (!campaign.players[plan.playerId]) throw new Error(`No player ${plan.playerId}`);
  if (Object.values(campaign.characters).some((character) => character.playerId === plan.playerId)) {
    throw new Error(`Player ${plan.playerId} already has a character`);
  }

  const next = cloneCampaign(campaign);
  const abilities = applyOneSwap(draft.rawAbilities, plan.abilitySwap);
  const hpRoll = rollAndRecord(next, classHitDie(plan.className), randomInt, `Session 0 hit points for ${plan.name}`, "public", plan.playerId);
  const purchaseResult = buyStartingGear(next.stores, draft.startingGoldGp, plan.purchases);
  const armorClass = purchaseResult.armorClass ?? 10;
  const characterId = `character-${slug(plan.name)}` as CharacterId;

  const character: Character = {
    id: characterId,
    playerId: plan.playerId,
    name: plan.name,
    stats: { hp: Math.max(1, hpRoll.result), armorClass },
    inventory: purchaseResult.inventory,
    knowledge: ["You begin in the Golden Eel Tavern with rumors of danger and coin in the air."],
    locationId: next.world.startingLocationId,
    abilities,
    className: plan.className,
    level: 1,
    xp: 0,
    goldGp: purchaseResult.remainingGoldGp,
    alignment: plan.alignment,
    ...(plan.deity ? { deity: plan.deity } : {}),
    reasonExceptional: plan.reasonExceptional,
    supplies: { rationDays: purchaseResult.rationDays },
    creationSource: plan.planSource ?? "unknown"
  };

  next.characters[character.id] = character;
  next.publicEvents.push(event(`${character.name}, a level 1 ${plan.className}, joins the table with ${purchaseResult.rationDays} ration day(s) and ${purchaseResult.remainingGoldGp} gp left.`, "session_zero", character.id));
  const privateCharacterNotes = [
    `Character created from 3d6 down the line with${plan.abilitySwap ? " one swap" : " no swap"} using ${plan.planSource ?? "unknown"} plan.`,
    plan.goal ? `goal=${plan.goal}` : undefined,
    plan.fear ? `fear=${plan.fear}` : undefined,
    plan.innerMonologue ? `inner=${plan.innerMonologue}` : undefined
  ].filter(Boolean).join(" | ");
  next.refereeAuditEvents.push(
    audit(privateCharacterNotes, {
      kind: "character_creation",
      playerId: plan.playerId,
      characterId: character.id
    })
  );

  return allPlayersHaveCharacters(next) ? openTavernStart(next) : next;
}

function openTavernStart(campaign: Campaign): Campaign {
  const next = cloneCampaign(campaign);
  next.status = "tavern_start";
  next.publicEvents.push(
    event(
      `The Golden Eel grows loud with three leads: ${Object.values(next.hooks).map((hook) => hook.title).join("; ")}.`,
      "scene_revealed"
    )
  );
  return next;
}

export function awardRecoveredTreasureXp(campaign: Campaign, treasureGp: number, reason = "Recovered non-magical treasure"): Campaign {
  if (!Number.isFinite(treasureGp) || treasureGp < 0) throw new Error("Treasure XP must be a non-negative number");
  const next = cloneCampaign(campaign);
  const livingCharacters = Object.values(next.characters).filter((character) => character.stats.hp > 0);
  if (livingCharacters.length === 0 || treasureGp === 0) return next;

  const share = Math.floor(treasureGp / livingCharacters.length);
  for (const character of livingCharacters) {
    character.xp = (character.xp ?? 0) + share;
  }

  next.publicEvents.push(event(`${reason}: ${treasureGp} gp value grants ${share} XP to each surviving character.`, "world_event"));
  next.refereeAuditEvents.push(audit("OSE XP hook: recovered non-magical treasure grants 1 XP per 1 gp value before party split in this prototype.", { kind: "world_tick" }));
  return next;
}

export function travelToChosenHook(campaign: Campaign, randomInt: RandomInt): Campaign {
  const next = cloneCampaign(campaign);
  const chosenHookId = next.party.chosenHookId;
  if (!chosenHookId) {
    next.publicEvents.push(event("The party has not chosen a lead yet, so no expedition leaves the tavern.", "outcome"));
    return next;
  }

  const hook = next.hooks[chosenHookId];
  if (!hook) throw new Error(`No adventure hook ${chosenHookId}`);
  const destination = next.world.locations[hook.locationId];
  if (!destination) throw new Error(`No destination ${hook.locationId}`);

  next.publicEvents.push(event(`The party sets out from ${next.world.locations[next.party.currentLocationId]?.name ?? next.party.currentLocationId} toward ${destination.name}.`, "travel"));

  const lostRoll = rollAndRecord(next, "1d6", randomInt, "OSE wilderness losing direction check, settled/clear route", "public");
  next.publicEvents.push(event(`Losing direction check: ${lostRoll.result} on ${lostRoll.formula}.`, "dice_roll"));
  if (lostRoll.result === 1) {
    next.publicEvents.push(event("The party loses the road and spends the day correcting course. The destination remains out of reach.", "outcome"));
    consumeRations(next);
    next.time = { day: next.time.day + 1, watch: "morning" };
    return next;
  }

  const encounterRoll = rollAndRecord(next, "1d6", randomInt, "OSE wilderness wandering monster check, settled/clear route", "public");
  next.publicEvents.push(event(`Wandering encounter check: ${encounterRoll.result} on ${encounterRoll.formula}.`, "dice_roll"));
  if (encounterRoll.result === 1) {
    const distanceRoll = rollAndRecord(next, "4d6", randomInt, "OSE wilderness encounter distance x10 yards", "public");
    next.publicEvents.push(event(`Something is encountered about ${distanceRoll.result * 10} yards away. The Referee has not resolved its identity yet.`, "outcome"));
  }

  next.party = { ...next.party, currentLocationId: hook.locationId };
  for (const character of Object.values(next.characters)) {
    character.locationId = hook.locationId;
  }
  consumeRations(next);
  next.time = { day: next.time.day + 1, watch: "morning" };
  next.publicEvents.push(event(`By morning, the party reaches ${destination.name}.`, "travel"));
  return next;
}

function consumeRations(campaign: Campaign): void {
  for (const character of Object.values(campaign.characters)) {
    const rationDays = character.supplies?.rationDays ?? 0;
    if (rationDays > 0) {
      character.supplies = { rationDays: rationDays - 1 };
    } else {
      character.stats = { ...character.stats, hp: Math.max(0, character.stats.hp - 1) };
      campaign.publicEvents.push(event(`${character.name} has no food for the travel day and loses 1 hp.`, "outcome", character.id));
    }
  }
}

export function advanceCampaignTurn(campaign: Campaign, reason = "Autonomous world turn"): Campaign {
  const next = cloneCampaign(campaign);
  next.time = nextWatch(next.time);

  for (const faction of Object.values(next.factions)) {
    if (faction.clock < faction.clockMax) faction.clock += 1;
    next.publicEvents.push(event(`${faction.name} advances its public agenda. Clock: ${faction.clock}/${faction.clockMax}.`, "faction_clock"));
  }

  if (next.time.watch === "morning") {
    for (const character of Object.values(next.characters)) {
      const rationDays = character.supplies?.rationDays ?? 0;
      if (rationDays > 0) {
        character.supplies = { rationDays: rationDays - 1 };
      } else {
        character.stats = { ...character.stats, hp: Math.max(0, character.stats.hp - 1) };
        next.publicEvents.push(event(`${character.name} goes hungry and loses 1 hp.`, "outcome", character.id));
      }
    }
  }

  next.refereeAuditEvents.push(audit(reason, { kind: "world_tick" }));
  next.publicEvents.push(event(`Campaign time advances to day ${next.time.day}, ${next.time.watch}.`, "world_event"));
  return next;
}

function rollAndRecord(campaign: Campaign, formula: string, randomInt: RandomInt, reason: string, visibility: DiceRoll["visibility"], playerId?: PlayerId): DiceRoll {
  const [countText, sidesText] = formula.split("d");
  const count = Number(countText);
  const sides = Number(sidesText);
  if (!Number.isInteger(count) || !Number.isInteger(sides) || count < 1 || sides < 2) throw new Error(`Invalid dice formula ${formula}`);
  const terms = Array.from({ length: count }, () => randomInt(sides));
  const result = terms.reduce((sum, term) => sum + term, 0);
  const roll: DiceRoll = {
    id: nextId("roll"),
    ...(playerId ? { playerId } : {}),
    formula,
    terms,
    result,
    reason,
    visibility,
    createdAt: now()
  };
  campaign.diceLedger.push(roll);
  return roll;
}

function classHitDie(className: OseClass): string {
  switch (className) {
    case "fighter":
    case "dwarf":
      return "1d8";
    case "cleric":
    case "elf":
    case "halfling":
      return "1d6";
    case "magic-user":
    case "thief":
      return "1d4";
  }
}

function applyOneSwap(scores: AbilityScores, swap: CharacterCreationPlan["abilitySwap"]): AbilityScores {
  const next = { ...scores };
  if (!swap || swap.first === swap.second) return next;
  const first = next[swap.first];
  next[swap.first] = next[swap.second];
  next[swap.second] = first;
  return next;
}

function buyStartingGear(stores: Record<StoreId, Store>, startingGoldGp: number, purchases: Purchase[]): { inventory: string[]; remainingGoldGp: number; rationDays: number; armorClass?: number } {
  let remainingGoldGp = startingGoldGp;
  let rationDays = 0;
  let armorClass: number | undefined;
  const inventory: string[] = [];

  for (const purchase of purchases) {
    if (!Number.isInteger(purchase.quantity) || purchase.quantity < 1) throw new Error(`Invalid purchase quantity for ${purchase.itemId}`);
    const item = findStoreItem(stores, purchase.itemId);
    if (!item) throw new Error(`Unknown store item ${purchase.itemId}`);
    const cost = item.costGp * purchase.quantity;
    if (cost > remainingGoldGp) throw new Error(`Cannot afford ${item.name}`);
    remainingGoldGp -= cost;
    rationDays += (item.supplyDays ?? 0) * purchase.quantity;
    if (item.armorClass) armorClass = Math.max(armorClass ?? 10, item.armorClass);
    inventory.push(purchase.quantity === 1 ? item.name : `${item.name} x${purchase.quantity}`);
  }

  return { inventory, remainingGoldGp, rationDays, ...(armorClass ? { armorClass } : {}) };
}

function findStoreItem(stores: Record<StoreId, Store>, itemId: ItemId): StoreItem | undefined {
  for (const store of Object.values(stores)) {
    const item = store.items.find((candidate) => candidate.id === itemId);
    if (item) return item;
  }
  return undefined;
}

function nextWatch(time: Campaign["time"]): Campaign["time"] {
  switch (time.watch) {
    case "morning":
      return { day: time.day, watch: "afternoon" };
    case "afternoon":
      return { day: time.day, watch: "evening" };
    case "evening":
      return { day: time.day, watch: "night" };
    case "night":
      return { day: time.day + 1, watch: "morning" };
  }
}

function allPlayersHaveCharacters(campaign: Campaign): boolean {
  return Object.keys(campaign.players).every((playerId) => Object.values(campaign.characters).some((character) => character.playerId === playerId));
}

function cloneCampaign(campaign: Campaign): Campaign {
  return JSON.parse(JSON.stringify(campaign)) as Campaign;
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || nextId("unnamed");
}

