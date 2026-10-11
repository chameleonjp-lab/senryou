import { Vector3, PerspectiveCamera } from 'three';
import { targetAimPoint } from '/src/flight-assist';
import { projectGunSight } from '/src/gun-sight';
import { EASY_AIM_RADIUS, FLIGHT_FOV, getFlightCameraPose, projectFlightTarget } from '/src/flight-view';
import type { Mission, Unit, Vec3 } from '/src/battle/types';
import type { GameMode, Aircraft } from '/src/types';
import type { BattleCombatView, ViewAAWarning, ViewBombGuide } from '/src/battle-view';
import type { DisplaySample } from '/browser-tests/ui-only/samples';
import { compactOverlayLabels, overlayTextPosition, overlayLabelLeader, type OverlayLabels } from '/src/overlay-labels';
// These display dependencies are fixed samples. They do not determine target eligibility or simulate physics.
export function createProductOverlay(canvas:HTMLCanvasElement, sample:()=>DisplaySample) {
 const targetsForFlight=(_mission:Mission,_player?:Aircraft)=>sample().targets;
 const BATTLEFIELD={bounds:/* PRODUCT_BOUNDS */};
 class ProductOverlay {
  private ctx=canvas.getContext('2d');
  private width=1; private height=1;
  private position=new Vector3();
  private camera=new PerspectiveCamera(FLIGHT_FOV,1,.5,22000);
  private flightPlayer:Aircraft|null=null;
  private bombGuide:ViewBombGuide|null=null;
  private overlayLabels:OverlayLabels|null=null;
  setBombGuide(guide:ViewBombGuide|null){this.bombGuide=guide;}
  resize(){const box=canvas.getBoundingClientRect();this.width=Math.max(1,box.width);this.height=Math.max(1,box.height);canvas.width=Math.round(this.width);canvas.height=Math.round(this.height);}
  render(mission:Mission,mode:GameMode,combat:BattleCombatView,show=true){
   this.resize();this.flightPlayer=mission.playerStatus==='flying'?sample().player:null;
   getFlightCameraPose(sample().player,mode,this.camera.position,this.camera.quaternion);this.camera.aspect=this.width/this.height;this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();
   this.drawOverlay(mission,mode,combat,show);
  }
  /* PRODUCT_METHODS */
 }
 return new ProductOverlay();
}
