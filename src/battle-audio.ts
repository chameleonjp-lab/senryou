/** Procedural audio reads battle facts; sound never advances the simulation. */
export class BattleAudio {
  enabled = false;
  failed = false;
  private context: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  async unlock(): Promise<void> {
    if (!this.enabled) return;
    try {
      if (!this.context) this.context = new AudioContext();
      await this.context.resume();
      this.failed = this.context.state !== 'running';
    } catch { this.failed = true; }
  }
  sync(active: boolean, speed = 110): void {
    const context = this.context;
    if (!context || !this.enabled || !active || context.state !== 'running') { this.stop(); return; }
    if (!this.oscillator) {
      this.oscillator = context.createOscillator();
      this.gain = context.createGain();
      this.oscillator.type = 'sawtooth';
      this.gain.gain.value = 0.018;
      this.oscillator.connect(this.gain); this.gain.connect(context.destination);
      this.oscillator.start();
    }
    this.oscillator.frequency.setTargetAtTime(49 + Math.max(0, speed - 65) * 0.35, context.currentTime, 0.1);
  }
  stop(): void {
    if (this.oscillator) { try { this.oscillator.stop(); } catch {} this.oscillator.disconnect(); }
    this.gain?.disconnect(); this.oscillator = null; this.gain = null;
  }
  dispose(): void { this.stop(); void this.context?.close().catch(() => {}); this.context = null; }
}
