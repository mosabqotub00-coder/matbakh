export const BROADCAST_SAMPLE_RATE = 16000;
export const BROADCAST_MAX_SECONDS = 10 * 60;
export const BROADCAST_MAX_BYTES =
  BROADCAST_SAMPLE_RATE * 2 * BROADCAST_MAX_SECONDS;
export const BROADCAST_PACKET_MAX_BYTES = BROADCAST_SAMPLE_RATE * 2;
export const BROADCAST_IDLE_MS = 20_000;

export function validateAudioPacket(data: Uint8Array) {
  if (
    !data.length ||
    data.length % 2 ||
    data.length > BROADCAST_PACKET_MAX_BYTES
  ) {
    throw new Error("دفعة الصوت غير صالحة أو تتجاوز ثانية واحدة.");
  }
}

export function createWavHeader(
  pcmBytes: number,
  sampleRate = BROADCAST_SAMPLE_RATE
) {
  if (
    !Number.isSafeInteger(pcmBytes) ||
    pcmBytes < 0 ||
    pcmBytes % 2 ||
    pcmBytes > BROADCAST_MAX_BYTES
  ) {
    throw new Error("حجم التسجيل غير صالح.");
  }
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const text = (offset: number, value: string) =>
    [...value].forEach((letter, index) =>
      view.setUint8(offset + index, letter.charCodeAt(0))
    );
  text(0, "RIFF");
  view.setUint32(4, 36 + pcmBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, pcmBytes, true);
  return header;
}

export function pcmToFloat(data: Uint8Array) {
  if (data.length % 2) throw new Error("PCM requires complete samples");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return Float32Array.from(
    { length: data.length / 2 },
    (_, index) => view.getInt16(index * 2, true) / 32768
  );
}
