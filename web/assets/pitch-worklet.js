class KaraokePitchShifter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.semitones = 0;
    this.phase = 0;
    this.size = 16384;
    this.mask = this.size - 1;
    this.writeIndex = 0;
    this.buffers = [];
    this.port.onmessage = event => {
      if (Number.isFinite(event.data?.semitones)) {
        this.semitones = Math.max(-6, Math.min(6, event.data.semitones));
      }
    };
  }

  read(buffer, position) {
    const base = Math.floor(position);
    const fraction = position - base;
    const a = buffer[base & this.mask];
    const b = buffer[(base + 1) & this.mask];
    return a + (b - a) * fraction;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input.length) return true;
    while (this.buffers.length < output.length) this.buffers.push(new Float32Array(this.size));

    const ratio = Math.pow(2, this.semitones / 12);
    const range = 4096;
    const phaseStep = Math.abs(1 - ratio) / range;

    for (let frame = 0; frame < output[0].length; frame++) {
      for (let channel = 0; channel < output.length; channel++) {
        const source = input[Math.min(channel, input.length - 1)];
        this.buffers[channel][this.writeIndex] = source[frame] || 0;
      }

      const phaseA = this.phase;
      const phaseB = (this.phase + 0.5) % 1;
      const delayA = ratio >= 1 ? range * (1 - phaseA) + 256 : range * phaseA + 256;
      const delayB = ratio >= 1 ? range * (1 - phaseB) + 256 : range * phaseB + 256;
      const gainA = 0.5 - 0.5 * Math.cos(2 * Math.PI * phaseA);
      const gainB = 0.5 - 0.5 * Math.cos(2 * Math.PI * phaseB);
      const gainSum = Math.max(0.001, gainA + gainB);

      for (let channel = 0; channel < output.length; channel++) {
        if (this.semitones === 0) {
          output[channel][frame] = this.buffers[channel][(this.writeIndex - 256) & this.mask];
        } else {
          const a = this.read(this.buffers[channel], this.writeIndex - delayA);
          const b = this.read(this.buffers[channel], this.writeIndex - delayB);
          output[channel][frame] = (a * gainA + b * gainB) / gainSum;
        }
      }

      this.writeIndex = (this.writeIndex + 1) & this.mask;
      this.phase = (this.phase + phaseStep) % 1;
    }
    return true;
  }
}

registerProcessor("karaoke-pitch-shifter", KaraokePitchShifter);
