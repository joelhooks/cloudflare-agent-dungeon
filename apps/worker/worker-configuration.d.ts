interface Env {
  Referee: DurableObjectNamespace<import("./src/index").Referee>;
  AI: Ai;
  ARTIFACTS: Artifacts;
  ARTIFACTS_ACCOUNT_ID?: string;
  PROTOTYPE_DEV_ENDPOINTS?: string;
  PROTOTYPE_DEV_TOKEN?: string;
}
