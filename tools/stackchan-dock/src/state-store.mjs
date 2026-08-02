function clone(value) {
  return structuredClone(value);
}

export class DeviceStateStore {
  #state = null;
  #sequence = 0;

  get sequence() {
    return this.#sequence;
  }

  snapshot() {
    return this.#state === null ? null : clone(this.#state);
  }

  replaceFromStatus(status) {
    if (status === null || typeof status !== "object" || Array.isArray(status)) {
      throw new TypeError("status must be an object");
    }
    if (!Number.isSafeInteger(status.event_sequence) || status.event_sequence < 0) {
      throw new TypeError("status.event_sequence must be a non-negative integer");
    }
    if (status.device !== "stackchan-codex-companion" || status.protocol_version !== 1) {
      throw new TypeError("status identity or protocol version is incompatible");
    }
    this.#sequence = status.event_sequence;
    this.#state = clone(status);
    return this.snapshot();
  }

  applyEvent(message) {
    if (this.#state === null) {
      return { applied: false, needsResync: true, reason: "missing_snapshot" };
    }
    if (message.seq <= this.#sequence) {
      return { applied: false, needsResync: false, reason: "duplicate_or_old" };
    }
    if (message.seq !== this.#sequence + 1) {
      return { applied: false, needsResync: true, reason: "sequence_gap" };
    }

    this.#sequence = message.seq;
    this.#state.event_sequence = message.seq;
    if (message.event === "audio_state") {
      this.#state.audio = clone(message.data);
    } else if (message.event === "touch") {
      this.#state.last_touch = { ...clone(message.data), seq: message.seq };
    } else if (message.event === "connection") {
      this.#state.connection = clone(message.data);
    } else {
      this.#state.last_event = { event: message.event, data: clone(message.data), seq: message.seq };
    }
    return { applied: true, needsResync: false, state: this.snapshot() };
  }
}
