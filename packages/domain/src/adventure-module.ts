import { z } from "zod";

export const AdventureModuleVisibilitySchema = z.enum(["public", "player", "referee", "private"]);
export type AdventureModuleVisibility = z.infer<typeof AdventureModuleVisibilitySchema>;

export const AdventureModuleComponentKindSchema = z.enum([
  "settlement",
  "town",
  "dungeon",
  "wilderness",
  "route",
  "faction",
  "location",
  "npc",
  "clock",
  "encounterPressure",
  "treasure",
  "clue",
  "localityAnchor"
]);
export type AdventureModuleComponentKind = z.infer<typeof AdventureModuleComponentKindSchema>;

export const AdventureModuleSourceSchema = z.object({
  kind: z.enum(["artifacts", "r2", "local"]),
  repo: z.string().min(1).optional(),
  commit: z.string().min(1).optional(),
  paths: z.array(z.string().min(1)).default([])
});
export type AdventureModuleSource = z.infer<typeof AdventureModuleSourceSchema>;

export const AdventureModuleComponentRefSchema = z.object({
  id: z.string().min(1),
  kind: AdventureModuleComponentKindSchema,
  title: z.string().min(1),
  visibility: AdventureModuleVisibilitySchema.default("public")
});
export type AdventureModuleComponentRef = z.infer<typeof AdventureModuleComponentRefSchema>;

export const AdventureModuleComponentSchema = AdventureModuleComponentRefSchema.extend({
  payload: z.unknown().optional()
});
export type AdventureModuleComponent = z.infer<typeof AdventureModuleComponentSchema>;

export const AdventureModuleManifestSchema = z.object({
  schema: z.literal("AdventureModuleManifest.v1"),
  moduleId: z.string().min(1),
  title: z.string().min(1),
  source: AdventureModuleSourceSchema,
  components: z.array(AdventureModuleComponentRefSchema).default([]),
  aliases: z.object({
    ose: z.literal("AdventureScenario").default("AdventureScenario")
  }).default({ ose: "AdventureScenario" })
});
export type AdventureModuleManifest = z.infer<typeof AdventureModuleManifestSchema>;

export const AdventureModuleProjectionSchema = z.object({
  schema: z.literal("AdventureModuleProjection.v1"),
  moduleId: z.string().min(1),
  audience: z.enum(["public", "player", "referee"]),
  components: z.array(AdventureModuleComponentRefSchema).default([])
});
export type AdventureModuleProjection = z.infer<typeof AdventureModuleProjectionSchema>;

export const AdventureModuleSchema = z.object({
  schema: z.literal("AdventureModule.v1"),
  manifest: AdventureModuleManifestSchema,
  components: z.array(AdventureModuleComponentSchema).default([])
});
export type AdventureModule = z.infer<typeof AdventureModuleSchema>;

export function projectAdventureModule(module: AdventureModule, audience: AdventureModuleProjection["audience"]): AdventureModuleProjection {
  const allowed = module.components.filter((component) => {
    if (audience === "referee") return component.visibility !== "private";
    if (audience === "player") return component.visibility === "public" || component.visibility === "player";
    return component.visibility === "public";
  });

  return AdventureModuleProjectionSchema.parse({
    schema: "AdventureModuleProjection.v1",
    moduleId: module.manifest.moduleId,
    audience,
    components: allowed.map(({ payload: _payload, ...ref }) => ref)
  });
}
