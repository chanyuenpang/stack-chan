import { requestXiaozhiLocalAdmin } from "../../stackchan-dock/src/xiaozhi-local-admin-client.mjs";
import { EventEmitter } from "node:events";
import { checkedSpeakerVolume, SPEAKER_VOLUME_UNITY } from "./speaker-volume-state.mjs";

function checkedDeviceVolume(value) {
  if (!Number.isInteger(value) || value < 0 || value > 100) throw new RangeError("robot did not report a physical speaker volume from 0 through 100");
  return value;
}

function checkedReply(result, requested = null) {
  const volume = checkedDeviceVolume(result?.volume);
  if (requested !== null && volume !== requested) throw new Error("robot speaker volume was not verified");
  return volume;
}

export class SpeakerVolumeController extends EventEmitter {
  #token;
  #request;
  #gain;
  #state;
  #tail = Promise.resolve();

  constructor({ token, request = requestXiaozhiLocalAdmin, gain = null, state = null } = {}) {
    super();
    if (typeof token !== "string" || !/^[0-9a-f]{64}$/i.test(token)) throw new TypeError("local Dock token is invalid");
    if (typeof request !== "function") throw new TypeError("local Dock volume request function is required");
    if (!gain || typeof gain.setOutputGainPercent !== "function") throw new TypeError("Dock PCM gain control is required");
    if (!state || typeof state.load !== "function" || typeof state.save !== "function") throw new TypeError("speaker volume state is required");
    this.#token = token;
    this.#request = request;
    this.#gain = gain;
    this.#state = state;
  }

  async get() {
    this.emit("state", { pending: true, operation: "get" });
    try {
      const deviceVolume = checkedReply(await this.#request({ token: this.#token, operation: "get-speaker-volume" }));
      let volume = this.#state.load();
      // A device-side volume change below unity disables persisted boost on
      // the next authenticated read.  Never amplify an unknown device state.
      if (volume > SPEAKER_VOLUME_UNITY && deviceVolume !== SPEAKER_VOLUME_UNITY) {
        volume = deviceVolume;
        this.#state.save(volume);
      }
      const gainPercent = volume > SPEAKER_VOLUME_UNITY ? volume : SPEAKER_VOLUME_UNITY;
      await this.#gain.setOutputGainPercent(gainPercent);
      const result = { volume, device_volume: deviceVolume, gain_percent: gainPercent, verified: true };
      this.emit("state", { pending: false, operation: "get", ...result, verified: true, error: null });
      return result;
    } catch (error) {
      this.emit("state", { pending: false, operation: "get", error: error.message });
      throw error;
    }
  }

  set(volume) {
    checkedSpeakerVolume(volume);
    const operation = this.#tail.then(async () => {
      this.emit("state", { pending: true, operation: "set", requested_volume: volume, error: null });
      try {
        const previousDeviceVolume = checkedReply(await this.#request({ token: this.#token, operation: "get-speaker-volume" }));
        const deviceVolume = Math.min(volume, SPEAKER_VOLUME_UNITY);
        const gainPercent = volume > SPEAKER_VOLUME_UNITY ? volume : SPEAKER_VOLUME_UNITY;
        if (volume <= SPEAKER_VOLUME_UNITY) {
          // Remove boost before changing hardware volume, so a failed device
          // write cannot leave an unexpectedly amplified lower setting.
          await this.#gain.setOutputGainPercent(SPEAKER_VOLUME_UNITY);
          checkedReply(await this.#request({ token: this.#token, operation: "set-speaker-volume", volume: deviceVolume }), deviceVolume);
        } else {
          if (previousDeviceVolume !== SPEAKER_VOLUME_UNITY) {
            checkedReply(await this.#request({ token: this.#token, operation: "set-speaker-volume", volume: SPEAKER_VOLUME_UNITY }), SPEAKER_VOLUME_UNITY);
          }
          try {
            await this.#gain.setOutputGainPercent(gainPercent);
          } catch (error) {
            await this.#gain.setOutputGainPercent(SPEAKER_VOLUME_UNITY).catch(() => {});
            if (previousDeviceVolume !== SPEAKER_VOLUME_UNITY) {
              await this.#request({ token: this.#token, operation: "set-speaker-volume", volume: previousDeviceVolume }).catch(() => {});
            }
            throw error;
          }
        }
        this.#state.save(volume);
        const result = { requested_volume: volume, volume, device_volume: deviceVolume, gain_percent: gainPercent, verified: true };
        this.emit("state", { pending: false, operation: "set", ...result, error: null });
        return result;
      } catch (error) {
        this.emit("state", { pending: false, operation: "set", requested_volume: volume, error: error.message });
        throw error;
      }
    });
    this.#tail = operation.catch(() => {});
    return operation;
  }
}
