import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Quaternion, Vector3 } from 'three';
import { hudSightReservation } from '../src/hud-sight-reservation';
import { projectGunSight } from '../src/gun-sight';
import type { Aircraft } from '../src/types';

test('Normal layout guard contains the whole banked bore-sight envelope and reticle margin',()=>{
  for(const [w,h] of [[393,852],[393,648],[568,320],[852,393],[1280,720]]){
    const r=hudSightReservation('normal',w,h),radius=Math.max(26,Math.min(38,Math.min(w,h)*.085))+8;
    assert.notEqual(r.y,h/2);
    for(let i=-72;i<=72;i++)for(const pitch of [-Math.PI,-1,0,1,Math.PI]){
      const bank=i/100,p:Aircraft={kind:'aircraft',id:1,team:'friendly',role:'player',position:new Vector3(400,300,-700),previous:new Vector3(),quaternion:new Quaternion().setFromEuler(new Euler(pitch,1.3,-bank,'YXZ')),yaw:1.3,pitch,bank,speed:110,health:80,maxHealth:80,loopProgress:0,loopCooldown:0};
      const sight=projectGunSight(p,[],w,h);
      assert.ok(Math.abs(sight.x-r.x)+radius<=r.width/2+1e-8);
      assert.ok(Math.abs(sight.y-r.y)+radius<=r.height/2+1e-8);
    }
  }
});
test('Easy reserves precisely its real circle plus eight CSS pixels',()=>{
  assert.deepEqual(hudSightReservation('easy',400,600),{x:200,y:300,width:124,height:124});
});
