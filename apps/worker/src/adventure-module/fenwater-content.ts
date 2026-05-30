import { z } from "zod";
import { AdventureModuleComponentSchema, type AdventureModuleComponent } from "@cloudflare-agent-dungeon/domain";

const FenwaterLocationPayloadSchema = z.object({
  kind: z.literal("location"),
  publicDescription: z.string().min(1),
  affordances: z.array(z.string().min(1)).default([]),
  exits: z.array(z.string().min(1)).default([]),
  hazardTags: z.array(z.string().min(1)).default([])
});

const FenwaterRoutePayloadSchema = z.object({
  kind: z.literal("route"),
  from: z.string().min(1),
  to: z.string().min(1),
  timeCost: z.string().min(1),
  hazardTags: z.array(z.string().min(1)).default([]),
  reveals: z.array(z.string().min(1)).default([]),
  clockTicks: z.array(z.string().min(1)).default([]),
  exitPrompt: z.string().min(1)
});

const FenwaterClockPayloadSchema = z.object({
  kind: z.literal("clock"),
  max: z.number().int().positive(),
  tickTriggers: z.array(z.string().min(1)),
  publicSigns: z.array(z.string().min(1)),
  hardMove: z.string().min(1)
});

const FenwaterFrontPayloadSchema = z.object({
  kind: z.literal("front"),
  triggerTags: z.array(z.string().min(1)),
  stakes: z.string().min(1),
  publicClues: z.array(z.string().min(1)),
  nonCombatOuts: z.array(z.string().min(1)),
  escalation: z.string().min(1),
  aftermathMutation: z.string().min(1),
  linkedClocks: z.array(z.string().min(1)).default([])
});

const FenwaterRestPayloadSchema = z.object({
  kind: z.literal("rest"),
  cost: z.string().min(1),
  safetyCondition: z.string().min(1),
  clockTicks: z.array(z.string().min(1)).default([]),
  recovery: z.string().min(1)
});

const component = (input: AdventureModuleComponent): AdventureModuleComponent => AdventureModuleComponentSchema.parse(input);

