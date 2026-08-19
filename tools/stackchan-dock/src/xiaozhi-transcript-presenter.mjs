import { EventEmitter } from "node:events";

const DEFAULT_MAX_UNPUNCTUATED_WAIT_MS = 1000;
const DEFAULT_MAX_UNPUNCTUATED_CODEPOINTS = 8;
const DEFAULT_MIN_BOUNDARY_CODEPOINTS = 6;
const NATURAL_COMMIT_BOUNDARY = /[，、：；。！？!?:;\n]/gu;
const TIMING_DIAGNOSTICS_ENABLED = process.env.STACKCHAN_TIMING_DIAGNOSTICS === "1";
const SUBTITLE_TRACE_ENABLED = process.env.STACKCHAN_SUBTITLE_TRACE === "1";

// One subtitle stream lasts for one assistant response. A newly dispatched
// append asks the device to trim only glyphs that have already left its view.
export class XiaozhiTranscriptPresenter extends EventEmitter {
  #server;
  #maxUnpunctuatedWaitMs;
  #maxUnpunctuatedCodepoints;
  #minBoundaryCodepoints;
  #subtitleId = 0;
  #response = null;
  #lastVisibleCommitAt = 0;
  #timer = null;
  #disposed = false;
  #enabled = true;

  constructor(server, {
    maxUnpunctuatedWaitMs = DEFAULT_MAX_UNPUNCTUATED_WAIT_MS,
    maxUnpunctuatedCodepoints = DEFAULT_MAX_UNPUNCTUATED_CODEPOINTS,
    minBoundaryCodepoints = DEFAULT_MIN_BOUNDARY_CODEPOINTS,
  } = {}) {
    super();
    if (!server || typeof server.sendTtsSentence !== "function" || typeof server.sendTtsSentenceAppend !== "function" || typeof server.sendTtsSubtitleTrim !== "function" || typeof server.sendTtsResponseEnd !== "function" || typeof server.sendTtsSubtitleCancel !== "function") throw new TypeError("XiaoZhi server with typed subtitle methods is required");
    if (!Number.isFinite(maxUnpunctuatedWaitMs) || maxUnpunctuatedWaitMs < 1) throw new RangeError("maxUnpunctuatedWaitMs must be positive");
    if (!Number.isInteger(maxUnpunctuatedCodepoints) || maxUnpunctuatedCodepoints < 1) throw new RangeError("maxUnpunctuatedCodepoints must be a positive integer");
    if (!Number.isInteger(minBoundaryCodepoints) || minBoundaryCodepoints < 1) throw new RangeError("minBoundaryCodepoints must be a positive integer");
    this.#server = server;
    this.#maxUnpunctuatedWaitMs = maxUnpunctuatedWaitMs;
    this.#maxUnpunctuatedCodepoints = maxUnpunctuatedCodepoints;
    this.#minBoundaryCodepoints = minBoundaryCodepoints;
    server.on?.("disconnected", () => this.clear());
  }

  beginAssistantResponse() {
    if (!this.#enabled) {
      this.#clearPending();
      return;
    }
    this.#cancelOpenResponse();
    this.#lastVisibleCommitAt = 0;
  }

