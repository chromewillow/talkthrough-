import { LlmError, type LlmErrorKind } from "@/lib/narrate/llm";
import { FriendlyError } from "./ingest";

const TITLES: Record<LlmErrorKind, string> = {
  auth: "Your API key didn't work",
  credits: "Out of credits",
  model: "Model not found",
  rate_limit: "The provider is rate-limiting us",
  context: "Too long for this model",
  server: "The provider is having trouble",
  network: "Couldn't reach the model provider",
  bad_request: "The provider turned the request down",
  empty: "The model went quiet",
  aborted: "Stopped",
};

const ADVICE: Partial<Record<LlmErrorKind, string>> = {
  rate_limit:
    "We waited and retried a few times. Give it a minute, then press Resume — finished parts are kept. Lowering parallel requests in Settings helps too.",
  server: "Finished parts are kept, so pressing Resume picks up where this stopped.",
  network: "Finished parts are kept, so pressing Resume picks up where this stopped.",
  empty: "Some models (especially reasoning-heavy ones) do this. Try Resume, or pick a different model.",
  context: "Try a model with a larger context window.",
};

/** Turns any failure from a run into something a person can act on. */
export function toFriendly(err: unknown): FriendlyError {
  if (err instanceof FriendlyError) return err;
  if (err instanceof LlmError) {
    const advice = ADVICE[err.kind];
    return new FriendlyError(TITLES[err.kind], advice ? `${err.message} ${advice}` : err.message, err.kind);
  }
  return new FriendlyError("Something went wrong", err instanceof Error ? err.message : String(err));
}

export function isResumable(code: string | undefined) {
  return code === "rate_limit" || code === "server" || code === "network" || code === "empty" || code === "aborted";
}