export const FENWATER_EXPANDED_COMPONENTS: AdventureModuleComponent[] = [
  component({ id: "fenwater-location-morts-bar", kind: "location", title: "Mort's bar", visibility: "public", payload: FenwaterLocationPayloadSchema.parse({ kind: "location", publicDescription: "The opening heated room, useful for leverage, rumors, barricades, and short rest under pressure.", affordances: ["press Mort", "inspect the knife-nicked beam", "barricade the bar", "hide or secure evidence", "watch who leaves"], exits: ["fenwater-location-north-ditch-door", "fenwater-location-sluice-mouth"], hazardTags: ["social-pressure", "noise", "flood"] }) }),
  component({ id: "fenwater-location-north-ditch-door", kind: "location", title: "North Ditch door", visibility: "public", payload: FenwaterLocationPayloadSchema.parse({ kind: "location", publicDescription: "A swollen door to ditch water, fresh tracks, shell-token traffic, and cold air from outside.", affordances: ["listen at the door", "brace or force the door", "follow wet tracks", "watch for a runner"], exits: ["fenwater-location-sluice-mouth", "fenwater-location-south-cut-trail"], hazardTags: ["door", "water", "pursuit"] }) }),
  component({ id: "fenwater-location-sluice-mouth", kind: "location", title: "sluice mouth", visibility: "public", payload: FenwaterLocationPayloadSchema.parse({ kind: "location", publicDescription: "A black-water ladder and drain where flood, evidence, and bodies can move between town and underdrain.", affordances: ["sound the depth", "secure a rope", "follow the drain", "block the water", "recover floating evidence"], exits: ["fenwater-location-south-cut-trail", "fenwater-location-lockkeepers-cistern"], hazardTags: ["water", "climb", "exposure"] }) }),
  component({ id: "fenwater-location-south-cut-trail", kind: "location", title: "South-cut trail", visibility: "referee", payload: FenwaterLocationPayloadSchema.parse({ kind: "location", publicDescription: "A scraped drainage path out of town where carts should not fit but recent runners do.", affordances: ["follow cart scrapes", "track shell-token runners", "cut overland to the reed maze"], exits: ["fenwater-location-reed-maze", "fenwater-location-eel-nets"], hazardTags: ["trail", "pursuit", "mud"] }) }),
  component({ id: "fenwater-location-reed-maze", kind: "wilderness", title: "Reed maze", visibility: "referee", payload: FenwaterLocationPayloadSchema.parse({ kind: "location", publicDescription: "Tall reeds, false channels, eel stakes, and voices that carry wrong over water.", affordances: ["navigate by pole marks", "follow voices", "hide from cutters", "seek a reedwright guide"], exits: ["fenwater-location-eel-nets", "fenwater-location-old-pump-house", "fenwater-location-reedwright-camp"], hazardTags: ["wilderness", "lost", "ambush"] }) }),
  component({ id: "fenwater-location-eel-nets", kind: "location", title: "Eel-net worksite", visibility: "referee", payload: FenwaterLocationPayloadSchema.parse({ kind: "location", publicDescription: "Work poles, net knives, gossip, and children who notice who returns without boots.", affordances: ["question eel-net children", "trade for a dry path", "spot cutter marks"], exits: ["fenwater-location-reed-maze", "fenwater-location-backwater-ferry"], hazardTags: ["social", "worksite"] }) }),
  component({ id: "fenwater-location-old-pump-house", kind: "location", title: "Old pump house", visibility: "referee", payload: FenwaterLocationPayloadSchema.parse({ kind: "location", publicDescription: "A buckled pump house that runs backward when the ditch climbs.", affordances: ["reverse the pump", "shelter on the mezzanine", "read pressure gauges", "descend to the cistern"], exits: ["fenwater-location-lockkeepers-cistern", "fenwater-location-alder-knoll"], hazardTags: ["machinery", "shelter", "water"] }) }),
  component({ id: "fenwater-location-tithe-mill-yard", kind: "location", title: "Tithe mill yard", visibility: "referee", payload: FenwaterLocationPayloadSchema.parse({ kind: "location", publicDescription: "The grain-buyer's yard where shell tokens become prices, warnings, and hired muscle.", affordances: ["shadow the runner", "inspect sacks", "force a parley", "steal a tally"], exits: ["fenwater-location-charter-house", "fenwater-location-backwater-ferry"], hazardTags: ["faction", "pursuit", "market"] }) }),
  component({ id: "fenwater-location-charter-house", kind: "location", title: "Charter house", visibility: "referee", payload: FenwaterLocationPayloadSchema.parse({ kind: "location", publicDescription: "Records, seals, bailiff pressure, and old rights written drier than the town itself.", affordances: ["search records", "use a bailiff seal", "contest a debt", "hide evidence in public paperwork"], exits: ["fenwater-location-causeway-shrine", "fenwater-location-tithe-mill-yard"], hazardTags: ["law", "records", "social-pressure"] }) }),
  component({ id: "fenwater-location-causeway-shrine", kind: "location", title: "Causeway shrine", visibility: "referee", payload: FenwaterLocationPayloadSchema.parse({ kind: "location", publicDescription: "A raised shrine and travel fork with one dry cache for flood nights.", affordances: ["open the dry cache", "take an omen", "rest in the loft", "choose ferry or knoll"], exits: ["fenwater-location-alder-knoll", "fenwater-location-backwater-ferry", "fenwater-location-charter-house"], hazardTags: ["rest", "travel", "omen"] }) }),
  component({ id: "fenwater-location-reedwright-camp", kind: "location", title: "Reedwright camp", visibility: "referee", payload: FenwaterLocationPayloadSchema.parse({ kind: "location", publicDescription: "Boat builders, marsh guides, and families who know what the cutters broke.", affordances: ["hire a guide", "borrow a skiff", "trade a favor", "hear cutter names"], exits: ["fenwater-location-reed-maze", "fenwater-location-backwater-ferry"], hazardTags: ["faction", "boats", "rest"] }) }),
  component({ id: "fenwater-location-alder-knoll", kind: "location", title: "Alder Knoll dry camp", visibility: "referee", payload: FenwaterLocationPayloadSchema.parse({ kind: "location", publicDescription: "High dry ground, visible smoke, and a risky place to bind wounds while fronts move.", affordances: ["dry gear", "bind wounds", "watch smoke", "choose the next route"], exits: ["fenwater-location-old-pump-house", "fenwater-location-causeway-shrine"], hazardTags: ["rest", "exposure", "watch"] }) }),
  component({ id: "fenwater-location-sunken-chapel", kind: "dungeon", title: "Sunken chapel", visibility: "referee", payload: FenwaterLocationPayloadSchema.parse({ kind: "location", publicDescription: "A submerged chapel where a bell rings under water before bodies surface.", affordances: ["sound the bell", "recover votive silver", "trace old obligations", "risk a submerged passage"], exits: ["fenwater-location-lockkeepers-cistern", "fenwater-location-midden-weir"], hazardTags: ["dungeon", "water", "weird"] }) }),
  component({ id: "fenwater-location-midden-weir", kind: "location", title: "Midden weir", visibility: "referee", payload: FenwaterLocationPayloadSchema.parse({ kind: "location", publicDescription: "A refuse dam that catches evidence before it reaches broad fen.", affordances: ["search the snag line", "clear or jam the weir", "track what washed through"], exits: ["fenwater-location-sunken-chapel", "fenwater-location-backwater-ferry"], hazardTags: ["search", "disease", "evidence"] }) }),
  component({ id: "fenwater-location-lockkeepers-cistern", kind: "dungeon", title: "Lockkeeper's cistern", visibility: "referee", payload: FenwaterLocationPayloadSchema.parse({ kind: "location", publicDescription: "A short underdrain dungeon of lockwheels, valve rooms, and old maintenance ledges.", affordances: ["turn the lockwheel", "map side drains", "search valve rooms", "bypass pressure"], exits: ["fenwater-location-sluice-mouth", "fenwater-location-sunken-chapel", "fenwater-location-old-pump-house"], hazardTags: ["dungeon", "machinery", "water"] }) }),
  component({ id: "fenwater-location-glasswort-sink", kind: "wilderness", title: "Glasswort sink", visibility: "referee", payload: FenwaterLocationPayloadSchema.parse({ kind: "location", publicDescription: "A bright fen sink with brittle salt plants, trapped bubbles, and glittering false footing.", affordances: ["test footing", "collect black-water sample", "skirt the sink", "bait a pursuer"], exits: ["fenwater-location-reed-maze", "fenwater-location-midden-weir"], hazardTags: ["wilderness", "sink", "trap"] }) }),
  component({ id: "fenwater-location-backwater-ferry", kind: "location", title: "Backwater ferry", visibility: "referee", payload: FenwaterLocationPayloadSchema.parse({ kind: "location", publicDescription: "A skiff crossing that can become escape route, chase route, or final warning bell.", affordances: ["hail the ferry", "cut the mooring", "intercept a runner", "leave Fenwater with what you know"], exits: ["fenwater-location-tithe-mill-yard", "fenwater-location-reedwright-camp", "fenwater-location-midden-weir"], hazardTags: ["travel", "escape", "pursuit"] }) }),

  component({ id: "fenwater-route-bar-north-ditch", kind: "route", title: "Mort's bar to North Ditch door", visibility: "public", payload: FenwaterRoutePayloadSchema.parse({ kind: "route", from: "fenwater-location-morts-bar", to: "fenwater-location-north-ditch-door", timeCost: "one pressured move", hazardTags: ["door", "noise"], reveals: ["wet air and shell-token traffic"], clockTicks: ["North Ditch water"], exitPrompt: "Do you brace the door, listen first, or follow the tracks outside?" }) }),
  component({ id: "fenwater-route-north-ditch-sluice", kind: "route", title: "North Ditch door to sluice mouth", visibility: "public", payload: FenwaterRoutePayloadSchema.parse({ kind: "route", from: "fenwater-location-north-ditch-door", to: "fenwater-location-sluice-mouth", timeCost: "one wet crossing", hazardTags: ["water", "climb"], reveals: ["black-water ladder and drain noise"], clockTicks: ["North Ditch water", "Evidence spoils"], exitPrompt: "Do you descend, secure a rope, or track what surfaced?" }) }),
  component({ id: "fenwater-route-sluice-south-cut", kind: "route", title: "Sluice mouth to south-cut trail", visibility: "referee", payload: FenwaterRoutePayloadSchema.parse({ kind: "route", from: "fenwater-location-sluice-mouth", to: "fenwater-location-south-cut-trail", timeCost: "one dangerous route turn", hazardTags: ["trail", "flood"], reveals: ["cart scrapes where carts should not go"], clockTicks: ["Grain-buyer warned"], exitPrompt: "Do you pursue the runner, mark the route, or retreat to dry ground?" }) }),
  component({ id: "fenwater-route-south-cut-reed-maze", kind: "route", title: "South-cut trail to reed maze", visibility: "referee", payload: FenwaterRoutePayloadSchema.parse({ kind: "route", from: "fenwater-location-south-cut-trail", to: "fenwater-location-reed-maze", timeCost: "one exploration turn", hazardTags: ["lost", "ambush"], reveals: ["pole marks and cut reeds"], clockTicks: ["Ditch gang musters"], exitPrompt: "Do you follow pole marks, seek a guide, or hide from voices?" }) }),

  component({ id: "fenwater-faction-mort-debt-web", kind: "faction", title: "Mort's debt web", visibility: "referee", payload: { publicGoal: "keep debts useful and names deniable" } }),
  component({ id: "fenwater-faction-shell-token-syndicate", kind: "faction", title: "Shell-token grain-buyer syndicate", visibility: "referee", payload: { publicGoal: "turn shell tallies into prices and pressure" } }),
  component({ id: "fenwater-faction-fen-cutters", kind: "faction", title: "Fen cutters", visibility: "referee", payload: { publicGoal: "protect paid routes and avoid being blamed" } }),
  component({ id: "fenwater-faction-reedwrights", kind: "faction", title: "Reedwright families", visibility: "referee", payload: { publicGoal: "keep boats, children, and dry paths out of debt hands" } }),
  component({ id: "fenwater-faction-charter-bailiff", kind: "faction", title: "Charter/bailiff office", visibility: "referee", payload: { publicGoal: "claim jurisdiction once evidence has value" } }),
  component({ id: "fenwater-faction-chapel-bell", kind: "faction", title: "Chapel bell keepers", visibility: "referee", payload: { publicGoal: "keep old water obligations paid" } }),
  component({ id: "fenwater-faction-rival-reclaimers", kind: "faction", title: "Rival reclaimers", visibility: "referee", payload: { publicGoal: "take the same lead with fewer scruples" } }),

  component({ id: "fenwater-front-mort-bolts", kind: "encounterPressure", title: "Mort bolts", visibility: "referee", payload: FenwaterFrontPayloadSchema.parse({ kind: "front", triggerTags: ["mort-panic", "bar"], stakes: "Mort changes the scene instead of answering forever.", publicClues: ["Mort watches exits instead of cups"], nonCombatOuts: ["block", "bargain", "let him run and trail him"], escalation: "Mort reaches a named route or calls help.", aftermathMutation: "one bar clue closes; one outside route opens", linkedClocks: ["Mort panic"] }) }),
  component({ id: "fenwater-front-cutter-intercepts", kind: "encounterPressure", title: "Cutter intercepts", visibility: "referee", payload: FenwaterFrontPayloadSchema.parse({ kind: "front", triggerTags: ["trail", "shell-token"], stakes: "Paid muscle tests whether the party can keep evidence moving.", publicClues: ["wet boots and net knives"], nonCombatOuts: ["pay", "name a patron", "lose them in reeds"], escalation: "a cutter blocks the route or marks a PC", aftermathMutation: "Ditch gang clock advances or route safety changes", linkedClocks: ["Ditch gang musters"] }) }),
  component({ id: "fenwater-front-runner-warns", kind: "encounterPressure", title: "Grain-buyer runner escapes", visibility: "referee", payload: FenwaterFrontPayloadSchema.parse({ kind: "front", triggerTags: ["noise", "delay"], stakes: "The wider town starts reacting to the party.", publicClues: ["someone leaves without finishing a cup"], nonCombatOuts: ["chase", "send false word", "secure evidence instead"], escalation: "prices shift and a witness relocates", aftermathMutation: "tithe mill and charter house fronts activate", linkedClocks: ["Grain-buyer warned"] }) }),
  component({ id: "fenwater-front-pump-failure", kind: "encounterPressure", title: "Pump house failure", visibility: "referee", payload: FenwaterFrontPayloadSchema.parse({ kind: "front", triggerTags: ["pump", "water"], stakes: "The flood becomes a town problem, not just a tavern hazard.", publicClues: ["pump rhythm reverses"], nonCombatOuts: ["repair", "shut valve", "evacuate"], escalation: "pressure reroutes through the cistern", aftermathMutation: "new underdrain route opens with a cost", linkedClocks: ["Pump pressure"] }) }),
  component({ id: "fenwater-front-bailiff", kind: "encounterPressure", title: "Bailiff confiscates", visibility: "referee", payload: FenwaterFrontPayloadSchema.parse({ kind: "front", triggerTags: ["charter", "evidence"], stakes: "Official help may become official theft.", publicClues: ["dry seal, wet boots"], nonCombatOuts: ["produce writ", "hide proof", "force public witness"], escalation: "evidence is locked in the Charter House", aftermathMutation: "legal route opens but faction clock advances", linkedClocks: ["Bailiff claims jurisdiction"] }) }),
  component({ id: "fenwater-front-waterlogged-debt", kind: "encounterPressure", title: "Waterlogged debt thing", visibility: "referee", payload: FenwaterFrontPayloadSchema.parse({ kind: "front", triggerTags: ["chapel", "debt", "black-water"], stakes: "The weird consequence of unpaid obligations becomes physical pressure.", publicClues: ["bell note under water"], nonCombatOuts: ["pay", "renounce", "ring bell", "flee"], escalation: "a debt-mark follows a PC", aftermathMutation: "chapel route becomes safer or cursed", linkedClocks: ["Bell under water"] }) }),

  component({ id: "fenwater-clock-evidence-spoils", kind: "clock", title: "Evidence spoils", visibility: "referee", payload: FenwaterClockPayloadSchema.parse({ kind: "clock", max: 6, tickTriggers: ["delay", "water", "fire", "panic"], publicSigns: ["ink runs", "pages pulp", "tracks wash out"], hardMove: "a clue degrades; choose evidence now or shift to witness play" }) }),
  component({ id: "fenwater-clock-ditch-gang-musters", kind: "clock", title: "Ditch gang musters", visibility: "referee", payload: FenwaterClockPayloadSchema.parse({ kind: "clock", max: 8, tickTriggers: ["noise", "runner", "visible violence"], publicSigns: ["boots gather", "net knives appear", "boats move early"], hardMove: "cutters occupy a route or demand a bargain" }) }),
  component({ id: "fenwater-clock-pump-pressure", kind: "clock", title: "Pump pressure", visibility: "referee", payload: FenwaterClockPayloadSchema.parse({ kind: "clock", max: 8, tickTriggers: ["water", "machinery", "delay"], publicSigns: ["pump beats wrong", "floor trembles", "valves shriek"], hardMove: "pressure opens one route while flooding another" }) }),
  component({ id: "fenwater-clock-bailiff", kind: "clock", title: "Bailiff claims jurisdiction", visibility: "referee", payload: FenwaterClockPayloadSchema.parse({ kind: "clock", max: 8, tickTriggers: ["public evidence", "charter", "witness"], publicSigns: ["seal wax", "dry boots", "someone invokes papers"], hardMove: "a legal actor demands custody of proof or prisoners" }) }),

  component({ id: "fenwater-rest-alder-knoll", kind: "location", title: "Alder Knoll dry camp", visibility: "referee", payload: FenwaterRestPayloadSchema.parse({ kind: "rest", cost: "smoke reveals position", safetyCondition: "someone keeps watch and the Ditch gang is not mustered", clockTicks: ["Ditch gang musters"], recovery: "dry gear, bind wounds, settle next route" }) }),
  component({ id: "fenwater-rest-reedwright-boat", kind: "location", title: "Reedwright stove boat", visibility: "referee", payload: FenwaterRestPayloadSchema.parse({ kind: "rest", cost: "owe a guide-favor", safetyCondition: "Reedwrights are not hostile", clockTicks: ["Grain-buyer warned"], recovery: "warm up, trade for route knowledge, protect one fragile item" }) }),
  component({ id: "fenwater-rest-pump-mezzanine", kind: "location", title: "Pump House mezzanine", visibility: "referee", payload: FenwaterRestPayloadSchema.parse({ kind: "rest", cost: "pump pressure advances", safetyCondition: "machinery is braced or watched", clockTicks: ["Pump pressure"], recovery: "short shelter above flood with machinery clues" }) }),

  component({ id: "fenwater-treasure-mort-ledger-page", kind: "treasure", title: "Mort ledger page", visibility: "referee", payload: { leverage: "names a debt and points to the Charter House" } }),
  component({ id: "fenwater-treasure-shell-token-string", kind: "treasure", title: "Shell-token string", visibility: "referee", payload: { leverage: "proves tally traffic at the tithe mill" } }),
  component({ id: "fenwater-treasure-lockwheel-key", kind: "treasure", title: "Lockwheel key", visibility: "referee", payload: { leverage: "opens or jams one cistern valve" } }),
  component({ id: "fenwater-clue-mort-cup-tally", kind: "clue", title: "Mort's cup tally matches shell tokens", visibility: "public", payload: { reveal: "Mort's tabs are not coin tabs; they track shell-token obligations." } })
];

