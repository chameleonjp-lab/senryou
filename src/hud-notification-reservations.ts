/** Source-format reservations, not claims of naturally reached campaign states.
 * combat.ts updateAA: two slots/target; weapons.ts: gun360/bomb1200 ticks;
 * projectiles.ts FIXED_DT=1/60, prediction1800 ticks; scoring.ts: respawn300;
 * flight.ts LOOP_COOLDOWN=2; ground-ai.ts ensurePath: longest failure reason.
 */
export const HUD_TEXT_BOUNDS=Object.freeze({aaPerTarget:2,gunReloadSeconds:6,bombReloadSeconds:20,predictionSeconds:30,loopSeconds:2,respawnSeconds:5,groundCount:272});
export const LONGEST_GROUND_REASON='全経路閉塞・後方待避を待機';
export type HudReservationPhase='flying'|'waiting'|'spectating';
export interface HudReservationText {id:string;phase:HudReservationPhase;warning:string;reload:string;payload:string;status:string;bombAmmo:string;bombHint:string;loop:string}
const ground=` 経路待機 ${HUD_TEXT_BOUNDS.groundCount}体 · ${LONGEST_GROUND_REASON}`;
const warning=`対空 照準予告 ${HUD_TEXT_BOUNDS.aaPerTarget}門 · 方位360° / 低空注意 · 機首を上げて / 空域境界 · 内側へ旋回`;
export function notificationReservations(phase:HudReservationPhase):readonly HudReservationText[]{
 if(phase!=='flying')return [{id:phase,phase,warning:'',reload:'',payload:'',status:(phase==='waiting'?'復帰待ち · 安全な出撃回廊を確認中':'観戦 · 航空戦力なし・地上戦を観戦')+' · 5.0秒'+ground,bombAmmo:'残り0発',bombHint:'予測なし',loop:'すぐ使える'}];
 const common={phase,warning,reload:'機銃・機関砲 装填 6.0秒',status:ground,bombAmmo:'装填 20.0秒',loop:'待ち 2.0秒'};
 return [
  {...common,id:'flying-effective',payload:'爆弾予測：敵地上軍の60m内 · 命中保証ではありません',bombHint:'有効圏 30.0秒'},
  {...common,id:'flying-ineffective',payload:'',bombHint:'地形着弾 30.0秒'},
  {...common,id:'flying-no-prediction',payload:'',bombHint:'予測なし'},
 ];
}
/** Inactive states share one reservation family. Ground warnings remain in both. */
export function reservationFamily(phase:HudReservationPhase):'flying'|'inactive'{return phase==='flying'?'flying':'inactive';}
export function reservationStatesForFamily(phase:HudReservationPhase):readonly HudReservationText[]{return phase==='flying'?notificationReservations('flying'):[...notificationReservations('waiting'),...notificationReservations('spectating')];}
export function reservationPhase(hasActiveControlledPlayer:boolean,status:string):HudReservationPhase{return hasActiveControlledPlayer?'flying':status==='spectating'?'spectating':'waiting';}

/** Stable control labels are independent of warning/guide coexistence. Include
 * ready wording even while a cooldown is currently active (roster bombs <=2).
 */
export const READY_CONTROL_TEXT={loop:'すぐ使える',bombAmmo:'残り2発',bombHint:'予測なし'} as const;

/** Matches main.hud: empty payload/status remain grid items. */
export function notificationHidden(id:string,text:string):boolean{return (id==='warning'||id==='reload-status')&&!text;}
