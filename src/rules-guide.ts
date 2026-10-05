// Source: kaisen@3d751051dc6212482a129e8da596ddd349b2f9f5. See docs/PROVENANCE.md.
import type { GameMode } from './types';
import { containDialogTabFocus } from './dialog-focus';

export type GuideInput = 'touch' | 'keyboard';
export interface RulesContext { mode: GameMode; input: GuideInput; keyboardDescription: string; }
export interface RuleSection { heading: string; paragraphs: string[]; }

export function ruleSections({ mode, input, keyboardDescription }: RulesContext): RuleSection[] {
  return [
    { heading: 'ゲーム概要', paragraphs: [
      '戦闘機で地上軍を支援し、歩兵で敵本拠地を占領する陸上占領戦です。歩兵・戦車・対空砲・航空機は、画面の外でも同じ戦況で動きます。',
      '両軍の総戦力はそれぞれ歩兵240人、戦車24両、対空砲8両、航空機24機です。HUDの総残存は予備・出撃準備中・出撃中の合計で、出撃中の数とは異なります。初期出撃は各軍の歩兵72人、戦車8両、対空砲4両、航空機6機です。',
      'Aは味方、Bは敵、Nは中立です。7拠点はHA・P1・P2・P3・P4・P5・HB。競合は⚔、進行率は%で示します。↔は本拠地から供給接続がある拠点です。',
    ] },
    { heading: '勝利・敗北・引分', paragraphs: [
      '味方歩兵が敵本拠地HBを占領すると勝利、敵歩兵が味方本拠地HAを占領すると敗北です。空爆や戦車だけで敵を全滅させても占領にはなりません。',
      '両本拠地が同じ瞬間に占領されたとき、両軍の予備を含む全歩兵が失われたとき、20分に達したときは引分です。同時刻に敵本拠地の占領と20分が成立した場合は占領による勝利を優先します。片方の軍だけ歩兵がなくなっても作戦は続きます。',
      'Pauseの「作戦を終了」は中断です。一時停止中は作戦時間、移動、弾、装填、増援、占領、復帰が止まります。説明や設定を閉じても自動で再開しません。',
    ] },
    { heading: '歩兵の占領と供給接続', paragraphs: [
      '拠点の地表80m以内にいる生存歩兵だけが占領します。両軍の歩兵が1人以上いると競合になり、進行と減衰が止まります。戦車・対空砲・航空機・予備・死体は占領人数に入りません。',
      '敵所有拠点は中立化してから占領します。6人以上なら中継は各15秒、本拠地は各30秒です。1人なら6倍かかります。敵歩兵がいない中立拠点は占領の段階だけ進みます。',
      '本拠地から味方所有拠点をたどって隣接する拠点だけを攻撃できます。接続はHA–P1–中央P2/P3/P4–P5–HBです。飛び越し占領はできません。中立になった自軍本拠地の奪回は、供給接続がなくても可能です。',
      '歩兵がいない・供給接続がない状態が5秒続くと未完了の進行は徐々に戻ります。防衛歩兵も敵の進行を戻します。占領した前線点が接続・安全な状態で10秒安定すると、地上増援の出撃地点が近づきます。',
    ] },
    { heading: '有限増援・復帰・観戦', paragraphs: [
      '20作戦秒ごとに空いた枠へ、予備から最大歩兵18人・戦車2両・対空砲1両・航空機1機が出撃準備に入ります。同時出撃は各軍の歩兵120人・戦車12両・対空砲4両・航空機6機までです。失った部隊は復活せず、修理やHP回復もありません。',
      '自機を失うと5作戦秒後、航空機予備から復帰します。予備がなければ準備中の味方機、次に生存僚機へ操縦を引き継ぎます。生存機のHP・弾薬・位置・速度は引継ぎ前のままです。キーや指を一度離してから操縦してください。',
      '出撃回廊が危険なら復帰待ちと理由を表示します。全航空戦力がなくなったときは地上戦を観戦します。観戦でも地上軍は作戦を続け、敵・味方本拠地の占領で決着します。停止・ルール・ホーム・作戦終了は引き続き利用できます。',
    ] },
    { heading: 'スコア', paragraphs: [
      '最終スコアはチーム撃破 Kill + 自機支援 Support + チーム占領 Capture + 時間 Time − 味方損失 Lossです。撃破と占領はチームの成果で、自機が歩兵の代わりに占領したという意味ではありません。',
      '敵の撃破は1体につき歩兵20点・戦車300点・対空砲200点・航空機250点。自機支援は、自機が発射した攻撃で実際に減らした敵HPの1倍です。HPを超える損傷・死体・味方への射撃・空振りは加点しません。',
      '中継拠点の初回占領は各1,000点、敵本拠地の占領による勝利は5,000点です。開始時に味方が所有するP1と、同じ拠点の再占領は0点です。',
      '勝利時の時間点は5,000 × (1 − 経過秒/1,200) × min(1, Support/2,000)です。支援0なら時間点も0です。敗北・引分・中断に時間点と本拠地勝利点はありません。',
      '味方の損失は歩兵10点・戦車150点・対空砲100点・航空機300点。自機損失時は航空機の300点に200点を追加します。負点も表示します。',
      '最終合計は最後に一度だけ整数に丸めます。モードとルール版が同じ結果を比較してください。イージーの自動射撃による実損傷も支援に含まれます。',
    ] },
    { heading: input === 'touch' ? 'スマートフォンの操作' : 'PCの操作', paragraphs: input === 'touch' ? [
      'ボタンのない場所に触れ、その位置からドラッグして操縦します。指を離すと操縦入力が戻ります。操縦しながら別の指でボタンを押せます。',
      mode === 'easy' ? 'イージーは照準補助・自動射撃・速度補助を使います。手動操作ボタンは「宙返り」と「爆弾」です。爆弾は自動投下しません。' : 'ノーマルは「射撃」「加速」「減速」を長押しします。「射撃」は機銃と機関砲の共通操作です。弾の照準補助はありません。',
      '「宙返り」「爆弾」は押して指を離すと1回発動します。指の取消・操作の中断では発動しません。操作設定でモード別にボタンの位置・大きさ・不透明度を調整できます。',
    ] : [
      keyboardDescription,
      mode === 'easy' ? 'イージーは照準補助・自動射撃・速度補助を使います。射撃・加速・減速キーは無効です。爆弾は明示的な投下操作が必要です。' : 'ノーマルは射撃キーで機銃と機関砲を撃ちます。射撃・加速・減速は長押しです。弾の照準補助はありません。',
      'マウスで画面をドラッグしても操縦できます。単発の宙返り・爆弾は、キーを押し直すと次の操作になります。操作設定で両モード共通の10操作を変更できます。',
    ] },
    { heading: '空戦と地上支援', paragraphs: [
      '機銃・機関砲は288発・96発です。両方を撃ち切ると6秒で再装填します。遠くなるほど威力が下がります。機銃は戦車に効かず、機関砲は戦車にも少し効きます。',
      '爆弾は2発、1回に1発、投下間隔は1秒です。空になると20秒で再装填します。機体の速度を引き継いで落下し、地面・建物・橋・敵地上部隊への最初の接触で爆発します。',
      '爆風は中心で最大240損傷、半径60mで距離に応じて弱くなります。地形や建物で遮られた相手と航空機には効きません。十字は地形を使った着弾予測で、命中保証ではありません。',
      'イージーの自動射撃は照準円内・1.2km以内の見える敵が対象です。地形を貫通せず、小さな歩兵へ無条件に命中しません。',
      '対空砲は発射前に0.8秒の照準予告を出します。方向表示と警告を見て回避してください。地形・建物への接触は致命的です。戦場の端は警告し、内向きに戻る操作を受け付けます。',
      '初版は両モードとも味方への誤射損傷がありません。敵の戦車・対空砲を排除し、占領へ進む味方歩兵を守ってください。',
    ] },
  ];
}

