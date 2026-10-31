import { BROADCAST_SAMPLE_RATE, pcmToFloat } from "@shared/broadcast-audio";

export function bytesToBase64(data: Uint8Array) {
  let text = "";
  for (let index = 0; index < data.length; index += 8192)
    text += String.fromCharCode(...data.subarray(index, index + 8192));
  return btoa(text);
}
export function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}
export async function openMicrophone(onPacket: (packet: Uint8Array) => void) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
    throw new Error("الميكروفون يحتاج HTTPS ومتصفحًا حديثًا.");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    video: false,
  });
  const context = new AudioContext();
  let node: AudioWorkletNode | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  try {
    await context.resume();
    await context.audioWorklet.addModule("/broadcast-worklet.js");
    node = new AudioWorkletNode(context, "kitchen-microphone");
    source = context.createMediaStreamSource(stream);
    const silent = context.createGain();
    silent.gain.value = 0;
    source.connect(node);
    node.connect(silent);
    silent.connect(context.destination);
    node.port.onmessage = event =>
      onPacket(new Uint8Array(event.data as ArrayBuffer));
    let closed = false;
    return {
      async close() {
        if (closed) return;
        closed = true;
        node?.port.postMessage("flush");
        await new Promise(resolve => setTimeout(resolve, 80));
        stream.getTracks().forEach(track => track.stop());
        source?.disconnect();
        node?.disconnect();
        if (context.state !== "closed") await context.close();
      },
    };
  } catch (error) {
    stream.getTracks().forEach(track => track.stop());
    await context.close();
    throw error;
  }
}

export async function createBroadcastPlayback() {
  const context = new AudioContext();
  await context.resume();
  let nextTime = context.currentTime + 0.08;
  const active = new Set<AudioBufferSourceNode>();
  let closed = false;
  return {
    async append(bytes: Uint8Array, sampleRate = BROADCAST_SAMPLE_RATE) {
      if (closed) return;
      if (context.state === "suspended") await context.resume();
      const samples = pcmToFloat(bytes);
      const buffer = context.createBuffer(1, samples.length, sampleRate);
      buffer.copyToChannel(samples, 0);
      const node = context.createBufferSource();
      node.buffer = buffer;
      node.connect(context.destination);
      nextTime = Math.max(context.currentTime + 0.06, nextTime);
      active.add(node);
      node.onended = () => {
        active.delete(node);
        node.disconnect();
      };
      node.start(nextTime);
      nextTime += buffer.duration;
    },
    remainingMs() {
      return Math.max(0, (nextTime - context.currentTime) * 1000);
    },
    async close() {
      closed = true;
      active.forEach(node => {
        try {
          node.stop();
        } catch {
          /* Already ended. */
        }
      });
      active.clear();
      if (context.state !== "closed") await context.close();
    },
  };
}
