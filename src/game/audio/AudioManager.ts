/**
 * Minimal procedural audio built on Web Audio — no external files. Browsers
 * block autoplay, so nothing starts until the user presses the Audio button
 * (which calls enable() from a user gesture).
 */
class AudioManager {
  private ctx: AudioContext | null = null
  private ambientGain: GainNode | null = null
  private engineOsc: OscillatorNode | null = null
  private engineGain: GainNode | null = null
  private rainGain: GainNode | null = null
  private rainLevel = 0
  private enabled = false

  enable(): void {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.buildAmbient()
      this.buildEngine()
      this.buildRain()
    }
    void this.ctx.resume()
    this.enabled = true
    if (this.ambientGain && this.ctx) {
      this.ambientGain.gain.setTargetAtTime(0.045, this.ctx.currentTime, 0.5)
    }
    this.setRain(this.rainLevel)
  }

  disable(): void {
    this.enabled = false
    if (this.ambientGain && this.ctx) {
      this.ambientGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2)
    }
    if (this.engineGain && this.ctx) {
      this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1)
    }
    if (this.rainGain && this.ctx) {
      this.rainGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2)
    }
  }

  /** Soft filtered noise loop — a distant city hum. */
  private buildAmbient(): void {
    const ctx = this.ctx
    if (!ctx) return
    const seconds = 2
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < data.length; i++) {
      // Brown noise: integrate white noise for a low rumble.
      const white = Math.random() * 2 - 1
      last = (last + 0.02 * white) / 1.02
      data[i] = last * 3.5
    }
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 380
    this.ambientGain = ctx.createGain()
    this.ambientGain.gain.value = 0
    src.connect(filter).connect(this.ambientGain).connect(ctx.destination)
    src.start()
  }

  /** Bright filtered noise loop — steady rain patter, faded by strength. */
  private buildRain(): void {
    const ctx = this.ctx
    if (!ctx) return
    const seconds = 2
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1
    }
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 3200
    filter.Q.value = 0.6
    this.rainGain = ctx.createGain()
    this.rainGain.gain.value = 0
    src.connect(filter).connect(this.rainGain).connect(ctx.destination)
    src.start()
  }

  /** strength 0..1 — the current blended rain strength from the weather. */
  setRain(strength: number): void {
    this.rainLevel = strength
    if (!this.enabled || !this.ctx || !this.rainGain) return
    const target = strength <= 0.02 ? 0 : 0.01 + strength * 0.035
    this.rainGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.8)
  }

  private buildEngine(): void {
    const ctx = this.ctx
    if (!ctx) return
    this.engineOsc = ctx.createOscillator()
    this.engineOsc.type = 'sawtooth'
    this.engineOsc.frequency.value = 55
    this.engineGain = ctx.createGain()
    this.engineGain.gain.value = 0
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 500
    this.engineOsc.connect(filter).connect(this.engineGain).connect(ctx.destination)
    this.engineOsc.start()
  }

  /** speedRatio 0..1 — 0 silences the engine. */
  setEngine(speedRatio: number): void {
    if (!this.enabled || !this.ctx || !this.engineOsc || !this.engineGain) return
    const t = this.ctx.currentTime
    const target = speedRatio <= 0.01 ? 0 : 0.02 + speedRatio * 0.03
    this.engineGain.gain.setTargetAtTime(target, t, 0.1)
    this.engineOsc.frequency.setTargetAtTime(50 + speedRatio * 90, t, 0.1)
  }

  /** Two quick friendly beeps — an ambient car's polite honk. */
  playHonk(): void {
    if (!this.enabled || !this.ctx) return
    const ctx = this.ctx
    for (const [offset, freq] of [
      [0, 470],
      [0.16, 470],
    ] as const) {
      const osc = ctx.createOscillator()
      osc.type = 'square'
      osc.frequency.value = freq
      const gain = ctx.createGain()
      const t0 = ctx.currentTime + offset
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(0.045, t0 + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + 0.13)
    }
  }

  /** Short click blip for interactions/buttons. */
  playClick(): void {
    if (!this.enabled || !this.ctx) return
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = 660
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.06, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.15)
  }
}

export const audioManager = new AudioManager()
