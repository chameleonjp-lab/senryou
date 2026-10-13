import type { CombatState } from './combat';
import { TICK_RATE } from './rules';
import type { Mission } from './types';

export const RUNTIME_CLEANUP_TICKS = 30 * TICK_RATE;

/** Only remove caches whose units can no longer participate. The score ledger,
 * roster, reservations, ammunition and live projectile state remain intact. */
export function clearUnusedCombatCaches(mission: Mission, combat: CombatState): void {
  const active = new Set(mission.units.filter(unit => unit.state === 'active' && unit.hp > 0).map(unit => unit.id));
  for (const [id, memory] of combat.air.units) {
    if (!active.has(id)) {
      memory.memories.clear();
      combat.air.units.delete(id);
    }
  }
  for (const cache of [combat.aa, combat.turrets, combat.previousPositions]) {
    for (const id of cache.keys()) if (!active.has(id)) cache.delete(id);
  }
}
