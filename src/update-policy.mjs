// Restart only a locked, idle wallet. Never discard a payment or recovery flow.
export function canAutoApply({ locked, blocked, idleMs, visible }) {
  return locked && !blocked && idleMs >= 60_000 && visible;
}