const expandedIds = new Set<string>();
for (const expanded of FENWATER_EXPANDED_COMPONENTS) {
  if (expandedIds.has(expanded.id)) throw new Error(`Duplicate Fenwater expanded component id: ${expanded.id}`);
  expandedIds.add(expanded.id);
}

export function fenwaterInitialLeads(): string[] {
  return ["Mort Peatwright", "knife-nicked beam", "shell-token tally", "North Ditch door", "south-cut drainage rumors", "reedwright guide", "old pump house", "tithe mill yard", "charter house records", "backwater ferry"];
}

export function fenwaterInitialClocks(difficulty: number): Array<{ name: string; value: number; max: number; note?: string }> {
  return [
    { name: "Mort panic", value: Math.max(0, difficulty - 3), max: 6, note: "rises when the party corners him or flashes proof" },
    { name: "North Ditch water", value: Math.max(0, difficulty - 4), max: 6, note: "rises when time passes or the sluice is disturbed" },
    { name: "Grain-buyer warned", value: Math.max(0, difficulty - 5), max: 6, note: "rises when the party makes noise or splits attention" },
    { name: "Evidence spoils", value: 0, max: 6, note: "rises when water, panic, or delay threatens clues" },
    { name: "Ditch gang musters", value: 0, max: 8, note: "rises when runners, noise, or visible violence spread" },
    { name: "Pump pressure", value: 0, max: 8, note: "rises when flood paths and old machinery are stressed" }
  ];
}

