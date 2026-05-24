import { describe, expect, it } from "vitest";
import {
  projectForPlayer,
  rememberSecret,
  resolveRound,
  seedThreeRoomCampaign,
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

  it("uses refereeIntent when detecting threshold crossings from terse model actions", () => {
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
});
