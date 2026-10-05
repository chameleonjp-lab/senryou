import { Euler, Quaternion, Vector3 } from 'three';
import type { Mission, Team, Unit } from './battle/types';
import { HP } from './battle/rules';
import { terrainLineOfSight } from './battle/terrain';
import { forwardOf } from './flight';
import { targetAimPoint } from './flight-assist';
import type { Aircraft, CombatTarget } from './types';

/** A fresh numeric-to-Three adapter. The renderer never writes this back. */
export function createFlightAircraft(unit: Unit, playerTeam: Team = unit.team): Aircraft {
  const aircraft: Aircraft = {
    kind: 'aircraft', id: unit.id, team: unit.team === playerTeam ? 'friendly' : 'enemy',
    role: unit.role === 'player' ? 'player' : 'interceptor',
    position: new Vector3(), previous: new Vector3(), quaternion: new Quaternion(),
    yaw: 0, pitch: 0, bank: 0, speed: 110, health: unit.hp, maxHealth: HP.aircraft,
    loopProgress: 0, loopCooldown: 0,
  };
  readFlightAircraft(aircraft, unit, playerTeam);
  aircraft.previous.copy(aircraft.position);
  return aircraft;
}

/** Copy simulation state to a reusable adapter, preserving no view-owned state. */
export function readFlightAircraft(aircraft: Aircraft, unit: Unit, playerTeam: Team): void {
  aircraft.id = unit.id;
  aircraft.team = unit.team === playerTeam ? 'friendly' : 'enemy';
  aircraft.role = unit.role === 'player' ? 'player' : 'interceptor';
  aircraft.previous.copy(aircraft.position);
  aircraft.position.set(unit.position.x, unit.position.y, unit.position.z);
  aircraft.yaw = unit.heading;
  aircraft.pitch = unit.pitch ?? Math.atan2(unit.velocity.y, Math.hypot(unit.velocity.x, unit.velocity.z));
  aircraft.bank = unit.bank ?? 0;
  aircraft.speed = unit.speed ?? (Math.hypot(unit.velocity.x, unit.velocity.y, unit.velocity.z) || 110);
  aircraft.health = unit.hp;
  aircraft.maxHealth = HP.aircraft;
  aircraft.loopProgress = unit.loopProgress ?? 0;
  aircraft.loopCooldown = unit.loopCooldown ?? 0;
  aircraft.quaternion.setFromEuler(new Euler(aircraft.pitch, aircraft.yaw, -aircraft.bank, 'YXZ'));
}

/** Authoritative flight integration boundary, called only by a simulation tick. */
export function writeFlightAircraft(unit: Unit, aircraft: Aircraft): void {
  unit.position.x = aircraft.position.x;
  unit.position.y = aircraft.position.y;
  unit.position.z = aircraft.position.z;
  unit.heading = aircraft.yaw;
  unit.pitch = aircraft.pitch;
  unit.bank = aircraft.bank;
  unit.speed = aircraft.speed;
  unit.loopProgress = aircraft.loopProgress;
  unit.loopCooldown = aircraft.loopCooldown;
  const forward = forwardOf(aircraft);
  unit.velocity.x = forward.x * aircraft.speed;
  unit.velocity.y = forward.y * aircraft.speed;
  unit.velocity.z = forward.z * aircraft.speed;
}

const AIM_HEIGHT = { infantry: .9, tank: 1.2, aa: 1.2 } as const;

/** Targets come from the ledger, not the selected LOD or rendering camera.
 * Terrain obstruction is checked against the same collider set used by shots.
 */
export function targetsForFlight(mission: Mission, source?: Aircraft): CombatTarget[] {
  const player = source ?? (() => {
    const unit = mission.units.find(unit => unit.id === mission.controlledAircraftId);
    return unit ? createFlightAircraft(unit, mission.playerTeam) : undefined;
  })();
  const targets: CombatTarget[] = [];
  for (const unit of mission.units) {
    if (unit.state !== 'active' || unit.hp <= 0 || unit.id === mission.controlledAircraftId) continue;
    let target: CombatTarget;
    if (unit.kind === 'aircraft') target = createFlightAircraft(unit, mission.playerTeam);
    else target = {
      kind: unit.kind, id: unit.id, team: unit.team === mission.playerTeam ? 'friendly' : 'enemy',
      position: new Vector3(unit.position.x, unit.position.y, unit.position.z),
      velocity: new Vector3(unit.velocity.x, unit.velocity.y, unit.velocity.z),
      health: unit.hp, maxHealth: HP[unit.kind], aimHeight: AIM_HEIGHT[unit.kind],
    };
    const aim = targetAimPoint(target);
    // Distant units still preserve the source's offscreen response condition.
    // They cannot pass its 1500m projection gate, so LOS work is unnecessary.
    if (!player || player.position.distanceToSquared(aim) > 1500 ** 2
      || terrainLineOfSight(player.position, aim)) targets.push(target);
  }
  return targets;
}
