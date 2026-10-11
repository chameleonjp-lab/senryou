import {
  ACESFilmicToneMapping, BackSide, BoxGeometry, BufferAttribute, BufferGeometry,
  Color, CylinderGeometry, DirectionalLight, DynamicDrawUsage, Euler, Fog, Group,
  HemisphereLight, InstancedMesh, LineBasicMaterial, LineLoop, LineSegments,
  Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera,
  Points, Quaternion, Scene, ShaderMaterial, SphereGeometry, SRGBColorSpace,
  Vector3, WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AircraftFactory, type AircraftVisual } from './aircraft';
import { AircraftBatchFactory } from './aircraft-batch';
import { AircraftTracers } from './aircraft-tracers';
import { BattleLandscape } from './battle-landscape';
import { GroundVisualFactory, type GroundKind } from './battle-ground-view';
import { createFlightAircraft, readFlightAircraft, targetsForFlight } from './battle-flight';
import { skyFragment, skyVertex } from './battle-sky';
import { CAP } from './battle/rules';
import { BATTLEFIELD, bridgeAt, terrainNormal, walkableSurface } from './battle/terrain';
import type { CapturePoint, Mission, Team, Unit, Vec3 } from './battle/types';
import type { Projectile } from './battle/projectiles';
import type { CombatEvent } from './battle/weapons';
import { targetAimPoint } from './flight-assist';
import { EASY_AIM_RADIUS, FLIGHT_FOV, getFlightCameraPose, projectFlightTarget } from './flight-view';
import { projectGunSight } from './gun-sight';
import { RenderQueue } from './render-queue';
import { compactOverlayLabels, overlayTextPosition, overlayLabelLeader, type OverlayLabels } from './overlay-labels';
import type { Aircraft, Bullet, GameMode } from './types';

export const DETAIL_CAPACITY = 96;
export const UNIT_VIEW_CAPACITY = 284;
export const VISUAL_TRACER_CAPACITY = 1024;
export type BattleLOD = 'normal' | 'low' | 'high';
const EFFECT_CAPACITY = 128;
const POINT_CAPACITY = EFFECT_CAPACITY + VISUAL_TRACER_CAPACITY;
const BOMB_CAPACITY = 64;
const TEAM_COLORS = { friendly: 0x27aaa4, enemy: 0xe29b55, neutral: 0xb8b995 } as const;
const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, -1);
const UNIT_SCALE = new Vector3(1, 1, 1);

export interface ViewAAWarning {
  gunId: string; targetId: string; position: Vec3; direction: Vec3;
  stage: 'aiming' | 'firing'; readyTick: number;
}
export interface BattleCombatView {
  projectiles: readonly Projectile[];
  events: readonly CombatEvent[];
  aaWarnings?: readonly ViewAAWarning[];
  turrets?: ReadonlyMap<string, Vec3>;
  aa?: ReadonlyMap<string, { direction: Vec3 }>;
}
export interface ViewBombGuide { position: Vec3; time: number; effective?: boolean }
interface DetailSlot {
  key: string; id: string | null; root: Group; aircraft?: AircraftVisual; armament?: Group;
}
interface CaptureVisual {
  root: Group; ring: LineLoop; material: LineBasicMaterial;
  flag: Mesh<BoxGeometry, MeshBasicMaterial>;
}
interface ViewParticle {
  active: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number;
  born: number; life: number; size: number; red: number; green: number; blue: number; gravity: number;
}

/** Pure visual selection. Full aircraft geometry always remains available;
 * only ground meshes change detail. The ledger and colliders are never inputs
 * to a probabilistic offscreen model and are never changed by this function.
 */
export function selectDetailedUnitIds(
  units: readonly Unit[], controlledId: string | null, camera: Vec3, lod: BattleLOD,
): Set<string> {
  const active = units.filter(unit => unit.state === 'active' && unit.hp > 0);
  const aircraft = active.filter(unit => unit.kind === 'aircraft').sort((a, b) => {
    if (a.id === controlledId) return -1;
    if (b.id === controlledId) return 1;
    return a.id.localeCompare(b.id);
  });
  const ground = lod === 'low' ? [] : active.filter(unit => unit.kind !== 'aircraft').map(unit => ({ unit,
    distance: (unit.position.x - camera.x) ** 2 + (unit.position.y - camera.y) ** 2 + (unit.position.z - camera.z) ** 2,
  })).filter(item => lod === 'high' || item.distance <= 1400 ** 2)
    .sort((a, b) => a.distance - b.distance || a.unit.id.localeCompare(b.unit.id));
  return new Set([...aircraft.map(unit => unit.id), ...ground.map(item => item.unit.id)].slice(0, DETAIL_CAPACITY));
}

/** A new land renderer around the fixed aircraft, flight camera, sky and
 * tracer implementations. All pools and clocks below are presentation state.
 */
