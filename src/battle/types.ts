export type Team = 'A' | 'B';
export type Owner = Team | 'N';
export type UnitKind = 'infantry' | 'tank' | 'aa' | 'aircraft';
export type UnitState = 'reserve' | 'pending' | 'active' | 'lost';
export interface Vec3 {
    x: number;
    y: number;
    z: number;
}
export interface Unit {
    id: string;
    team: Team;
    kind: UnitKind;
    state: UnitState;
    role: 'player' | 'ai';
    hp: number;
    hpFixed: number;
    maxHpFixed: number;
    pitch?: number;
    bank?: number;
    speed?: number;
    loopProgress?: number;
    loopCooldown?: number;
    position: Vec3;
    velocity: Vec3;
    heading: number;
    squadId?: string;
    ammo: number;
    cannonAmmo: number;
    bombs: number;
    reloadUntil: number;
    bombReloadUntil: number;
    lastFireTick: number;
    lastCannonTick: number;
    lastFirePeriod?: number;
    lastCannonPeriod?: number;
    lastBombTick: number;
    retryNotBefore: number;
    targetPointId?: string;
    targetId?: string;
    targetSince?: number;
    reservation?: Reservation;
}
export interface Reservation {
    missionId: string;
    unitId: string;
    slot: string;
    sourcePoint: string;
    deadline: number;
    blockedSince: number | null;
    player: boolean;
}
export interface CapturePoint {
    id: string;
    homeTeam?: Team;
    position: Vec3;
    owner: Owner;
    phase: 'stable' | 'neutralizing' | 'capturing';
    progressTeam: Team | null;
    progress: number;
    progressNumerator: number;
    remainder: number;
    lastEligibleTick: number;
    idleTicks: number;
    contested: boolean;
    stableSince: number;
}
export interface DamageEvent {
    id: string;
    targetId: string;
    amount: number;
    sourceTeam?: Team;
    sourceRole?: 'player' | 'ai';
    tick: number;
}
export interface DeathEvent {
    unitId: string;
    team: Team;
    kind: UnitKind;
    player: boolean;
    tick: number;
}
export interface ScoreLedger {
    kill: number;
    support: number;
    supportFixed?: number;
    capture: number;
    time: number;
    loss: number;
    deaths: Set<string>;
    captures: Set<string>;
    damageIds: Set<string>;
    damage: DamageEvent[];
}
export interface MissionResult {
    rulesVersion: string;
    seed: number;
    outcome: 'victory' | 'defeat' | 'draw' | 'aborted';
    reason: string;
    tick: number;
    score: {
        kill: number;
        support: number;
        capture: number;
        time: number;
        loss: number;
        total: number;
    };
    owners: Record<string, Owner>;
    remaining: Record<Team, Record<UnitKind, number>>;
    damage: readonly DamageEvent[];
}
export interface Mission {
    controlEnabled?: boolean;
    groundAI?: import('./ground-ai').GroundAIState;
    id: string;
    missionId: string;
    rulesVersion: string;
    seed: number;
    tick: number;
    phase: 'running' | 'paused' | 'result';
    playerTeam: Team;
    units: Unit[];
    points: CapturePoint[];
    controlledAircraftId: string | null;
    respawnCandidateId: string | null;
    respawnReadyTick: number | null;
    playerStatus: 'flying' | 'waiting' | 'spectating';
    waitingReason: string;
    nextWaveTick: number;
    score: ScoreLedger;
    result: MissionResult | null;
    deaths: DeathEvent[];
}
export type SpawnResolver = (unit: Unit, sourcePoint: string, mission: Mission) => Vec3 | null;
