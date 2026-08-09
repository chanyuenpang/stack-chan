import { OpusDecoder } from "opus-decoder";

export const WIFI_AUDIO_OPUS_OUTPUT_SAMPLE_RATE = 24_000;
export const WIFI_AUDIO_OPUS_FRAME_MS = 60;
export const WIFI_AUDIO_OPUS_OUTPUT_SAMPLES =
  WIFI_AUDIO_OPUS_OUTPUT_SAMPLE_RATE * WIFI_AUDIO_OPUS_FRAME_MS / 1000;

function reject(message) {
  throw new TypeError(message);
}

/** Decode one raw mono Opus packet to the Dock's existing 24 kHz s16le stream. */
export class OpusMicrophoneDecoder {
  #decoder;

  constructor({ decoder } = {}) {
    this.#decoder = decoder ?? new OpusDecoder({
      sampleRate: WIFI_AUDIO_OPUS_OUTPUT_SAMPLE_RATE,
      channels: 1,
      streamCount: 1,
      coupledStreamCount: 0,
      channelMappingTable: [0],
    });
  }

  get ready() {
    return this.#decoder.ready;
  }

  async reset() {
    await this.#decoder.reset();
  }

  decodeFrame(opus) {
    const packet = Buffer.from(opus);
    if (packet.length === 0) reject("Opus packet must not be empty");
    const input = new Uint8Array(packet.buffer, packet.byteOffset, packet.byteLength);
    const decoded = this.#decoder.decodeFrame(input);
    if (decoded.errors?.length) reject(`Opus decoder error: ${decoded.errors[0].message}`);
    if (decoded.sampleRate !== WIFI_AUDIO_OPUS_OUTPUT_SAMPLE_RATE ||
        decoded.samplesDecoded !== WIFI_AUDIO_OPUS_OUTPUT_SAMPLES ||
        decoded.channelData?.length !== 1 ||
        decoded.channelData[0].length !== WIFI_AUDIO_OPUS_OUTPUT_SAMPLES) {
      reject("Opus packet is not one 60 ms mono frame");
    }

    const samples = decoded.channelData[0];
    const pcm = Buffer.allocUnsafe(samples.length * 2);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, samples[index]));
      const value = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
      pcm.writeInt16LE(value, index * 2);
    }
    return pcm;
  }

  free() {
    this.#decoder.free();
  }
}
