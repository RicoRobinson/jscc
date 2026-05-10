export class FluidAudio {
  constructor() {
    this._ctx = null;
    this._osc = null;
    this._gain = null;
    this._filter = null;
    this._started = false;

    this._targetFreq = 60;
    this._currentFreq = 60;
    this._BASE_FREQ = 60;
    this._MAX_FREQ = 220;
    this._BASE_GAIN = 0.18;
  }

  _boot() {
    if (this._ctx) return;
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();

    this._filter = this._ctx.createBiquadFilter();
    this._filter.type = 'lowpass';
    this._filter.frequency.value = 400;
    this._filter.Q.value = 8;

    this._gain = this._ctx.createGain();
    this._gain.gain.setValueAtTime(0, this._ctx.currentTime);

    this._osc = this._ctx.createOscillator();
    this._osc.type = 'sine';
    this._osc.frequency.setValueAtTime(this._BASE_FREQ, this._ctx.currentTime);
    this._osc.connect(this._filter);
    this._filter.connect(this._gain);
    this._gain.connect(this._ctx.destination);
    this._osc.start();
  }

  // speed: normalised 0–1
  update(speed) {
    if (!this._ctx) return;
    const t = this._ctx.currentTime;
    const freq = this._BASE_FREQ + (this._MAX_FREQ - this._BASE_FREQ) * Math.pow(speed, 0.6);
    const gain = speed > 0.01 ? this._BASE_GAIN * (0.4 + 0.6 * speed) : 0;

    this._osc.frequency.cancelScheduledValues(t);
    this._osc.frequency.setTargetAtTime(freq, t, 0.08);

    this._gain.gain.cancelScheduledValues(t);
    this._gain.gain.setTargetAtTime(gain, t, 0.12);

    // shift filter cutoff with speed for subtle tonal colour
    this._filter.frequency.cancelScheduledValues(t);
    this._filter.frequency.setTargetAtTime(200 + 600 * speed, t, 0.1);
  }

  activate() {
    this._boot();
    if (this._ctx.state === 'suspended') this._ctx.resume();
  }
}
