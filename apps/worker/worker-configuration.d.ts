interface Env {
  Referee: DurableObjectNamespace<import("./src/index").Referee>;
  AI: Ai;
}