/** Native modal keeps focus and Escape inside the guide without resuming the mission. */
export class RulesGuide {
  private readonly dialog: HTMLDialogElement;
  private readonly content: HTMLElement;
  private returnFocus: HTMLElement | null = null;
  private readonly abort = new AbortController();
  get isOpen() { return this.dialog.open; }
  constructor(private readonly context: () => RulesContext, private readonly clearInput: () => void) {
    this.dialog = document.createElement('dialog'); this.dialog.id = 'rules-guide';
    this.dialog.className = 'rules-dialog'; this.dialog.setAttribute('aria-labelledby', 'rules-title');
    this.dialog.innerHTML = '<header class="rules-header"><div><p class="eyebrow">HOW TO PLAY</p><h2 id="rules-title">ルールと操作方法</h2></div><button type="button" id="rules-close" aria-label="説明を閉じる">×</button></header><div id="rules-content" class="rules-content" tabindex="0" role="region" aria-label="ルール説明の内容"></div><footer><button type="button" id="rules-back" class="primary">元の画面へ戻る</button></footer>';
    document.getElementById('app')!.append(this.dialog);
    this.content = this.dialog.querySelector('#rules-content')!;
    for (const id of ['rules-close', 'rules-back']) this.dialog.querySelector('#' + id)!.addEventListener('click', () => this.close(), { signal: this.abort.signal });
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); }, { signal: this.abort.signal });
    this.dialog.addEventListener('keydown', event => containDialogTabFocus(this.dialog, event), { signal: this.abort.signal });
    this.dialog.addEventListener('close', () => { this.clearInput(); this.returnFocus?.focus({ preventScroll: true }); }, { signal: this.abort.signal });
  }
  open(button: HTMLElement) {
    if (this.isOpen) return;
    this.returnFocus = button; this.clearInput(); this.content.replaceChildren();
    for (const section of ruleSections(this.context())) {
      const element = document.createElement('section'), heading = document.createElement('h3');
      heading.textContent = section.heading; element.append(heading);
      for (const text of section.paragraphs) { const p = document.createElement('p'); p.textContent = text; element.append(p); }
      this.content.append(element);
    }
    this.dialog.showModal(); this.content.scrollTop = 0;
    this.dialog.querySelector<HTMLButtonElement>('#rules-close')!.focus({ preventScroll: true });
  }
  close() { if (this.isOpen) this.dialog.close(); }
  dispose() { this.close(); this.abort.abort(); this.dialog.remove(); }
}
