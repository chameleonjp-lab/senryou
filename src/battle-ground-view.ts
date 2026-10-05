import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute,
  Group, Mesh, MeshStandardMaterial, SphereGeometry, type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Team, UnitKind } from './battle/types';

export type GroundKind = Exclude<UnitKind, 'aircraft'>;

/** Immutable, shared ground geometry. Unit IDs are owned by the battle ledger. */
export class GroundVisualFactory {
  private geometries = new Map<string, BufferGeometry>();
  private materials: Record<Team, MeshStandardMaterial> = {
    A: new MeshStandardMaterial({ color: 0x80988a, vertexColors: true, roughness: .88, metalness: .13 }),
    B: new MeshStandardMaterial({ color: 0xb19c7c, vertexColors: true, roughness: .88, metalness: .13 }),
  };
  private disposed = false;

  geometry(kind: GroundKind, detail: boolean, armament = false): BufferGeometry {
    const key = `${kind}:${detail}:${armament}`;
    let geometry = this.geometries.get(key);
    if (!geometry) {
      geometry = groundGeometry(kind, detail, armament);
      this.geometries.set(key, geometry);
    }
    return geometry;
  }

  material(team: Team): Material { return this.materials[team]; }

  create(kind: GroundKind, team: Team): Group {
    const root = new Group();
    root.name = `detailed-${kind}-${team}`;
    const body = new Mesh(this.geometry(kind, true), this.material(team));
    body.name = kind;
    root.add(body);
    if (kind !== 'infantry') {
      const armament = new Group(); armament.name = 'armament';
      armament.position.set(0, kind === 'tank' ? 1.89 : 2.21, kind === 'tank' ? -.22 : -.03);
      armament.add(new Mesh(this.geometry(kind, true, true), this.material(team)));
      root.add(armament);
    }
    return root;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const geometry of this.geometries.values()) geometry.dispose();
    for (const material of Object.values(this.materials)) material.dispose();
    this.geometries.clear();
  }
}

function groundGeometry(kind: GroundKind, detail: boolean, armament: boolean): BufferGeometry {
  const pieces: BufferGeometry[] = [];
  function part(geometry: BufferGeometry, x: number, y: number, z: number,
    shade = 1, rx = 0, ry = 0, rz = 0, moving = false): void {
    if (moving !== armament) { geometry.dispose(); return; }
    // Equal attributes allow one draw call per detailed or instanced unit.
    const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
    if (nonIndexed !== geometry) geometry.dispose();
    nonIndexed.rotateX(rx); nonIndexed.rotateY(ry); nonIndexed.rotateZ(rz);
    nonIndexed.translate(x, y - (armament ? kind === 'tank' ? 1.89 : 2.21 : 0), z - (armament ? kind === 'tank' ? -.22 : -.03 : 0));
    const count = nonIndexed.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    const color = new Color(shade, shade, shade);
    for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
    nonIndexed.setAttribute('color', new Float32BufferAttribute(colors, 3));
    pieces.push(nonIndexed);
  }
  if (kind === 'infantry') {
    // Feet at y=0, helmet at y=1.8; the simulation radius is .45 metres.
    part(new BoxGeometry(.42, .55, .26), 0, 1.13, 0, .9);
    part(new SphereGeometry(.135, detail ? 10 : 6, detail ? 7 : 4), 0, 1.58, -.01, 1.32);
    part(new SphereGeometry(.16, detail ? 10 : 6, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.62, 0, .54);
    for (const side of [-1, 1]) {
      part(new BoxGeometry(.14, .7, .16), side * .12, .49, 0, .55);
      part(new BoxGeometry(.17, .13, .27), side * .12, .07, -.06, .19);
      part(new BoxGeometry(.12, .46, .14), side * .26, 1.16, -.02, .72, side * -.18, 0, side * .16);
    }
    if (detail) {
      part(new BoxGeometry(.25, .35, .13), 0, 1.16, .19, .48);
      part(new BoxGeometry(.065, .07, .8), .25, 1.12, -.42, .2, -.09);
      part(new CylinderGeometry(.025, .025, .45, 6), .25, 1.14, -.85, .18, Math.PI / 2);
    }
  } else {
    const tank = kind === 'tank', width = tank ? 3 : 2.5, length = tank ? 6 : 5;
    part(new BoxGeometry(width * .77, .9, length * .9), 0, .87, 0, .88);
    part(new BoxGeometry(width * .68, .32, length * .72), 0, 1.47, -.08, .97);
    for (const side of [-1, 1]) {
      part(new BoxGeometry(width * .19, .84, length), side * width * .405, .53, 0, .25);
      if (detail) for (let i = 0; i < 6; i++) {
        part(new CylinderGeometry(.31, .31, width * .205, 10), side * width * .407, .53,
          -length * .37 + i * length * .148, .4, 0, 0, Math.PI / 2);
      }
    }
    if (tank) {
      part(new CylinderGeometry(1, 1.05, .65, detail ? 12 : 6), 0, 1.89, -.22, .8);
      part(new BoxGeometry(.8, .46, .58), 0, 1.98, -1.01, .72, 0, 0, 0, true);
      part(new CylinderGeometry(.105, .105, 2.45, detail ? 10 : 6), 0, 2.02, -2.43, .52, Math.PI / 2, 0, 0, true);
      if (detail) {
        part(new CylinderGeometry(.37, .37, .15, 12), .36, 2.27, -.08, .57);
        part(new CylinderGeometry(.025, .025, 1.5, 5), -.64, 2.85, .05, .22);
        part(new BoxGeometry(.12, .12, .44), .5, 2.22, -.74, .2);
      }
    } else {
      part(new CylinderGeometry(.86, .95, .25, detail ? 12 : 6), 0, 1.78, -.15, .58);
      part(new BoxGeometry(1.3, .94, .9), 0, 2.21, -.03, .75, 0, 0, 0, true);
      for (const side of [-1, 1]) {
        part(new CylinderGeometry(.085, .085, 2.05, detail ? 9 : 6), side * .33, 2.72, -1.24, .29,
          Math.PI / 2, 0, 0, true);
      }
      if (detail) {
        part(new BoxGeometry(.88, .13, .54), 0, 2.72, .23, .52, 0, 0, 0, true);
        part(new BoxGeometry(.38, .22, .52), .64, 2.04, .19, .46, 0, 0, 0, true);
      }
    }
  }
  const merged = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  if (!merged) throw new Error('Ground geometry could not be merged');
  merged.computeBoundingBox(); merged.computeBoundingSphere();
  return merged;
}
