import {
  BoxGeometry, BufferGeometry, Color, Float32BufferAttribute, Group, InstancedMesh,
  Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3, type Material,
} from 'three';
import { BATTLEFIELD, TERRAIN_SOLIDS, terrainHeight, walkableSurface } from './battle/terrain';

/** Land geometry samples the authoritative height field; buildings and bridges
 * draw its exact closed collider boxes. No view geometry is a physics input.
 */
export class BattleLandscape {
  readonly root = new Group();
  private geometries = new Set<BufferGeometry>();
  private materials = new Set<Material>();
  private instanceMeshes: InstancedMesh[] = [];
  private disposed = false;

  constructor() {
    this.root.name = 'land-battlefield';
    const ground = this.material(new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
    const terrain = this.geometry(makeTerrainGeometry());
    this.root.add(new Mesh(terrain, ground));
    const roads = this.geometry(makeRoadGeometry());
    this.root.add(new Mesh(roads, this.material(new MeshStandardMaterial({ color: 0x8d8871, roughness: 1 }))));

    const waterMaterial = this.material(new MeshStandardMaterial({ color: 0x315b64, roughness: .38,
      metalness: .18, transparent: true, opacity: .87 }));
    const water = this.geometry(makeWaterGeometry());
    this.root.add(new Mesh(water, waterMaterial));

    const boxGeometry = this.geometry(new BoxGeometry(1, 1, 1));
    const groups = [
      { boxes: TERRAIN_SOLIDS.filter(box => box.id.startsWith('building-')), color: 0x868d7b },
      { boxes: TERRAIN_SOLIDS.filter(box => !box.id.startsWith('building-')), color: 0x8a8b79 },
    ];
    const matrix = new Matrix4(), rotation = new Quaternion(), scale = new Vector3(), position = new Vector3();
    for (const group of groups) {
      const mesh = new InstancedMesh(boxGeometry,
        this.material(new MeshStandardMaterial({ color: group.color, roughness: .94 })), group.boxes.length);
      group.boxes.forEach((box, i) => {
        position.set(box.center.x, box.center.y, box.center.z);
        scale.set(box.size.x, box.size.y, box.size.z);
        rotation.setFromAxisAngle(new Vector3(0, 1, 0), -box.yaw);
        mesh.setMatrixAt(i, matrix.compose(position, rotation, scale));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.root.add(mesh); this.instanceMeshes.push(mesh);
    }
  }

  private geometry<T extends BufferGeometry>(geometry: T): T { this.geometries.add(geometry); return geometry; }
  private material<T extends Material>(material: T): T { this.materials.add(material); return material; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of this.instanceMeshes) mesh.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.clear(); this.materials.clear(); this.root.clear();
  }
}

function makeTerrainGeometry(): BufferGeometry {
  const { bounds, rivers, trenches } = BATTLEFIELD;
  const axes = (min: number, max: number, additional: number[]): number[] => {
    const values = new Set<number>([min, max]);
    for (let value = min; value < max; value += 60) values.add(value);
    for (const value of additional) if (value >= min && value <= max) values.add(value);
    return [...values].sort((a, b) => a - b);
  };
  // River bank breakpoints and shallow trenches are explicit mesh vertices.
  const xs = axes(bounds.minX, bounds.maxX, rivers.flatMap(r => [r.minX, r.minX + 12, r.maxX - 12, r.maxX]));
  const zs = axes(bounds.minZ, bounds.maxZ, [
    ...rivers.flatMap(r => [r.minZ, r.minZ + 12, r.maxZ - 12, r.maxZ]),
    ...trenches.flatMap(t => [t.z - t.width / 2, t.z, t.z + t.width / 2]),
  ]);
  const positions = new Float32Array(xs.length * zs.length * 3);
  const colors = new Float32Array(positions.length);
  const indices: number[] = [];
  for (let j = 0; j < zs.length; j++) for (let i = 0; i < xs.length; i++) {
    const x = xs[i], z = zs[j], y = terrainHeight(x, z), index = (j * xs.length + i) * 3;
    positions.set([x, y, z], index);
    const variation = .045 * Math.sin(x * .019 + z * .007) + .03 * Math.sin(x * .004 - z * .018);
    const color = new Color().setRGB(.25 + variation, .31 + variation, .20 + variation * .6);
    if (y < 5) color.setRGB(.25, .24, .17);
    if (y > 55) color.lerp(new Color(.40, .40, .30), Math.min(.4, (y - 55) / 180));
    colors.set([color.r, color.g, color.b], index);
    if (i + 1 < xs.length && j + 1 < zs.length) {
      const a = j * xs.length + i, b = a + 1, c = a + xs.length, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

function makeRoadGeometry(): BufferGeometry {
  const vertices: number[] = [];
  for (const road of BATTLEFIELD.roads) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1], b = road.points[i], length = Math.hypot(b.x - a.x, b.z - a.z);
    const nx = -(b.z - a.z) / length * road.width / 2, nz = (b.x - a.x) / length * road.width / 2;
    const steps = Math.max(1, Math.ceil(length / 20));
    const side = (t: number, sign: number): number[] => {
      const x = a.x + (b.x - a.x) * t + nx * sign, z = a.z + (b.z - a.z) * t + nz * sign;
      return [x, walkableSurface(x, z, 'infantry').height + .035, z];
    };
    for (let step = 0; step < steps; step++) {
      const p = side(step / steps, -1), q = side(step / steps, 1);
      const r = side((step + 1) / steps, -1), s = side((step + 1) / steps, 1);
      vertices.push(...p, ...q, ...r, ...q, ...s, ...r);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

function makeWaterGeometry(): BufferGeometry {
  const vertices: number[] = [];
  for (const river of BATTLEFIELD.rivers) {
    // At y=0 the bank slopes intersect twelve metres inside the river bounds.
    const inset = 7.2;
    const a = [river.minX + inset, river.waterY, river.minZ + inset];
    const b = [river.maxX - inset, river.waterY, river.minZ + inset];
    const c = [river.minX + inset, river.waterY, river.maxZ - inset];
    const d = [river.maxX - inset, river.waterY, river.maxZ - inset];
    vertices.push(...a, ...c, ...b, ...b, ...c, ...d);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}