export class BattleView {
  readonly renderer: WebGLRenderer;
  readonly camera = new PerspectiveCamera(FLIGHT_FOV, 1, .5, 22000);
  readonly scene = new Scene();
  private readonly queue: RenderQueue;
  private readonly aircraft = new AircraftFactory();
  private readonly aircraftBatches = new AircraftBatchFactory();
  private readonly aircraftTracers = new AircraftTracers(VISUAL_TRACER_CAPACITY);
  private readonly ground = new GroundVisualFactory();
  private readonly landscape = new BattleLandscape();
  private readonly sky = new Mesh(new SphereGeometry(21000, 32, 20), new ShaderMaterial({
    vertexShader: skyVertex, fragmentShader: skyFragment, side: BackSide, depthWrite: false,
  }));
  private readonly teamBandGeometry = new CylinderGeometry(.34, .39, .6, 14, 1, true);
  private readonly teamMaterials = {
    friendly: new MeshBasicMaterial({ color: TEAM_COLORS.friendly }),
    enemy: new MeshBasicMaterial({ color: TEAM_COLORS.enemy }),
  };
  private readonly detailSlots: DetailSlot[] = [];
  private readonly assigned = new Map<string, DetailSlot>();
  private readonly groundInstances = new Map<string, InstancedMesh>();
  private readonly armamentInstances = new Map<string, InstancedMesh>();
  private readonly pointVisuals = new Map<string, CaptureVisual>();
  private readonly matrix = new Matrix4();
  private readonly rotation = new Quaternion();
  private readonly weaponRotation = new Quaternion();
  private readonly weaponPosition = new Vector3();
  private readonly direction = new Vector3();
  private readonly position = new Vector3();
  private readonly normal = new Vector3();
  private readonly tracerGeometry = new BufferGeometry();
  private readonly tracerPositions = new Float32Array(VISUAL_TRACER_CAPACITY * 6);
  private readonly tracerColors = new Float32Array(VISUAL_TRACER_CAPACITY * 6);
  private readonly groundTracers: LineSegments<BufferGeometry, LineBasicMaterial>;
  private readonly visualBullets: Bullet[] = [];
  private readonly reusableBullets: Bullet[] = [];
  private readonly bombGeometry: BufferGeometry;
  private readonly bombMaterial = new MeshStandardMaterial({ color: 0x667982, roughness: .52, metalness: .55 });
  private readonly bombs: InstancedMesh;
  private readonly particleGeometry = new BufferGeometry();
  private readonly particlePositions = new Float32Array(POINT_CAPACITY * 3);
  private readonly particleColors = new Float32Array(POINT_CAPACITY * 3);
  private readonly particleSizes = new Float32Array(POINT_CAPACITY);
  private readonly particleOpacity = new Float32Array(POINT_CAPACITY);
  private readonly particles: ViewParticle[] = Array.from({ length: EFFECT_CAPACITY }, () => ({ active: false,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, born: 0, life: 0, size: 0, red: 0, green: 0, blue: 0, gravity: 0 }));
  private readonly points: Points<BufferGeometry, ShaderMaterial>;
  private readonly seenEvents = new Set<string>();
  private readonly seenDeaths = new Set<string>();
  private lastEventTick = -1;
  private pendingEvents: CombatEvent[] = [];
  private pendingMissionId = '';
  private currentMissionId = '';
  private currentPlayerId: string | null = null;
  private flightPlayer: Aircraft | null = null;
  private bombGuide: ViewBombGuide | null = null;
  private overlayLabels: OverlayLabels | null = null;
  private cameraOverride: { position: Vec3; quaternion: Quaternion } | null = null;
  private lod: BattleLOD = 'normal';
  private width = 1;
  private height = 1;
  private lastTick = 0;
  private visualTime = 0;
  private lastActiveCount = 0;
  private renderedLowCount = 0;
  private prepared = false;
  private disposed = false;
  private readonly ctx: CanvasRenderingContext2D | null;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly overlay?: HTMLCanvasElement) {
    // Avoid expensive multisample resolves on constrained GPUs.
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    const gl = this.renderer.getContext();
    if (!('fenceSync' in gl)) throw new Error('WebGL2 is required');
    this.queue = new RenderQueue(gl);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.ctx = overlay?.getContext('2d') ?? null;
    this.scene.background = new Color(0xaecbd0);
    this.scene.fog = new Fog(0xaecbd0, 1400, 6000);
    this.scene.add(new HemisphereLight(0xc6e5ec, 0x23424e, 2.3));
    const sun = new DirectionalLight(0xffe9b5, 3.1);
    sun.position.set(-600, 700, -350);
    this.scene.add(sun, this.sky, this.landscape.root, this.aircraftTracers.root);
    this.camera.position.set(-2750, 700, -720);
    this.camera.quaternion.setFromEuler(new Euler(0, -Math.PI / 2, 0, 'YXZ'));

    for (const kind of ['infantry', 'tank', 'aa'] as const) for (const team of ['A', 'B'] as const) {
      const mesh = new InstancedMesh(this.ground.geometry(kind, false), this.ground.material(team), CAP[kind]);
      mesh.name = `simple-${kind}-${team}`; mesh.count = 0; mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      this.groundInstances.set(`${kind}:${team}`, mesh); this.scene.add(mesh);
      if (kind !== 'infantry') {
        const armament = new InstancedMesh(this.ground.geometry(kind, false, true), this.ground.material(team), CAP[kind]);
        armament.name = `simple-armament-${kind}-${team}`; armament.count = 0; armament.frustumCulled = false;
        armament.instanceMatrix.setUsage(DynamicDrawUsage);
        this.armamentInstances.set(`${kind}:${team}`, armament); this.scene.add(armament);
      }
    }
    this.tracerGeometry.setAttribute('position', new BufferAttribute(this.tracerPositions, 3));
    this.tracerGeometry.setAttribute('color', new BufferAttribute(this.tracerColors, 3));
    this.tracerGeometry.setDrawRange(0, 0);
    this.groundTracers = new LineSegments(this.tracerGeometry,
      new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .9 }));
    this.groundTracers.frustumCulled = false; this.scene.add(this.groundTracers);

    // Fixed Kaisen bomb body and fins, with the torpedo/water path removed.
    const bombParts: BufferGeometry[] = [new CylinderGeometry(.06, .2, 1.5, 8)];
    for (const yaw of [0, Math.PI / 2]) {
      const fin = new BoxGeometry(.8, .225, .04);
      fin.translate(0, -.6, 0); fin.rotateY(yaw); bombParts.push(fin);
    }
    const bombGeometry = mergeGeometries(bombParts, false);
    for (const part of bombParts) part.dispose();
    if (!bombGeometry) throw new Error('Bomb geometry could not be merged');
    this.bombGeometry = bombGeometry;
    this.bombs = new InstancedMesh(this.bombGeometry, this.bombMaterial, BOMB_CAPACITY);
    this.bombs.name = 'live-bombs'; this.bombs.count = 0; this.bombs.frustumCulled = false;
    this.bombs.instanceMatrix.setUsage(DynamicDrawUsage); this.scene.add(this.bombs);

    this.particleGeometry.setAttribute('position', new BufferAttribute(this.particlePositions, 3));
    this.particleGeometry.setAttribute('color', new BufferAttribute(this.particleColors, 3));
    this.particleGeometry.setAttribute('size', new BufferAttribute(this.particleSizes, 1));
    this.particleGeometry.setAttribute('opacity', new BufferAttribute(this.particleOpacity, 1));
    this.particleGeometry.setDrawRange(0, 0);
    this.points = new Points(this.particleGeometry, new ShaderMaterial({ transparent: true,
      depthWrite: false, vertexColors: true,
      vertexShader: 'attribute float size;attribute float opacity;varying vec3 vColor;varying float vAlpha;void main(){vColor=color;vAlpha=opacity;vec4 p=modelViewMatrix*vec4(position,1.);gl_PointSize=size<0.?-size:clamp(size*450./max(1.,-p.z),1.,80.);gl_Position=projectionMatrix*p;}',
      fragmentShader: 'varying vec3 vColor;varying float vAlpha;void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;gl_FragColor=vec4(vColor,pow(1.-d,1.7)*.8*vAlpha);}',
    }));
    this.points.frustumCulled = false; this.scene.add(this.points);
    this.resize();
  }

  resize(width?: number, height?: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = width ?? rect.width, h = height ?? rect.height;
    if (!(w > 0 && h > 0) || this.disposed) return;
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.overlay) { this.overlay.width = Math.round(w); this.overlay.height = Math.round(h); }
    this.aircraftTracers.coreMaterial.resolution.set(w, h);
    this.aircraftTracers.outlineMaterial.resolution.set(w, h);
  }

  async prepare(): Promise<void> {
    if (this.disposed || this.prepared) return;
    // Both source detail variants are compiled before the first pilot takeover.
    const hero = this.acquireSlot('aircraft:hero:friendly'), enemy = this.acquireSlot('aircraft:enemy:enemy');
    hero.root.visible = enemy.root.visible = true;
    hero.root.position.set(-2720, 689, -720); enemy.root.position.set(-2500, 720, -730);
    await this.renderer.compileAsync(this.scene, this.camera);
    if (this.disposed) return;
    // Exercise empty pooled materials and buffers behind the preparation UI.
    // This is visual data only; no logical round, damage, or clock is created.
    const sample = new Vector3(0, 0, -80).applyQuaternion(this.camera.quaternion).add(this.camera.position);
    this.aircraftTracers.prime(sample);
    this.tracerPositions.set([sample.x - 1, sample.y, sample.z, sample.x + 1, sample.y, sample.z]);
    this.tracerColors.set([1, .8, .4, 1, .8, .4]);
    this.tracerGeometry.setDrawRange(0, 2);
    this.tracerGeometry.attributes.position.needsUpdate = this.tracerGeometry.attributes.color.needsUpdate = true;
    this.particlePositions.set(sample.toArray()); this.particleColors.set([1, .7, .2]);
    this.particleSizes[0] = 2; this.particleOpacity[0] = 1;
    this.particleGeometry.setDrawRange(0, 1);
    for (const attribute of Object.values(this.particleGeometry.attributes)) attribute.needsUpdate = true;
    this.bombs.setMatrixAt(0, this.matrix.compose(sample, new Quaternion(), UNIT_SCALE));
    this.bombs.count = 1; this.bombs.instanceMatrix.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    this.aircraftTracers.update([]); this.tracerGeometry.setDrawRange(0, 0);
    this.particleGeometry.setDrawRange(0, 0); this.bombs.count = 0;
    hero.root.visible = enemy.root.visible = false;
    this.renderer.render(this.scene, this.camera);
    // Finish preparation draws before the first gameplay fence starts its clock.
    // Shader compilation alone does not drain the GPU's warm-up draw queue.
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const warmFence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!warmFence) throw new Error('描画準備の完了を確認できません');
    gl.flush();
    const began = performance.now();
    try {
      await new Promise<void>((resolve, reject) => {
        const poll = () => {
          try {
            if (this.disposed || gl.isContextLost()) { reject(new Error('描画準備が中断されました')); return; }
            const status = gl.clientWaitSync(warmFence, 0, 0);
            if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) { resolve(); return; }
            if (status === gl.WAIT_FAILED || performance.now() - began > 25000) { reject(new Error('描画準備が完了しませんでした')); return; }
            requestAnimationFrame(poll);
          } catch (error) { reject(error); }
        };
        poll();
      });
    } finally { gl.deleteSync(warmFence); }
    if (this.disposed) return;
    this.prepared = true;
  }

  pollRender(now = performance.now()) { return this.queue.poll(now); }
  resetRenderQueue(): void { this.queue.reset(); }
  setLOD(lod: BattleLOD): void { this.lod = lod; }
  setBombGuide(guide: ViewBombGuide | null): void { this.bombGuide = guide; }
  /** Validation hook: display camera only; Easy targeting retains flight-view. */
  setCameraOverride(camera: { position: Vec3; quaternion: Quaternion } | null): void { this.cameraOverride = camera; }

  /** Keep events from every fixed tick even when several ticks precede a frame. */
  queueEvents(events: readonly CombatEvent[], missionId: string): void {
    if (this.disposed) return;
    if (this.pendingMissionId !== missionId) this.pendingEvents.length = 0;
    this.pendingMissionId = missionId;
    for (const event of events) this.pendingEvents.push(event);
  }

  render(mission: Mission, mode: GameMode, combat?: BattleCombatView, showHUD = true, presentationDt = 0): boolean {
    if (this.disposed) return false;
    if (mission.missionId !== this.currentMissionId) this.resetMission(mission);
    this.consumeEvents(mission, combat?.events ?? []);
    if (this.pollRender() !== 'ready') return false;
    const elapsed = mission.tick / 60;
    const dt = Math.max(0, Math.min(.1, (mission.tick - this.lastTick) / 60));
    this.lastTick = mission.tick;
    this.visualTime = mission.phase === 'result'
      ? Math.max(this.visualTime, elapsed) + Math.max(0, Math.min(.1, presentationDt)) : elapsed;
    const player = mission.units.find(unit => unit.id === mission.controlledAircraftId && unit.state === 'active' && unit.hp > 0);
    if (player) {
      if (this.currentPlayerId !== player.id || !this.flightPlayer) this.flightPlayer = createFlightAircraft(player, mission.playerTeam);
      else readFlightAircraft(this.flightPlayer, player, mission.playerTeam);
      this.currentPlayerId = player.id;
      getFlightCameraPose(this.flightPlayer, mode, this.camera.position, this.camera.quaternion);
    } else {
      this.currentPlayerId = null; this.flightPlayer = null;
      const front = mission.points.find(point => point.id === 'P3') ?? { position: { x: 0, y: 12, z: 0 } };
      this.camera.position.set(front.position.x - 700, front.position.y + 1050, front.position.z + 1600);
      this.camera.lookAt(front.position.x, front.position.y, front.position.z);
    }
    if (this.cameraOverride) {
      this.camera.position.set(this.cameraOverride.position.x, this.cameraOverride.position.y, this.cameraOverride.position.z);
      this.camera.quaternion.copy(this.cameraOverride.quaternion);
    }
    this.camera.updateMatrixWorld(); this.sky.position.copy(this.camera.position);
    this.updateUnits(mission, dt, combat);
    this.updatePoints(mission);
    this.updateProjectiles(combat?.projectiles ?? [], mission.playerTeam);
    this.updateParticles(combat?.projectiles ?? []);
    this.renderer.render(this.scene, this.camera);
    this.drawOverlay(mission, mode, combat, showHUD);
    if (this.prepared) this.queue.submit(performance.now());
    return true;
  }

  project(world: Vec3) {
    this.position.set(world.x, world.y, world.z).project(this.camera);
    return { x: (this.position.x * .5 + .5) * this.width, y: (.5 - this.position.y * .5) * this.height,
      nx: this.position.x, ny: this.position.y, depth: this.position.z,
      visible: this.position.z > -1 && this.position.z < 1 && Math.abs(this.position.x) <= 1 && Math.abs(this.position.y) <= 1 };
  }

  private resetMission(mission: Mission): void {
    this.currentMissionId = mission.missionId;
    this.currentPlayerId = null; this.flightPlayer = null;
    this.lastTick = mission.tick; this.visualTime = mission.tick / 60;
    this.bombGuide = null;
    if (this.pendingMissionId !== mission.missionId) this.pendingEvents.length = 0;
    this.seenEvents.clear(); this.seenDeaths.clear(); this.lastEventTick = -1;
    for (const slot of this.detailSlots) { slot.id = null; slot.root.visible = false; }
    this.assigned.clear();
    for (const particle of this.particles) particle.active = false;
  }

  private acquireSlot(key: string): DetailSlot {
    let slot = this.detailSlots.find(slot => slot.id === null && slot.key === key);
    if (slot) return slot;
    // A retired slot may change archetype, but total detailed roots stays <=96.
    slot = this.detailSlots.length >= DETAIL_CAPACITY ? this.detailSlots.find(slot => slot.id === null) : undefined;
    if (slot) { slot.root.removeFromParent(); this.detailSlots.splice(this.detailSlots.indexOf(slot), 1); }
    const [kind, detail, team] = key.split(':');
    if (kind === 'aircraft') {
      const visual = this.aircraftBatches.optimize(this.aircraft.create(detail === 'hero' ? 'hero' : 'enemy'),
        detail === 'hero' ? 'hero' : 'enemy');
      if (detail !== 'hero') {
        const band = new Mesh(this.teamBandGeometry, this.teamMaterials[team as 'friendly' | 'enemy']);
        band.rotation.x = Math.PI / 2; band.position.set(0, .04, 2.45); band.scale.z = 1.12;
        visual.root.add(band);
      }
      slot = { key, id: null, root: visual.root, aircraft: visual };
    } else {
      const root = this.ground.create(kind as GroundKind, detail as Team);
      slot = { key, id: null, root, armament: root.getObjectByName('armament') as Group | undefined };
    }
    slot.root.visible = false; this.detailSlots.push(slot); this.scene.add(slot.root);
    return slot;
  }

  private unitRotation(unit: Unit): Quaternion {
    if (unit.kind === 'aircraft') {
      const pitch = unit.pitch ?? Math.atan2(unit.velocity.y, Math.hypot(unit.velocity.x, unit.velocity.z));
      return this.rotation.setFromEuler(new Euler(pitch, unit.heading, -(unit.bank ?? 0), 'YXZ'));
    }
    const groundNormal = bridgeAt(unit.position.x, unit.position.z) ? { x: 0, y: 1, z: 0 } : terrainNormal(unit.position.x, unit.position.z);
    this.normal.set(groundNormal.x, groundNormal.y, groundNormal.z);
    this.rotation.setFromUnitVectors(UP, this.normal);
    return this.rotation.multiply(new Quaternion().setFromAxisAngle(UP, unit.heading));
  }

  private aimRotation(unit: Unit, hull: Quaternion, combat?: BattleCombatView): Quaternion {
    const aim = unit.kind === 'tank' ? combat?.turrets?.get(unit.id) : combat?.aa?.get(unit.id)?.direction;
    if (!aim) return this.weaponRotation.copy(hull);
    this.direction.set(aim.x, aim.y, aim.z).normalize();
    return this.weaponRotation.setFromUnitVectors(FORWARD, this.direction);
  }

  private updateUnits(mission: Mission, dt: number, combat?: BattleCombatView): void {
    const detailed = selectDetailedUnitIds(mission.units, mission.controlledAircraftId, this.camera.position, this.lod);
    for (const [id, slot] of this.assigned) if (!detailed.has(id)) {
      slot.id = null; slot.root.visible = false; this.assigned.delete(id);
    }
    const counts = new Map<string, number>();
    this.lastActiveCount = 0; this.renderedLowCount = 0;
    for (const unit of mission.units) {
      if (unit.state !== 'active' || unit.hp <= 0) continue;
      this.lastActiveCount++;
      this.position.set(unit.position.x, unit.position.y, unit.position.z);
      const rotation = this.unitRotation(unit);
      if (detailed.has(unit.id)) {
        const team = unit.team === mission.playerTeam ? 'friendly' : 'enemy';
        const key = unit.kind === 'aircraft' ? `aircraft:${unit.id === mission.controlledAircraftId ? 'hero' : 'enemy'}:${team}` : `${unit.kind}:${unit.team}`;
        let slot = this.assigned.get(unit.id);
        if (slot?.key !== key) {
          if (slot) { slot.id = null; slot.root.visible = false; this.assigned.delete(unit.id); }
          slot = this.acquireSlot(key); slot.id = unit.id; this.assigned.set(unit.id, slot);
        }
        slot.root.visible = true; slot.root.position.copy(this.position); slot.root.quaternion.copy(rotation);
        if (slot.armament) {
          this.aimRotation(unit, rotation, combat);
          slot.armament.quaternion.copy(rotation).invert().multiply(this.weaponRotation);
        }
        if (slot.aircraft) {
          const speed = unit.speed ?? Math.hypot(unit.velocity.x, unit.velocity.y, unit.velocity.z);
          slot.aircraft.propeller.rotation.z = (slot.aircraft.propeller.rotation.z + dt * (34 + Math.min(8, speed * .035))) % (Math.PI * 2);
          const d = Math.max(-.3, Math.min(.3, (unit.bank ?? 0) * .34));
          slot.aircraft.ailerons[0].rotation.x = d; slot.aircraft.ailerons[1].rotation.x = -d;
          slot.aircraft.elevator.rotation.x = Math.max(-.26, Math.min(.26, -(unit.pitch ?? 0) * .32));
        }
      } else if (unit.kind !== 'aircraft') {
        const key = `${unit.kind}:${unit.team}`, count = counts.get(key) ?? 0;
        const batch = this.groundInstances.get(key)!;
        if (count >= CAP[unit.kind]) continue;
        batch.setMatrixAt(count, this.matrix.compose(this.position, rotation, UNIT_SCALE));
        const armament = this.armamentInstances.get(key);
        if (armament) {
          this.weaponPosition.set(0, unit.kind === 'tank' ? 1.89 : 2.21, unit.kind === 'tank' ? -.22 : -.03)
            .applyQuaternion(rotation).add(this.position);
          this.aimRotation(unit, rotation, combat);
          armament.setMatrixAt(count, this.matrix.compose(this.weaponPosition, this.weaponRotation, UNIT_SCALE));
        }
        counts.set(key, count + 1); this.renderedLowCount++;
      }
    }
    for (const [key, batch] of this.groundInstances) {
      batch.count = counts.get(key) ?? 0; batch.instanceMatrix.needsUpdate = true;
    }
    for (const [key, batch] of this.armamentInstances) {
      batch.count = counts.get(key) ?? 0; batch.instanceMatrix.needsUpdate = true;
    }
  }

  private updatePoints(mission: Mission): void {
    for (const point of mission.points) {
      let visual = this.pointVisuals.get(point.id);
      if (!visual) { visual = this.makeCapturePoint(point); this.pointVisuals.set(point.id, visual); this.scene.add(visual.root); }
      const color = point.contested ? 0xf1cc77 : point.owner === 'N' ? TEAM_COLORS.neutral
        : point.owner === mission.playerTeam ? TEAM_COLORS.friendly : TEAM_COLORS.enemy;
      visual.material.color.setHex(color); visual.flag.material.color.setHex(color);
      visual.material.opacity = point.contested ? .75 : .55;
    }
  }

  private makeCapturePoint(point: CapturePoint): CaptureVisual {
    const root = new Group(); root.name = `capture-${point.id}`;
    root.position.set(point.position.x, point.position.y, point.position.z);
    const vertices: number[] = [];
    for (let i = 0; i < 64; i++) {
      const angle = i / 64 * Math.PI * 2, x = point.position.x + Math.cos(angle) * 80, z = point.position.z + Math.sin(angle) * 80;
      vertices.push(x - point.position.x, walkableSurface(x, z).height - point.position.y + .22, z - point.position.z);
    }
    const geometry = new BufferGeometry(); geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
    const material = new LineBasicMaterial({ color: TEAM_COLORS.neutral, transparent: true, opacity: .55 });
    const ring = new LineLoop(geometry, material);
    const pole = new Mesh(new CylinderGeometry(.14, .17, 16, 8), new MeshStandardMaterial({ color: 0x667a74, roughness: .8 }));
    pole.position.y = 8;
    const flag = new Mesh(new BoxGeometry(5, 2.7, .12), new MeshBasicMaterial({ color: TEAM_COLORS.neutral }));
    flag.position.set(2.5, 14, 0); root.add(ring, pole, flag);
    return { root, ring, material, flag };
  }

  private updateProjectiles(projectiles: readonly Projectile[], playerTeam: Team): void {
    this.visualBullets.length = 0;
    let groundCount = 0, bombCount = 0, tracerCount = 0;
    for (const round of projectiles) {
      if (round.lifeTicks <= 0) continue;
      if (round.weapon === 'bomb') {
        if (bombCount >= BOMB_CAPACITY) continue;
        this.normal.set(round.velocity.x, round.velocity.y, round.velocity.z).normalize();
        if (this.normal.lengthSq() < .1) this.normal.set(0, -1, 0);
        this.rotation.setFromUnitVectors(UP, this.normal);
        this.position.set(round.position.x, round.position.y, round.position.z);
        this.bombs.setMatrixAt(bombCount++, this.matrix.compose(this.position, this.rotation, UNIT_SCALE));
      } else if (round.weapon === 'mg' || round.weapon === 'cannon') {
        const index = this.visualBullets.length;
        if (tracerCount >= VISUAL_TRACER_CAPACITY) continue;
        tracerCount++;
        let bullet = this.reusableBullets[index];
        if (!bullet) {
          bullet = { id: 0, owner: 0, team: 'friendly', position: new Vector3(), previous: new Vector3(),
            velocity: new Vector3(), life: 0, damage: 0, kind: 'mg' };
          this.reusableBullets[index] = bullet;
        }
        bullet.id = round.shotId; bullet.owner = round.ownerId; bullet.team = round.team === playerTeam ? 'friendly' : 'enemy';
        bullet.position.set(round.position.x, round.position.y, round.position.z);
        bullet.previous.set(round.previous.x, round.previous.y, round.previous.z);
        bullet.velocity.set(round.velocity.x, round.velocity.y, round.velocity.z);
        bullet.life = round.lifeTicks / 60; bullet.kind = round.weapon;
        this.visualBullets.push(bullet);
      } else {
        if (tracerCount >= VISUAL_TRACER_CAPACITY) continue;
        tracerCount++;
        const tail = round.weapon === 'tank' ? .055 : round.weapon === 'aa' ? .025 : .022;
        const offset = groundCount++ * 6;
        this.tracerPositions.set([round.position.x - round.velocity.x * tail, round.position.y - round.velocity.y * tail,
          round.position.z - round.velocity.z * tail, round.position.x, round.position.y, round.position.z], offset);
        const color = round.team === playerTeam ? [1, .83, .42] : [1, .32, .11];
        this.tracerColors.set([...color, ...color], offset);
      }
    }
    this.aircraftTracers.update(this.visualBullets);
    this.bombs.count = bombCount; this.bombs.instanceMatrix.needsUpdate = true;
    this.tracerGeometry.setDrawRange(0, groundCount * 2);
    this.tracerGeometry.attributes.position.needsUpdate = true;
    this.tracerGeometry.attributes.color.needsUpdate = true;
  }

  private consumeEvents(mission: Mission, events: readonly CombatEvent[]): void {
    if (this.pendingMissionId !== mission.missionId) this.pendingEvents.length = 0;
    for (const event of [...this.pendingEvents, ...events].sort((a, b) => a.tick - b.tick)) {
      if (event.tick < this.lastEventTick) continue;
      if (event.tick > this.lastEventTick) { this.lastEventTick = event.tick; this.seenEvents.clear(); }
      const key = `${event.tick}:${event.type}:${event.shotId ?? ''}:${event.ownerId}:${event.targetId ?? ''}:${event.weapon}`;
      if (this.seenEvents.has(key)) continue;
      this.seenEvents.add(key);
      if (event.type === 'explosion') this.emitParticles(event.position, event.tick / 60, event.shotId ?? event.tick, 20, 12);
      else if (event.type === 'impact') this.emitParticles(event.position, event.tick / 60, event.shotId ?? event.tick, 3, 2);
      else if (event.type === 'shot') this.emitParticles(event.position, event.tick / 60, event.shotId ?? event.tick, 1,
        event.weapon === 'tank' ? 4 : event.weapon === 'bomb' ? 0 : 1.2);
    }
    this.pendingEvents.length = 0;
    this.pendingMissionId = mission.missionId;
    for (const death of mission.deaths) {
      if (this.seenDeaths.has(death.unitId)) continue;
      this.seenDeaths.add(death.unitId);
      const unit = mission.units.find(unit => unit.id === death.unitId);
      if (unit) this.emitParticles(unit.position, death.tick / 60, hashString(death.unitId), unit.kind === 'infantry' ? 2 : 12,
        unit.kind === 'aircraft' ? 8 : unit.kind === 'infantry' ? 1 : 5);
    }
  }

  private emitParticles(position: Vec3, born: number, seed: number, count: number, size: number): void {
    if (size <= 0) return;
    let next = seed >>> 0;
    const random = () => { next = (next * 1664525 + 1013904223) >>> 0; return next / 4294967296; };
    for (const particle of this.particles) {
      if (count <= 0) break;
      if (particle.active && this.visualTime - particle.born < particle.life) continue;
      count--; particle.active = true;
      particle.x = position.x; particle.y = position.y; particle.z = position.z;
      particle.vx = (random() - .5) * size * 4;
      particle.vy = random() * size * 2.5; particle.vz = (random() - .5) * size * 4;
      particle.born = born; particle.life = size > 4 ? .9 + random() * .8 : .1 + random() * .15;
      particle.size = size * (.3 + random() * .8);
      particle.red = 1; particle.green = .36 + random() * .4; particle.blue = .07;
      particle.gravity = size > 4 ? 4 : 0;
    }
  }

  private updateParticles(projectiles: readonly Projectile[]): void {
    let count = 0;
    for (const particle of this.particles) {
      if (!particle.active) continue;
      const age = Math.max(0, this.visualTime - particle.born);
      if (age >= particle.life) { particle.active = false; continue; }
      const offset = count * 3;
      this.particlePositions.set([particle.x + particle.vx * age, particle.y + particle.vy * age - age * age * particle.gravity,
        particle.z + particle.vz * age], offset);
      this.particleColors.set([particle.red, particle.green, particle.blue], offset);
      this.particleOpacity[count] = 1 - age / particle.life;
      this.particleSizes[count] = particle.size * (1 + age * .4); count++;
    }
    for (const round of projectiles) {
      if (round.weapon !== 'aa' || round.lifeTicks <= 0 || count >= POINT_CAPACITY) continue;
      this.particlePositions.set([round.position.x, round.position.y, round.position.z], count * 3);
      this.particleColors.set([1, .64, .22], count * 3);
      this.particleOpacity[count] = .9; this.particleSizes[count] = -2.4; count++;
    }
    this.particleGeometry.setDrawRange(0, count);
    for (const attribute of Object.values(this.particleGeometry.attributes)) attribute.needsUpdate = true;
  }

  private drawOverlay(mission: Mission, mode: GameMode, combat: BattleCombatView | undefined, show: boolean): void {
    const c = this.ctx, w = this.width, h = this.height;
    if (!c) return;
    c.clearRect(0, 0, w, h); c.shadowBlur = 0;
    this.overlayLabels = null;
    if (!show) return;
    this.overlayLabels = compactOverlayLabels(c.canvas, w, h);
    const player = this.flightPlayer;
    if (player) {
      const targets = targetsForFlight(mission, player);
      const sight = mode === 'normal' ? projectGunSight(player, targets, w, h) : { x: w / 2, y: h / 2 };
      const radius = mode === 'normal' ? Math.max(26, Math.min(38, Math.min(w, h) * .085)) : Math.min(w, h) * EASY_AIM_RADIUS;
      this.overlayLabels?.reserve({ x: sight.x - radius - 8, y: sight.y - radius - 8, width: 2 * (radius + 8), height: 2 * (radius + 8) });
      let aimColor = '#ffffff';
      for (const target of targets) {
        const projection = projectFlightTarget(player, targetAimPoint(target), w / h, mode);
        if (!projection.visible || Math.hypot((projection.x * .5 + .5) * w - sight.x, (.5 - projection.y * .5) * h - sight.y) > radius) continue;
        if (target.team === 'friendly') { aimColor = '#6cb8ff'; break; }
        aimColor = '#ff645b';
      }
      // Fixed-source circle, bore sight, colors and reload annulus.
      c.strokeStyle = aimColor; c.lineWidth = 1;
      c.beginPath(); c.arc(sight.x, sight.y, radius, 0, Math.PI * 2);
      if (mode === 'normal') {
        c.moveTo(sight.x - radius - 6, sight.y); c.lineTo(sight.x - radius + 5, sight.y);
        c.moveTo(sight.x + radius - 5, sight.y); c.lineTo(sight.x + radius + 6, sight.y);
        c.moveTo(sight.x, sight.y - radius - 6); c.lineTo(sight.x, sight.y - radius + 5);
        c.moveTo(sight.x, sight.y + radius - 5); c.lineTo(sight.x, sight.y + radius + 6);
        c.strokeStyle = 'rgba(3,25,39,.65)'; c.lineWidth = 2; c.stroke();
        c.strokeStyle = aimColor; c.lineWidth = 1;
      }
      c.stroke(); c.fillStyle = aimColor; c.fillRect(sight.x - 1, sight.y - 1, 2, 2);
      const unit = mission.units.find(unit => unit.id === player.id)!;
      if (unit.reloadUntil > mission.tick) {
        const progress = 1 - (unit.reloadUntil - mission.tick) / 360;
        c.strokeStyle = 'rgba(7,30,43,.8)'; c.lineWidth = 5;
        c.beginPath(); c.arc(sight.x, sight.y, radius + 7, 0, Math.PI * 2); c.stroke();
        c.strokeStyle = '#ffd27a'; c.lineWidth = 3;
        c.beginPath(); c.arc(sight.x, sight.y, radius + 7, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2); c.stroke();
      }
      if (this.overlayLabels) {
        this.drawAAWarnings(c, mission, combat?.aaWarnings ?? []);
        this.drawBoundaryWarning(c, unit);
        this.drawBombGuide(c);
        this.drawTargets(c, mission, player);
      } else {
        this.drawBombGuide(c);
        this.drawTargets(c, mission, player);
        this.drawAAWarnings(c, mission, combat?.aaWarnings ?? []);
        this.drawBoundaryWarning(c, unit);
      }
    }
    this.drawPointLabels(c, mission);
    this.drawRadar(c, mission);
  }

  private drawTargets(c: CanvasRenderingContext2D, mission: Mission, player: Aircraft): void {
    c.shadowColor = 'rgba(0,20,30,.9)'; c.shadowBlur = 3;
    c.font = '600 11px system-ui'; c.textAlign = 'center';
    for (const target of targetsForFlight(mission, player)) {
      const world = targetAimPoint(target), distance = world.distanceTo(player.position);
      if (distance > 1500) continue;
      const projection = this.project(world);
      if (!projection.visible || Math.abs(projection.nx) > .94 || Math.abs(projection.ny) > .82) continue;
      const { x, y } = projection, friendly = target.team === 'friendly';
      c.strokeStyle = friendly ? '#77dacb' : '#ffb28b'; c.fillStyle = c.strokeStyle; c.lineWidth = 1.25;
      c.beginPath();
      if (friendly) c.arc(x, y, 4, 0, Math.PI * 2);
      else if (target.kind !== 'aircraft') c.rect(x - 5, y - 4, 10, 8);
      else { c.moveTo(x, y - 6); c.lineTo(x + 5, y); c.lineTo(x, y + 6); c.lineTo(x - 5, y); c.closePath(); }
      c.stroke();
      if (!friendly) {
        const text = `${target.kind === 'tank' ? '戦車 ' : target.kind === 'aa' ? '対空 ' : ''}${Math.round(distance)}m`;
        const label = overlayTextPosition(this.overlayLabels, c, text, x, y + 28, 7, 38);
        c.fillStyle = 'rgba(7,24,32,.8)'; c.fillRect(label.x - 19, label.y - 16, 38, 3);
        c.fillStyle = '#ffc69b'; c.fillRect(label.x - 19, label.y - 16, 38 * target.health / target.maxHealth, 3);
        c.fillStyle = '#f4e3c8';
        if (this.overlayLabels) overlayLabelLeader(c, { x, y }, label);
        c.fillText(text, label.x, label.y);
      }
    }
    c.shadowBlur = 0;
  }

  private drawBombGuide(c: CanvasRenderingContext2D): void {
    if (!this.bombGuide) return;
    const guide = this.bombGuide, projection = this.project(guide.position);
    if (!projection.visible || Math.abs(projection.nx) >= .94 || Math.abs(projection.ny) >= .82) return;
    const { x, y } = projection;
    c.save(); c.strokeStyle = guide.effective ? '#88ffad' : '#eef5ee'; c.fillStyle = c.strokeStyle; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(x - 8, y); c.lineTo(x + 8, y); c.moveTo(x, y - 8); c.lineTo(x, y + 8); c.stroke();
    c.globalAlpha = .65; c.setLineDash([3, 3]); c.lineWidth = 1; c.beginPath();
    for (let i = 0; i <= 32; i++) {
      const angle = i / 32 * Math.PI * 2;
      const edge = this.project({ x: guide.position.x + Math.cos(angle) * 60, y: guide.position.y, z: guide.position.z + Math.sin(angle) * 60 });
      if (i === 0) c.moveTo(edge.x, edge.y); else c.lineTo(edge.x, edge.y);
    }
    c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
    c.font = '600 10px system-ui'; c.textAlign = 'left';
    const label = `爆弾の落下目安 · ${guide.time.toFixed(1)}秒`, labelWidth = Math.ceil(c.measureText(label).width) + 12;
    const preferredX = x + 32 + labelWidth < this.width - 12 ? x + 32 : x - 32 - labelWidth;
    const preferredY = Math.max(76, Math.min(this.height - 60, y - 36));
    const labelBox = this.overlayLabels?.place({ x: preferredX, y: preferredY, width: labelWidth, height: 20 });
    const labelX = labelBox?.x ?? preferredX, labelY = labelBox?.y ?? preferredY;
    c.strokeStyle = 'rgba(183,239,206,.55)'; c.lineWidth = .75;
    c.beginPath(); c.moveTo(x + (labelX > x ? 9 : -9), y); c.lineTo(labelX > x ? labelX : labelX + labelWidth, labelY + 19); c.stroke();
    c.fillStyle = 'rgba(4,24,34,.78)'; c.fillRect(labelX, labelY, labelWidth, 20);
    c.fillStyle = '#d1ffe3'; c.fillText(label, labelX + 6, labelY + 14); c.restore();
  }

  private drawAAWarnings(c: CanvasRenderingContext2D, mission: Mission, warnings: readonly ViewAAWarning[]): void {
    const active = warnings.filter(warning => warning.targetId === mission.controlledAircraftId);
    if (!active.length) return;
    c.save(); c.font = '600 11px system-ui'; c.textAlign = 'center'; c.fillStyle = '#ffd27a';
    const text = `対空照準 ${active.length}門`;
    const label = overlayTextPosition(this.overlayLabels, c, text, this.width / 2, Math.max(80, this.height * .16));
    c.fillText(text, label.x, label.y);
    for (const warning of active) {
      const projection = this.project(warning.position);
      let dx = projection.x - this.width / 2, dy = projection.y - this.height / 2;
      if (projection.depth > 1) { dx = -dx; dy = -dy; }
      const length = Math.hypot(dx, dy) || 1, radius = Math.min(this.width, this.height) * .27;
      const x = this.width / 2 + dx / length * radius, y = this.height / 2 + dy / length * radius;
      const angle = Math.atan2(dy, dx);
      c.save(); c.translate(x, y); c.rotate(angle); c.beginPath();
      c.moveTo(8, 0); c.lineTo(-5, -4); c.lineTo(-5, 4); c.closePath(); c.fill(); c.restore();
    }
    c.restore();
  }

  private drawBoundaryWarning(c: CanvasRenderingContext2D, unit: Unit): void {
    const b = BATTLEFIELD.bounds, p = unit.position;
    if (p.x > b.minX + 300 && p.x < b.maxX - 300 && p.z > b.minZ + 300 && p.z < b.maxZ - 300 && p.y < b.maxY - 300) return;
    c.save(); c.fillStyle = '#ffd27a'; c.font = '600 12px system-ui'; c.textAlign = 'center';
    const text = '作戦空域の境界 · 内側へ旋回';
    const label = overlayTextPosition(this.overlayLabels, c, text, this.width / 2, Math.max(104, this.height * .21));
    c.fillText(text, label.x, label.y); c.restore();
  }

  private drawPointLabels(c: CanvasRenderingContext2D, mission: Mission): void {
    c.save(); c.font = '600 10px system-ui'; c.textAlign = 'center';
    for (const point of mission.points) {
      const projection = this.project({ ...point.position, y: point.position.y + 23 });
      if (!projection.visible || Math.abs(projection.nx) > .94 || Math.abs(projection.ny) > .75) continue;
      c.fillStyle = point.contested ? '#ffd27a' : point.owner === 'N' ? '#e4c88b' : point.owner === mission.playerTeam ? '#77dacb' : '#ffb28b';
      c.shadowColor = 'rgba(4,24,34,.9)'; c.shadowBlur = 4;
      const text = `${point.id}${point.contested ? ' 競合' : point.phase !== 'stable' ? ` ${Math.round(point.progress * 100)}%` : ''}`;
      const label = overlayTextPosition(this.overlayLabels, c, text, projection.x, projection.y);
      if (this.overlayLabels) overlayLabelLeader(c, projection, label);
      c.fillText(text, label.x, label.y);
    }
    c.restore();
  }

  private drawRadar(c: CanvasRenderingContext2D, mission: Mission): void {
    const w = this.width, h = this.height, r = w < 360 ? 42 : 49, x = w - r - 18, y = Math.min(h * .33, 180);
    const player = mission.units.find(unit => unit.id === mission.controlledAircraftId);
    const origin = player?.position ?? { x: 0, y: 0, z: 0 }, heading = player?.heading ?? 0;
    const cy = Math.cos(heading), sy = Math.sin(heading), range = 2400;
    c.save(); c.translate(x, y); c.fillStyle = 'rgba(4,24,34,.66)'; c.strokeStyle = 'rgba(150,212,211,.36)'; c.lineWidth = 1;
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill(); c.stroke();
    c.beginPath(); c.arc(0, 0, r / 2, 0, Math.PI * 2); c.moveTo(-r, 0); c.lineTo(r, 0); c.moveTo(0, -r); c.lineTo(0, r); c.stroke();
    const dot = (position: Vec3) => {
      const dx = position.x - origin.x, dz = position.z - origin.z;
      let px = (dx * cy - dz * sy) / range * r, py = (dx * sy + dz * cy) / range * r;
      const distance = Math.hypot(px, py);
      if (distance > r - 4) { px *= (r - 4) / distance; py *= (r - 4) / distance; }
      return { px, py, distance };
    };
    for (const point of mission.points) {
      const { px, py } = dot(point.position);
      c.strokeStyle = point.contested ? '#ffd27a' : point.owner === 'N' ? '#e4c88b' : point.owner === mission.playerTeam ? '#70d8c7' : '#ffb78c';
      c.strokeRect(px - 3, py - 3, 6, 6);
    }
    for (const unit of mission.units) {
      if (unit.state !== 'active' || unit.hp <= 0 || unit.id === mission.controlledAircraftId) continue;
      const { px, py, distance } = dot(unit.position), friendly = unit.team === mission.playerTeam;
      c.fillStyle = friendly ? '#70d8c7' : '#ffb78c'; c.strokeStyle = c.fillStyle; c.beginPath();
      if (unit.kind === 'tank' || unit.kind === 'aa') c.rect(px - 2.5, py - 1.5, 5, 3);
      else if (friendly || unit.kind === 'infantry') c.arc(px, py, unit.kind === 'infantry' ? 1 : 2.2, 0, 7);
      else { c.moveTo(px, py - 3); c.lineTo(px + 3, py); c.lineTo(px, py + 3); c.lineTo(px - 3, py); c.closePath(); }
      if (distance > r - 4) c.stroke(); else c.fill();
    }
    c.fillStyle = '#fff4ce'; c.beginPath(); c.moveTo(0, -5); c.lineTo(3, 4); c.lineTo(0, 2); c.lineTo(-3, 4); c.closePath(); c.fill();
    c.fillStyle = '#b8cfce'; c.font = '9px system-ui'; c.textAlign = 'center'; c.fillText('2.4km', 0, r + 13); c.restore();
  }

  diagnostics() {
    return { queue: this.queue.diagnostics(performance.now()), calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles, geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures, detailed: this.assigned.size, detailPool: this.detailSlots.length,
      detailedCapacity: DETAIL_CAPACITY, instances: this.renderedLowCount, active: this.lastActiveCount,
      unitViewCapacity: UNIT_VIEW_CAPACITY, particles: this.particles.filter(particle => particle.active).length,
      particleCapacity: EFFECT_CAPACITY, visualTracerCapacity: VISUAL_TRACER_CAPACITY,
      bombCount: this.bombs.count, lod: this.lod, tracers: this.aircraftTracers.diagnostics() };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.queue.dispose();
    for (const slot of this.detailSlots) slot.root.removeFromParent();
    this.detailSlots.length = 0; this.assigned.clear();
    this.aircraftBatches.dispose(); this.aircraft.dispose(); this.aircraftTracers.dispose();
    this.teamBandGeometry.dispose(); this.teamMaterials.friendly.dispose(); this.teamMaterials.enemy.dispose();
    for (const batch of this.groundInstances.values()) batch.dispose();
    for (const batch of this.armamentInstances.values()) batch.dispose();
    this.armamentInstances.clear();
    this.groundInstances.clear(); this.ground.dispose(); this.landscape.dispose();
    this.sky.geometry.dispose(); this.sky.material.dispose();
    this.tracerGeometry.dispose(); this.groundTracers.material.dispose();
    this.bombs.dispose(); this.bombGeometry.dispose(); this.bombMaterial.dispose();
    this.particleGeometry.dispose(); this.points.material.dispose();
    for (const visual of this.pointVisuals.values()) {
      visual.root.traverse(object => {
        if (object instanceof Mesh || object instanceof LineLoop) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
          else object.material.dispose();
        }
      });
      visual.root.removeFromParent();
    }
    this.pointVisuals.clear(); this.seenEvents.clear(); this.seenDeaths.clear(); this.pendingEvents.length = 0;
    this.visualBullets.length = this.reusableBullets.length = 0;
    this.scene.clear(); this.renderer.renderLists.dispose(); this.renderer.dispose();
    this.ctx?.clearRect(0, 0, this.width, this.height);
  }
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}
