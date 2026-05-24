export type PlayerId = `player-${string}`;
export type CharacterId = `character-${string}`;
export type RoomId = `room-${string}`;
export type EventId = `event-${string}`;
export type RollId = `roll-${string}`;

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
  roomId: RoomId;
};

export type Room = {
  id: RoomId;
  title: string;
  hiddenDescription: string;
  publicDescription?: string;
  exits: RoomId[];
};

export type ActionProposal = {
  playerId: PlayerId;
  characterId: CharacterId;
  tableSpeech?: string;
  declaredAction: string;
  actionKind: "inspect_area" | "move_to_location" | "hold_position" | "interact" | "other";
  targetRoomId?: RoomId;
  refereeIntent?: string;
};

export type PublicEvent = {
  id: EventId;
  visibility: "public";
  kind: "scene_revealed" | "table_action" | "outcome" | "dice_roll";
  text: string;
  actor?: CharacterId;
  createdAt: string;
};

export type RefereeAuditEvent = {
  id: EventId;
  visibility: "referee";
  kind: "action_proposed" | "adjudication_note";
  playerId?: PlayerId;
  characterId?: CharacterId;
  declaredAction?: string;
  refereeIntent?: string;
  note: string;
  createdAt: string;
};

export type DiceRoll = {
  id: RollId;
  actorId: CharacterId;
  formula: "1d6" | "1d20";
  result: number;
  reason: string;
  visibility: "public" | "referee";
  createdAt: string;
};

export type CharacterProjection = {
  playerId: PlayerId;
  characterId: CharacterId;
  characterName: string;
  visibleRoom: {
    id: RoomId;
    title: string;
    description: string;
    exits: RoomId[];
  };
  characterKnowledge: string[];
  publicEvents: PublicEvent[];
};

export type Campaign = {
  id: string;
  status: "seeded" | "awaiting_player_intent" | "resolving" | "round_committed";
  players: Record<PlayerId, Player>;
  characters: Record<CharacterId, Character>;
  rooms: Record<RoomId, Room>;
  publicEvents: PublicEvent[];
  refereeAuditEvents: RefereeAuditEvent[];
  diceLedger: DiceRoll[];
};

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

export function seedThreeRoomCampaign(id = "demo-campaign"): Campaign {
  const entrance: Room = {
    id: "room-entrance",
    title: "Moss-Crowned Door",
    hiddenDescription: "A stuck stone door hides a copper tripwire in the lower moss.",
    publicDescription: "A moss-crowned stone door leans open into the hill. Damp air leaks from the dark beyond.",
    exits: ["room-shrine"]
  };
  const shrine: Room = {
    id: "room-shrine",
    title: "Sunken Shrine",
    hiddenDescription: "The cracked altar contains a silver key under a loose top stone.",
    exits: ["room-entrance", "room-vault"]
  };
  const vault: Room = {
    id: "room-vault",
    title: "Blue-Tiled Vault",
    hiddenDescription: "The vault has a sleeping ash-cobra curled around a clay coffer.",
    exits: ["room-shrine"]
  };

  const playerA: Player = {
    id: "player-a",
    name: "Mara",
    personality: "Cautious, suspicious, and fond of testing surfaces before trusting them."
  };
  const playerB: Player = {
    id: "player-b",
    name: "Tovin",
    personality: "Bold, chatty, and eager to impress the party with decisive action."
  };

  const characterA: Character = {
    id: "character-brindle",
    playerId: playerA.id,
    name: "Brindle",
    stats: { hp: 5, armorClass: 13 },
    inventory: ["lantern", "iron spike"],
    knowledge: ["The door and damp entrance are visible."],
    roomId: entrance.id
  };
  const characterB: Character = {
    id: "character-osric",
    playerId: playerB.id,
    name: "Osric",
    stats: { hp: 6, armorClass: 12 },
    inventory: ["torch", "10-foot pole"],
    knowledge: ["The door and damp entrance are visible."],
    roomId: entrance.id
  };

  return {
    id,
    status: "awaiting_player_intent",
    players: { [playerA.id]: playerA, [playerB.id]: playerB },
    characters: { [characterA.id]: characterA, [characterB.id]: characterB },
    rooms: { [entrance.id]: entrance, [shrine.id]: shrine, [vault.id]: vault },
    publicEvents: [event(entrance.publicDescription ?? entrance.title, "scene_revealed")],
    refereeAuditEvents: [],
    diceLedger: []
  };
}