export const FENWATER_LOCATION_TITLES: Record<string, string> = {
  "fenwater-location-morts-bar": "Mort's bar",
  "fenwater-location-hearth-beam": "hearth beam",
  "fenwater-location-north-ditch-door": "North Ditch door",
  "fenwater-location-sluice-mouth": "sluice mouth",
  "fenwater-location-south-cut-trail": "South-cut trail",
  "fenwater-location-reed-maze": "Reed maze",
  "fenwater-location-eel-nets": "Eel-net worksite",
  "fenwater-location-old-pump-house": "Old pump house",
  "fenwater-location-tithe-mill-yard": "Tithe mill yard",
  "fenwater-location-charter-house": "Charter house",
  "fenwater-location-causeway-shrine": "Causeway shrine",
  "fenwater-location-reedwright-camp": "Reedwright camp",
  "fenwater-location-alder-knoll": "Alder Knoll dry camp",
  "fenwater-location-sunken-chapel": "Sunken chapel",
  "fenwater-location-midden-weir": "Midden weir",
  "fenwater-location-lockkeepers-cistern": "Lockkeeper's cistern",
  "fenwater-location-glasswort-sink": "Glasswort sink",
  "fenwater-location-backwater-ferry": "Backwater ferry"
};

export function inferFenwaterLocationId(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (/reed maze|pole marks|reeds/.test(lower)) return "fenwater-location-reed-maze";
  if (/eel-net|eel net|net children/.test(lower)) return "fenwater-location-eel-nets";
  if (/pump house|pump/.test(lower)) return "fenwater-location-old-pump-house";
  if (/tithe mill|grain-buyer|grain buyer|corvin/.test(lower)) return "fenwater-location-tithe-mill-yard";
  if (/charter house|bailiff|writ|records/.test(lower)) return "fenwater-location-charter-house";
  if (/causeway|shrine/.test(lower)) return "fenwater-location-causeway-shrine";
  if (/reedwright|stove boat|guide/.test(lower)) return "fenwater-location-reedwright-camp";
  if (/alder knoll|dry camp/.test(lower)) return "fenwater-location-alder-knoll";
  if (/sunken chapel|chapel bell|bell under water/.test(lower)) return "fenwater-location-sunken-chapel";
  if (/midden weir|weir/.test(lower)) return "fenwater-location-midden-weir";
  if (/lockkeeper|cistern|lockwheel|valve/.test(lower)) return "fenwater-location-lockkeepers-cistern";
  if (/glasswort|sink/.test(lower)) return "fenwater-location-glasswort-sink";
  if (/backwater ferry|ferry|skiff/.test(lower)) return "fenwater-location-backwater-ferry";
  if (/south-cut|south cut|drainage trail/.test(lower)) return "fenwater-location-south-cut-trail";
  if (/sluice|black water|ladder|drain/.test(lower)) return "fenwater-location-sluice-mouth";
  if (/north ditch|ditch door|shell-token|shell token/.test(lower)) return "fenwater-location-north-ditch-door";
  if (/beam|hearth|knife-nick|nicks|harp/.test(lower)) return "fenwater-location-hearth-beam";
  if (/bar|mort|ledger|drink|tap/.test(lower)) return "fenwater-location-morts-bar";
  return undefined;
}

