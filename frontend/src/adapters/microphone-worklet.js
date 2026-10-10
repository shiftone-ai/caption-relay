// Sends mono PCM16 in 100ms frames, with a sequence and input sample offset.
class MicrophoneProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(Math.round(sampleRate / 10));
    this.count = 0;
    this.sequence = 0;
    this.offset = 0;
    this.finished = false;
    this.port.onmessage = event => {
      if (event.data.type === "flush") {
        this.finished = true;
        this.flush();
        this.port.postMessage({ type: "flushed" });
      }
    };
  }
  flush() {
    if (!this.count) return;
    const packet = new ArrayBuffer(8 + this.count * 2);
    const view = new DataView(packet);
    view.setUint32(0, this.sequence++);
    view.setUint32(4, this.offset);
    for (let i = 0; i < this.count; i++) {
      const value = Math.max(-1, Math.min(1, this.samples[i]));
      view.setInt16(8 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
    this.offset += this.count;
    this.count = 0;
    this.port.postMessage(packet, [packet]);
  }
  process(inputs) {
    if (this.finished) return true;
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i];
      this.samples[this.count++] = value / channels.length;
      if (this.count === this.samples.length) this.flush();
    }
    return true;
  }
}
registerProcessor("caption-relay-microphone", MicrophoneProcessor);
