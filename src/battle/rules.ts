import type { UnitKind, Team } from './types';
export const RULES_VERSION = 'senryou-rules-v1';
export const TICK_RATE = 60;
export const MAX_TICKS = 72000;
export const TOTAL: Record<UnitKind, number> = { infantry: 240, tank: 24, aa: 8, aircraft: 24 };
export const INITIAL: Record<UnitKind, number> = { infantry: 72, tank: 8, aa: 4, aircraft: 6 };
export const CAP: Record<UnitKind, number> = { infantry: 120, tank: 12, aa: 4, aircraft: 6 };
export const WAVE: Record<UnitKind, number> = { infantry: 18, tank: 2, aa: 1, aircraft: 1 };
export const HP: Record<UnitKind, number> = { infantry: 40, tank: 300, aa: 160, aircraft: 80 };
export const KILL: Record<UnitKind, number> = { infantry: 20, tank: 300, aa: 200, aircraft: 250 };
export const LOSS: Record<UnitKind, number> = { infantry: 10, tank: 150, aa: 100, aircraft: 300 };
export const KINDS: UnitKind[] = ['infantry', 'tank', 'aa', 'aircraft'];
export const TEAMS: Team[] = ['A', 'B'];
export const opposite = (team: Team): Team => team === 'A' ? 'B' : 'A';
export const CONNECTIONS: readonly [
    string,
    string
][] = [['HA', 'P1'], ['P1', 'P2'], ['P1', 'P3'], ['P1', 'P4'], ['P2', 'P5'], ['P3', 'P5'], ['P4', 'P5'], ['P5', 'HB']];