export function fenwaterLocationTitle(id: string | undefined): string | undefined {
  return id ? FENWATER_LOCATION_TITLES[id] : undefined;
}

export function inferFenwaterFrontIds(text: string): string[] {
  const lower = text.toLowerCase();
  const fronts: string[] = [];
  if (/mort|panic|bar/.test(lower)) fronts.push("fenwater-front-mort-bolts");
  if (/cutter|net knife|paid muscle|ditch gang/.test(lower)) fronts.push("fenwater-front-cutter-intercepts");
  if (/runner|warn|grain-buyer|grain buyer|corvin|tithe/.test(lower)) fronts.push("fenwater-front-runner-warns");
  if (/pump|pressure|valve|lockwheel/.test(lower)) fronts.push("fenwater-front-pump-failure");
  if (/bailiff|charter|writ|jurisdiction|confiscat/.test(lower)) fronts.push("fenwater-front-bailiff");
  if (/debt thing|chapel|bell|black-water|black water|waterlogged/.test(lower)) fronts.push("fenwater-front-waterlogged-debt");
  return [...new Set(fronts)];
}

export function fenwaterOpeningAffordances(): string[] {
  return ["press Mort", "inspect the knife-nicked beam", "watch who leaves", "brace the North Ditch door", "secure evidence", "barricade and wait", "follow wet tracks", "seek a reedwright guide", "ask about the pump house", "trace shell-token traffic"];
}
