interface Env {
  Referee: DurableObjectNamespace<import("./src/index").Referee>;
  AI: Ai;
  RUNTIME_SKILLS: R2Bucket;
  ARTIFACTS: Artifacts;
  ARTIFACTS_ACCOUNT_ID?: string;
  PROTOTYPE_DEV_ENDPOINTS?: string;
  PROTOTYPE_DEV_TOKEN?: string;
}
