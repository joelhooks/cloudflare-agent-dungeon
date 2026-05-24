import { describe, expect, it } from "vitest";
import {
  advanceCampaignTurn,
  awardRecoveredTreasureXp,
  commitAdventureChoice,
  commitCharacterCreation,
  commitRefereeOutcome,
  projectForDevMonitor,
  projectForMonitor,
  rollCharacterCreationDraft,
  seedTavernCampaign,
  startingTownStores,
  travelToChosenHook
} from "./index";

describe("Cloudflare Agent Dungeon domain prototype", () => {
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
        innerMonologue: "I am terrified, so I buy boring gear that keeps me alive.",
        goal: "Come home with proof I belong here.",
        fear: "Being the first corpse under the hill.",
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

  it("commits player adventure choices, records inner monologue privately, and lets ignored faction clocks advance", () => {
    const campaign = seedTwoCharacters();
    const chosen = commitAdventureChoice(campaign, [
      {
        playerId: "player-a",
        hookId: "hook-drowned-bell",
        approach: "cautious",
        tableSpeech: "The drowned bell sounds bad. Bad means paid.",
        reason: "The shrine sounds survivable.",
        innerMonologue: "If I pick the vault, I die before anyone learns my name.",
        goal: "Find a winnable first job.",
        fear: "Looking cowardly in front of Tovin."
      },
      {
        playerId: "player-b",
        hookId: "hook-blue-tiled-vault",
        approach: "bold",
        reason: "Glory lives in the dangerous option.",
        innerMonologue: "I want the scary one because everyone will remember it.",
        goal: "Become impossible to ignore.",
        fear: "Being ordinary forever."
      }
    ]);

    expect(chosen.party.chosenHookId).toBe("hook-drowned-bell");
    expect(chosen.party.destinationId).toBe("location-sunken-shrine");
    expect(chosen.hooks["hook-drowned-bell"]?.status).toBe("pursued");
    expect(chosen.factions["faction-ash-cobra-cult"]?.clock).toBe(2);
    expect(JSON.stringify(chosen.publicEvents)).toContain("The drowned bell sounds bad");
    expect(JSON.stringify(chosen.publicEvents)).not.toContain("If I pick the vault");
    expect(JSON.stringify(chosen.refereeAuditEvents)).toContain("If I pick the vault");
  });

  it("projects monitor state without hidden faction agenda or referee audit data", () => {
    const campaign = seedTavernCampaign();
    const monitor = projectForMonitor(campaign);
    const text = JSON.stringify(monitor);

    expect(text).not.toContain("Wake the ash-cobra");
    expect(text).not.toContain("hiddenAgenda");
    expect(text).not.toContain("refereeAuditEvents");
  });

  it("exposes Referee audit only through an explicitly marked dev monitor projection", () => {
    const campaign = seedTavernCampaign();
    const devMonitor = projectForDevMonitor(campaign);

    expect(devMonitor.devMode).toBe(true);
    expect(devMonitor.refereeAuditEvents).toHaveLength(1);
    expect(JSON.stringify(devMonitor)).not.toContain("Wake the ash-cobra");
  });

  it("commits RefereeAgent outcomes with public narration and private reasoning lanes", () => {
    const campaign = seedTwoCharacters();
    const withOutcome = commitRefereeOutcome(campaign, {
      publicNarration: "Rain taps the tavern shutters while the map curls at the edges.",
      pressure: "The road will be worse after midnight.",
      nextQuestion: "Do you leave now or buy more oil first?",
      privateReasoning: "The River Guild clock should tighten if they delay."
    });

    expect(JSON.stringify(withOutcome.publicEvents)).toContain("Rain taps");
    expect(JSON.stringify(withOutcome.publicEvents)).toContain("Do you leave now");
    expect(JSON.stringify(withOutcome.publicEvents)).not.toContain("River Guild clock should tighten");
    expect(JSON.stringify(withOutcome.refereeAuditEvents)).toContain("River Guild clock should tighten");
  });

  it("adds an OSE-ish recovered treasure XP hook without a public demo button", () => {
    const campaign = seedTwoCharacters();
    const awarded = awardRecoveredTreasureXp(campaign, 20, "Roadside coin cache recovered");

    expect(awarded.characters["character-nara-reed"]?.xp).toBe(10);
    expect(awarded.characters["character-tovin-gray"]?.xp).toBe(10);
    expect(JSON.stringify(awarded.publicEvents)).toContain("20 gp value grants 10 XP");
  });

  it("travels to the chosen hook with OSE-style lost and encounter checks", () => {
    const campaign = commitAdventureChoice(seedTwoCharacters(), [
      { playerId: "player-a", hookId: "hook-drowned-bell", approach: "cautious" },
      { playerId: "player-b", hookId: "hook-drowned-bell", approach: "bold" }
    ]);
    const travelled = travelToChosenHook(campaign, fixedRandom([2, 1, 3, 3, 3, 3]));

    expect(travelled.party.currentLocationId).toBe("location-sunken-shrine");
    expect(travelled.characters["character-nara-reed"]?.locationId).toBe("location-sunken-shrine");
    expect(travelled.characters["character-nara-reed"]?.supplies?.rationDays).toBe(6);
    expect(JSON.stringify(travelled.diceLedger)).toContain("OSE wilderness losing direction check");
    expect(JSON.stringify(travelled.publicEvents)).toContain("Something is encountered about 120 yards away");
  });

  it("advances faction clocks and applies hunger when characters have no food", () => {
    const campaign = seedTwoCharacters();
    const nara = campaign.characters["character-nara-reed"];
    if (!nara) throw new Error("missing Nara");
    nara.supplies = { rationDays: 0 };
    const next = advanceCampaignTurn(advanceCampaignTurn(campaign));

    expect(next.time).toEqual({ day: 2, watch: "morning" });
    expect(next.characters["character-nara-reed"]?.stats.hp).toBe(4);
    expect(Object.values(next.factions).every((faction) => faction.clock > 0)).toBe(true);
    expect(JSON.stringify(next.publicEvents)).toContain("goes hungry");
  });
});

function seedTwoCharacters() {
  const random = fixedRandom([
    3, 3, 3, 4, 4, 4, 2, 2, 2, 5, 5, 5, 1, 1, 1, 6, 6, 6, 3, 3, 3, 5,
    4, 4, 4, 3, 3, 3, 6, 6, 6, 2, 2, 2, 5, 5, 5, 1, 1, 1, 4, 4, 4, 4
  ]);
  const campaign = seedTavernCampaign();
  const first = rollCharacterCreationDraft(campaign, "player-a", random);
  const withFirst = commitCharacterCreation(
    first.campaign,
    first.draft,
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
  const second = rollCharacterCreationDraft(withFirst, "player-b", random);
  return commitCharacterCreation(
    second.campaign,
    second.draft,
    {
      playerId: "player-b",
      name: "Tovin Gray",
      className: "thief",
      alignment: "chaotic",
      reasonExceptional: "Smiles when the room gets dangerous.",
      purchases: [
        { itemId: "item-rations-week", quantity: 1 },
        { itemId: "item-torches", quantity: 1 },
        { itemId: "item-backpack", quantity: 1 },
        { itemId: "item-dagger", quantity: 1 }
      ]
    },
    random
  );
}

function fixedRandom(values: number[]) {
  let index = 0;
  return (sides: number) => {
    const value = values[index] ?? 1;
    index += 1;
    return Math.min(Math.max(1, value), sides);
  };
}