export function projectForPlayer(campaign: Campaign, playerId: PlayerId): CharacterProjection {
  const character = Object.values(campaign.characters).find((candidate) => candidate.playerId === playerId);
  if (!character) throw new Error(`No character for ${playerId}`);
  const room = campaign.rooms[character.roomId];
  if (!room) throw new Error(`No room for ${character.roomId}`);
  return {
    playerId,
    characterId: character.id,
    characterName: character.name,
    visibleRoom: {
      id: room.id,
      title: room.title,
      description: room.publicDescription ?? "The Referee has not revealed this place yet.",
      exits: room.exits
    },
    characterKnowledge: [...character.knowledge],
    publicEvents: [...campaign.publicEvents]
  };
}

export function rememberSecret(secrets: string[], note: string): string[] {
  return [...secrets, note];
}

export function resolveRound(campaign: Campaign, proposals: ActionProposal[]): Campaign {
  const next: Campaign = {
    ...campaign,
    status: "resolving",
    publicEvents: [...campaign.publicEvents],
    refereeAuditEvents: [...campaign.refereeAuditEvents],
    diceLedger: [...campaign.diceLedger]
  };

  const validProposals: Array<{ proposal: ActionProposal; character: Character }> = [];

  for (const proposal of proposals) {
    const character = next.characters[proposal.characterId];
    if (!character || character.playerId !== proposal.playerId) {
      next.refereeAuditEvents.push(
        audit("Rejected action proposal because player/character ownership did not match.", {
          kind: "adjudication_note",
          playerId: proposal.playerId,
          characterId: proposal.characterId
        })
      );
      continue;
    }

    validProposals.push({ proposal, character });

    next.refereeAuditEvents.push(
      audit("Player intent received for Referee-only adjudication.", {
        kind: "action_proposed",
        playerId: proposal.playerId,
        characterId: proposal.characterId,
        declaredAction: proposal.declaredAction,
        ...(proposal.refereeIntent ? { refereeIntent: proposal.refereeIntent } : {})
      })
    );

    if (proposal.tableSpeech) {
      next.publicEvents.push(event(`${character.name}: “${proposal.tableSpeech}”`, "table_action", character.id));
    }
    next.publicEvents.push(event(`${character.name} tries to ${proposal.declaredAction}.`, "table_action", character.id));
  }

  const entranceActions = validProposals.filter(({ character }) => character.roomId === "room-entrance");
  const carefulProposal = entranceActions.find(({ proposal }) => isCarefulThresholdInspection(proposal));
  const crossingProposal = entranceActions.find(({ proposal }) => isCrossingThreshold(proposal));

  if (carefulProposal) {
    const roll = addRoll(next, carefulProposal.character.id, "Careful entrance inspection", "public", 2);
    next.publicEvents.push(event(`${carefulProposal.character.name} rolls ${roll.result} on ${roll.formula} for ${roll.reason}.`, "dice_roll", carefulProposal.character.id));
    next.publicEvents.push(event("The party spots the copper tripwire before anyone blunders through it.", "outcome"));
    return { ...next, status: "round_committed" };
  }

  if (crossingProposal) {
    const roll = addRoll(next, crossingProposal.character.id, "Crossing the moss-crowned threshold without checking", "public", 1);
    next.publicEvents.push(event(`${crossingProposal.character.name} rolls ${roll.result} on ${roll.formula} for ${roll.reason}.`, "dice_roll", crossingProposal.character.id));
    next.publicEvents.push(event("The copper tripwire snaps tight across the threshold. The Referee marks the entrance hazard as triggered before the party reaches the shrine.", "outcome", crossingProposal.character.id));
    next.refereeAuditEvents.push(
      audit("Threshold crossing resolved against hidden copper tripwire.", {
        kind: "adjudication_note",
        playerId: crossingProposal.proposal.playerId,
        characterId: crossingProposal.character.id,
        declaredAction: crossingProposal.proposal.declaredAction
      })
    );
    return { ...next, status: "round_committed" };
  }

  next.publicEvents.push(event("The party hesitates at the moss-crowned threshold. Nothing changes yet.", "outcome"));
  return { ...next, status: "round_committed" };
}

function addRoll(campaign: Campaign, actorId: CharacterId, reason: string, visibility: DiceRoll["visibility"], result: number): DiceRoll {
  const roll: DiceRoll = {
    id: nextId("roll"),
    actorId,
    formula: "1d6",
    result,
    reason,
    visibility,
    createdAt: now()
  };
  campaign.diceLedger.push(roll);
  return roll;
}

function isCarefulThresholdInspection(proposal: ActionProposal): boolean {
  return proposal.actionKind === "inspect_area";
}

function isCrossingThreshold(proposal: ActionProposal): boolean {
  return proposal.actionKind === "move_to_location" && proposal.targetRoomId === "room-shrine";
}
