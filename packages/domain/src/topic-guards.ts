/**
 * Topic completion is a destructive lifecycle transition and may only be
 * reached after an explicit user confirmation.
 */
export function assertExplicitTopicCompletion(explicit: boolean): void {
  if (!explicit) {
    throw new Error("explicit topic completion required");
  }
}
