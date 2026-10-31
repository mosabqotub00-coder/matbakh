class KitchenMicrophoneProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.accumulator = 0;
    this.samples = [];
    this.port.onmessage = event => {
      if (event.data === "flush") this.flush();
    };
  }
  flush() {
    if (!this.samples.length) return;
    const bytes = new Uint8Array(this.samples.length * 2);
    const view = new DataView(bytes.buffer);
    this.samples.forEach((sample, index) =>
      view.setInt16(index * 2, sample, true)
    );
    this.port.postMessage(bytes.buffer, [bytes.buffer]);
    this.samples = [];
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const sample of channel) {
      this.accumulator += 16000;
      if (this.accumulator >= sampleRate) {
        this.accumulator -= sampleRate;
        const limited = Math.min(1, Math.max(-1, sample));
        this.samples.push(Math.round(limited * (limited < 0 ? 32768 : 32767)));
      }
      if (this.samples.length >= 8000) this.flush();
    }
    return true;
  }
}
registerProcessor("kitchen-microphone", KitchenMicrophoneProcessor);
