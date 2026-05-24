import { describe, expect, it } from "vitest";
import {
  advanceCampaignTurn,
  commitAdventureChoice,
  commitCharacterCreation,
  projectForMonitor,
  projectForPlayer,
  rememberSecret,
  resolveRound,
  rollCharacterCreationDraft,
  seedTavernCampaign,
  seedThreeRoomCampaign,
  startingTownStores,
  travelToChosenHook,
  type ActionProposal
} from "./index";

describe("Cloudflare Agent Dungeon domain prototype", () => {
  it("projects only revealed table state to each player", () => {
    const campaign = seedThreeRoomCampaign();

    const playerA = projectForPlayer(campaign, "player-a");
    const playerB = projectForPlayer(campaign, "player-b");

    expect(playerA.visibleRoom.description).toContain("moss-crowned stone door");
    expect(playerB.visibleRoom.description).toContain("moss-crowned stone door");
    expect(JSON.stringify(playerA)).not.toContain("tripwire");
    expect(JSON.stringify(playerB)).not.toContain("silver key");
    expect(JSON.stringify(playerB)).not.toContain("ash-cobra");
  });

  it("keeps player secret memory separate from action proposals", () => {
    const secrets = rememberSecret([], "I suspect Osric will charge ahead and get us killed.");
    const proposal: ActionProposal = {
      playerId: "player-a",
      characterId: "character-brindle",
      tableSpeech: "Hold up. Let me look first.",
      declaredAction: "inspect the mossy threshold for traps",
      actionKind: "inspect_area",
      refereeIntent: "I am trying to keep Osric from rushing through the doorway."
    };

    expect(secrets).toHaveLength(1);
    expect(proposal).not.toHaveProperty("playerSecretNote");
  });

  it("stores referee intent in private audit events, not public events", () => {
    const campaign = seedThreeRoomCampaign();
    const resolved = resolveRound(campaign, [
      {
        playerId: "player-a",
        characterId: "character-brindle",
        tableSpeech: "Hold up. Something smells wrong.",
        declaredAction: "inspect the mossy threshold for traps",
        actionKind: "inspect_area",
        refereeIntent: "I want to catch danger before Osric notices I am worried."
      },
      {
        playerId: "player-b",
        characterId: "character-osric",
        tableSpeech: "I was born ready.",
        declaredAction: "raise the torch and wait for Brindle's signal",
        actionKind: "hold_position"
      }
    ]);

    expect(resolved.status).toBe("round_committed");
    expect(JSON.stringify(resolved.publicEvents)).toContain("Hold up");
    expect(JSON.stringify(resolved.publicEvents)).not.toContain("before Osric notices");
    expect(JSON.stringify(resolved.refereeAuditEvents)).toContain("before Osric notices");
    expect(JSON.stringify(resolved.diceLedger)).toContain("Careful entrance inspection");
  });

  it("triggers the hidden threshold hazard when characters move through without checking", () => {
    const campaign = seedThreeRoomCampaign();
    const resolved = resolveRound(campaign, [
      {
        playerId: "player-a",
        characterId: "character-brindle",
        tableSpeech: "Let's press on.",
        declaredAction: "move to the next room",
        actionKind: "move_to_location",
        targetRoomId: "room-shrine"
      },
      {
        playerId: "player-b",
        characterId: "character-osric",
        tableSpeech: "Through the door, then.",
        declaredAction: "go through the moss-crowned door",
        actionKind: "move_to_location",
        targetRoomId: "room-shrine"
      }
    ]);

    expect(JSON.stringify(resolved.publicEvents)).toContain("copper tripwire snaps tight");
    expect(JSON.stringify(resolved.refereeAuditEvents)).toContain("Threshold crossing resolved");
    expect(JSON.stringify(resolved.diceLedger)).toContain("Crossing the moss-crowned threshold without checking");
  });

  it("uses typed movement semantics when detecting threshold crossings from terse model actions", () => {
    const campaign = seedThreeRoomCampaign();
    const resolved = resolveRound(campaign, [
      {
        playerId: "player-b",
        characterId: "character-osric",
        tableSpeech: "I step through the moss-covered door into the dark.",
        declaredAction: "travel",
        actionKind: "move_to_location",
        targetRoomId: "room-shrine",
        refereeIntent: "Move Osric from room-entrance into room-shrine and reveal the shrine."
      }
    ]);

    expect(JSON.stringify(resolved.publicEvents)).toContain("copper tripwire snaps tight");
  });

  it("creates characters from 3d6 down the line, one swap, rolled gold, and bought supplies", () => {
    const campaign = seedTavernCampaign();
    const random = fixedRandom([3, 3, 3, 4, 4, 4, 2, 2, 2, 5, 5, 5, 1, 1, 1, 6, 6, 6, 3, 3, 3, 4]);
    const rolled = rollCharacterCreationDraft(campaign, "player-a", random);
    const committed = commitCharacterCreation(
      rolled.campaign,
      rolled.draft,
      {
        playerId: "player-a",
        name: "Nara Reed",
        className: "fighter",
        abilitySwap: { first: "strength", second: "dexterity" },
        alignment: "neutral",
        reasonExceptional: "Keeps standing up when smarter folk run.",
        purchases: [
          { itemId: "item-rations-week", quantity: 1 },
          { itemId: "item-torches", quantity: 1 },
          { itemId: "item-backpack", quantity: 1 },
          { itemId: "item-leather-armor", quantity: 1 },
          { itemId: "item-sword", quantity: 1 }
        ]
      },
      random
    );

    const character = committed.characters["character-nara-reed"];
    expect(character?.abilities?.strength).toBe(15);
    expect(character?.abilities?.dexterity).toBe(9);
    expect(character?.goldGp).toBe(49);
    expect(character?.supplies?.rationDays).toBe(7);
    expect(character?.inventory).toContain("Rations (standard, 7 days)");
    expect(committed.diceLedger).toHaveLength(8);
  });

  it("keeps the starting town stocked with basic stores and OSE-grounded mundane gear", () => {
    const stores = startingTownStores();
    expect(Object.values(stores).map((store) => store.kind).sort()).toEqual([
      "armorer_weaponsmith",
      "general_store",
      "healer_apothecary",
      "hireling_board",
      "market_food",
      "stable_feed",
      "tavern_inn",
      "temple_shrine"
    ]);
    expect(JSON.stringify(stores)).toContain("Lantern");
    expect(JSON.stringify(stores)).toContain("Rations (standard, 7 days)");
    expect(JSON.stringify(stores)).toContain("Leather armor");
  });

  it("commits player adventure choices and lets ignored faction clocks advance", () => {
    const campaign = seedTavernCampaign();
    const chosen = commitAdventureChoice(campaign, [
      { playerId: "player-a", hookId: "hook-drowned-bell", approach: "cautious", reason: "The shrine sounds survivable." },
      { playerId: "player-b", hookId: "hook-blue-tiled-vault", approach: "bold", reason: "Glory lives in the dangerous option." }
    ]);

    expect(chosen.party.chosenHookId).toBe("hook-drowned-bell");
    expect(chosen.party.destinationId).toBe("location-sunken-shrine");
    expect(chosen.hooks["hook-drowned-bell"]?.status).toBe("pursued");
    expect(chosen.factions["faction-ash-cobra-cult"]?.clock).toBe(2);
    expect(JSON.stringify(chosen.publicEvents)).toContain("The party commits");
  });

  it("projects monitor state without hidden room, hidden faction, or referee audit data", () => {
    const campaign = seedThreeRoomCampaign();
    const monitor = projectForMonitor(campaign);
    const text = JSON.stringify(monitor);

    expect(text).not.toContain("tripwire");
    expect(text).not.toContain("Wake the ash-cobra");
    expect(text).not.toContain("refereeAuditEvents");
  });

  it("travels to the chosen hook with OSE-style lost and encounter checks", () => {
    const campaign = commitAdventureChoice(seedThreeRoomCampaign(), [
      { playerId: "player-a", hookId: "hook-drowned-bell", approach: "cautious" },
      { playerId: "player-b", hookId: "hook-drowned-bell", approach: "bold" }
    ]);
    const travelled = travelToChosenHook(campaign, fixedRandom([2, 1, 3, 3, 3, 3]));

    expect(travelled.party.currentLocationId).toBe("location-sunken-shrine");
    expect(travelled.characters["character-brindle"]?.locationId).toBe("location-sunken-shrine");
    expect(travelled.characters["character-brindle"]?.supplies?.rationDays).toBe(1);
    expect(JSON.stringify(travelled.diceLedger)).toContain("OSE wilderness losing direction check");
    expect(JSON.stringify(travelled.publicEvents)).toContain("Something is encountered about 120 yards away");
  });

  it("advances faction clocks and applies hunger when characters have no food", () => {
    const campaign = seedThreeRoomCampaign();
    const brindle = campaign.characters["character-brindle"];
    if (!brindle) throw new Error("missing Brindle");
    brindle.supplies = { rationDays: 0 };
    const next = advanceCampaignTurn(advanceCampaignTurn(campaign));

    expect(next.time).toEqual({ day: 2, watch: "morning" });
    expect(next.characters["character-brindle"]?.stats.hp).toBe(4);
    expect(Object.values(next.factions).every((faction) => faction.clock > 0)).toBe(true);
    expect(JSON.stringify(next.publicEvents)).toContain("goes hungry");
  });
});

function fixedRandom(values: number[]) {
  let index = 0;
  return (sides: number) => {
    const value = values[index] ?? 1;
    index += 1;
    return Math.min(Math.max(1, value), sides);
  };
}

