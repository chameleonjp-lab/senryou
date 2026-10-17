import { Quaternion, Vector3 } from 'three';
import { projectGunSight } from './gun-sight';
import type { Aircraft, GameMode } from './types';
/** Reserve the fixed bore's complete camera-roll envelope. World attitude does
 * not change this projection, but optical-axis roll moves it with bank. On the
 * flight range [-.72,.72], horizontal extrema occur at the ends and the vertical
 * extrema at the ends or zero. This is layout calibration, not a simulated pilot.
 */
export function hudSightReservation(mode: GameMode, width: number, height: number) {
  const radius = mode === 'normal' ? Math.max(26, Math.min(38, Math.min(width, height) * .085)) : Math.min(width, height) * .135;
  if (mode === 'easy') return { x: width / 2, y: height / 2, width: 2 * (radius + 8), height: 2 * (radius + 8) };
  const calibration: Aircraft = { kind: 'aircraft', id: 'layout-calibration', team: 'friendly', role: 'player', position: new Vector3(), previous: new Vector3(), quaternion: new Quaternion(), yaw: 0, pitch: 0, bank: 0, speed: 110, health: 80, maxHealth: 80, loopProgress: 0, loopCooldown: 0 };
  const axis = new Vector3(0, 0, 1);
  const centers = [-.72, 0, .72].map(bank => {
    calibration.bank = bank;
    calibration.quaternion.setFromAxisAngle(axis, -bank);
    return projectGunSight(calibration, [], width, height);
  });
  const minX = Math.min(...centers.map(p => p.x)), maxX = Math.max(...centers.map(p => p.x));
  const minY = Math.min(...centers.map(p => p.y)), maxY = Math.max(...centers.map(p => p.y));
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, width: maxX - minX + 2 * (radius + 8), height: maxY - minY + 2 * (radius + 8) };
}
