import type { Quaternion, Vector3 } from 'three';

/** Compatibility boundary for the fixed Kaisen flight and aircraft view code.
 * The authoritative battle ledger uses the numeric structures in battle/types.
 */
export type Team = 'friendly' | 'enemy';
export type GameMode = 'normal' | 'easy';
export interface FlightInput {
  turn: number;
  climb: number;
  fire: boolean;
  loop: boolean;
  bomb?: boolean;
  accelerate?: boolean;
  brake?: boolean;
  viewAspect?: number;
  steeringRevision?: number;
}
export interface Aircraft {
  kind: 'aircraft';
  id: string | number;
  team: Team;
  role: 'player' | 'interceptor' | 'strike';
  position: Vector3;
  previous: Vector3;
  quaternion: Quaternion;
  yaw: number;
  pitch: number;
  bank: number;
  speed: number;
  health: number;
  maxHealth: number;
  loopProgress: number;
  loopCooldown: number;
}
export interface GroundTarget {
  kind: 'infantry' | 'tank' | 'aa';
  id: string | number;
  team: Team;
  position: Vector3;
  velocity: Vector3;
  health: number;
  maxHealth: number;
  /** Central point inside the unit's authoritative collider, above its base. */
  aimHeight: number;
}
export type CombatTarget = Aircraft | GroundTarget;
export interface Bullet {
  id: string | number;
  owner: string | number;
  team: Team;
  position: Vector3;
  previous: Vector3;
  velocity: Vector3;
  life: number;
  damage: number;
  kind: 'mg' | 'cannon' | 'aa';
}