  appendAssistantText(delta) {
    if (typeof delta !== "string" || !delta.isWellFormed()) throw new TypeError("assistant text delta must be well-formed Unicode");
    if (!this.#enabled) return;
    this.#timing("transcript_delta", { bytes: Buffer.byteLength(delta, "utf8"), startsResponse: this.#response === null });
    if (!this.#response) this.#response = { id: ++this.#subtitleId, text: "", sentText: undefined };
    this.#response.text += delta;
    if (this.#response.sentText === undefined) {
      this.#flush({ force: true });
      return;
    }
    this.#schedulePendingCommit();
  }

  completeAssistantText(text = "") {
    if (typeof text !== "string" || !text.isWellFormed()) throw new TypeError("assistant text must be well-formed Unicode");
    if (!this.#enabled) return;
    this.#flush({ force: true });
    const response = this.#response;
    if (response?.sentText !== undefined) {
      try { this.#server.sendTtsResponseEnd(response.id); }
      catch (error) { this.#trace("presenter_error", { subtitleId: response.id, error: error.message }); this.emit("presentationError", error); }
    }
    this.#response = null;
  }

  clear() {
    this.#clearPending();
    this.#lastVisibleCommitAt = 0;
  }

  get enabled() { return this.#enabled; }

  setEnabled(enabled) {
    if (typeof enabled !== "boolean") throw new TypeError("subtitle delivery must be a boolean");
    if (enabled === this.#enabled) return this.#enabled;
    if (!enabled) this.#cancelOpenResponse();
    this.#enabled = enabled;
    this.emit("deliveryState", { enabled });
    return this.#enabled;
  }

  dispose() {
    this.#disposed = true;
    this.#clearPending();
  }

  #schedulePendingCommit() {
    if (this.#disposed || !this.#response || this.#response.sentText === undefined) return;
    const pending = this.#response.text.slice(this.#response.sentText.length);
    if (!pending) return;
    const pendingCodepoints = Array.from(pending).length;
    const boundaryEnd = this.#lastNaturalBoundaryEnd(pending);
    const boundaryCodepoints = boundaryEnd === -1 ? 0 : Array.from(pending.slice(0, boundaryEnd)).length;
    if (boundaryCodepoints >= this.#minBoundaryCodepoints) {
      this.#flush({ force: false });
      return;
    }
    if (pendingCodepoints >= this.#maxUnpunctuatedCodepoints) {
      const elapsed = Date.now() - this.#lastVisibleCommitAt;
      if (elapsed >= this.#maxUnpunctuatedWaitMs) {
        this.#flush({ force: true });
        return;
      }
      if (!this.#timer) {
        const delay = Math.max(0, this.#maxUnpunctuatedWaitMs - elapsed);
        this.#timer = setTimeout(() => {
          this.#timer = null;
          this.#schedulePendingCommit();
        }, delay);
      }
    }
  }

  #flush({ force }) {
    const response = this.#response;
    if (this.#disposed || !response || !response.text || response.text === response.sentText) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    try {
      const isStart = response.sentText === undefined;
      const pending = isStart ? response.text : response.text.slice(response.sentText.length);
      const boundaryEnd = isStart ? -1 : this.#lastNaturalBoundaryEnd(pending);
      const committed = isStart || force || boundaryEnd === -1 ? pending : pending.slice(0, boundaryEnd);
      if (!committed) return;
      this.#trace("presenter_emit", {
        subtitleId: response.id,
        bytes: Buffer.byteLength(isStart ? committed : response.sentText + committed, "utf8"),
        visibleCommit: true,
        boundaryCommitted: !isStart && !force && boundaryEnd !== -1,
        fallbackCommitted: !isStart && force,
      });
      if (isStart) {
        this.#timing("response_start_send", { subtitleId: response.id, bytes: Buffer.byteLength(committed, "utf8") });
        this.#server.sendTtsSentence(committed, response.id);
      } else {
        // One visible commit is one device transaction.  The device only trims
        // if a complete glyph is already off the viewport; it never trims on a
        // marquee tick or raw transcript delta.
        this.#server.sendTtsSentenceAppend(response.id, committed, { trimAfterAppend: true });
      }
      response.sentText = isStart ? committed : response.sentText + committed;
      this.#lastVisibleCommitAt = Date.now();
      this.#trace("presenter_accepted", { subtitleId: response.id, bytes: Buffer.byteLength(response.sentText, "utf8"), visibleCommit: true });
      this.emit("presented", { text: response.sentText, subtitleId: response.id });
      if (!isStart && response.text.length > response.sentText.length) this.#schedulePendingCommit();
    } catch (error) {
      this.#trace("presenter_error", { subtitleId: response.id, error: error.message });
      this.emit("presentationError", error);
    }
  }

  #clearPending() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#response = null;
  }

  #cancelOpenResponse() {
    const response = this.#response;
    this.#clearPending();
    // A different authoritative Realtime turn supersedes an OPEN stream. Do
    // not synthesize response_end: that would start the normal expiry path.
    // The device receives this before the next sentence_start on the same WS.
    if (response?.sentText !== undefined) {
      try {
        this.#server.sendTtsSubtitleCancel(response.id);
        this.#trace("presenter_cancel", { subtitleId: response.id });
      } catch (error) {
        this.#trace("presenter_error", { subtitleId: response.id, error: error.message });
        this.emit("presentationError", error);
      }
    }
  }

  #lastNaturalBoundaryEnd(text) {
    let end = -1;
    for (const match of text.matchAll(NATURAL_COMMIT_BOUNDARY)) end = match.index + match[0].length;
    return end;
  }

  #timing(event, details = {}) {
    if (TIMING_DIAGNOSTICS_ENABLED) this.emit("timing", { event, at: Date.now(), ...details });
  }

  #trace(event, details = {}) {
    if (SUBTITLE_TRACE_ENABLED) this.emit("subtitleTrace", { source: "presenter", event, at: Date.now(), ...details });
  }
}
