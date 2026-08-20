const api = window.stackchanConsole;
const error = document.querySelector("#error");
const speakerVolume = document.querySelector("#speaker-volume");
const speakerVolumeDetail = document.querySelector("#speaker-volume-detail");
const subtitleToggle = document.querySelector("#subtitle-display-toggle");
const subtitleDisplayDetail = document.querySelector("#subtitle-display-detail");
const speakerModeToggle = document.querySelector("#speaker-mode-toggle");
const speakerModeDetail = document.querySelector("#speaker-mode-detail");
let speakerVolumeBusy = false;
let speakerVolumeLoaded = false;
let speakerVolumeRead = null;
let speakerModeBusy = false;
let previousConnectionPhase = null;
let latestRevision = -1;
let latestState = {};
let latestSpeakerMode = {};

function renderSubtitle(subtitle = {}) {
  const phase = subtitle.phase ?? "unavailable";
  const enabled = subtitle.enabled !== false;
  const phaseLabel = { waiting: "等待回复", streaming: "正在显示", complete: "本轮完成", idle: "等待语音", unavailable: "不可用", disabled: "已关闭" }[phase] ?? phase;
  document.querySelector("#subtitle-state").textContent = phaseLabel;
  document.querySelector("#live-subtitle-text").textContent = enabled ? (subtitle.text || "等待机器人回复时的已提交字幕") : "机器人端字幕已关闭；当前语音仍会正常播放。";
  document.querySelector("#live-subtitle-panel").dataset.phase = phase;
  subtitleToggle.classList.toggle("is-on", enabled);
  subtitleToggle.setAttribute("aria-checked", String(enabled));
  subtitleDisplayDetail.textContent = enabled ? "已开启：机器人端显示当前回复字幕" : "已关闭机器人端字幕；语音继续播放";
}

async function setSubtitleEnabled() {
  const enabled = subtitleToggle.getAttribute("aria-checked") !== "true";
  subtitleToggle.disabled = true;
  try { renderSubtitle(await api.setSubtitleEnabled(enabled)); }
  catch (exception) { error.textContent = `字幕设置失败：${exception.message}`; }
  finally { subtitleToggle.disabled = false; }
}

function renderSpeakerMode(mode = {}) {
  latestSpeakerMode = mode;
  const enabled = mode.enabled === true;
  speakerModeToggle.classList.toggle("is-on", enabled);
  speakerModeToggle.setAttribute("aria-checked", String(enabled));
  speakerModeToggle.disabled = speakerModeBusy || mode.pending === true;
  if (mode.pending) speakerModeDetail.textContent = "正在同步到机器人…";
  else if (mode.error) speakerModeDetail.textContent = `未同步：${mode.error}`;
  else if (!mode.synchronized) speakerModeDetail.textContent = "等待机器人认证后同步";
  else if (enabled) speakerModeDetail.textContent = mode.input_muted ? "已关闭麦克风输入；喇叭播放和 Dock 连接保持。" : "开启后，屏幕关闭仅关闭麦克风输入；喇叭播放和 Dock 连接保持。";
  else speakerModeDetail.textContent = "关闭：屏幕关闭会完整断开会话";
  renderConnectionProjection(latestState);
}

async function readSpeakerMode() {
  if (!api?.getSpeakerMode) return;
  try { renderSpeakerMode(await api.getSpeakerMode()); }
  catch (exception) { speakerModeDetail.textContent = `无法读取：${exception.message}`; speakerModeToggle.disabled = true; }
}

async function setSpeakerMode() {
  if (!api?.setSpeakerMode || speakerModeBusy) return;
  speakerModeBusy = true;
  speakerModeToggle.disabled = true;
  try { renderSpeakerMode(await api.setSpeakerMode(speakerModeToggle.getAttribute("aria-checked") !== "true")); }
  catch (exception) { speakerModeDetail.textContent = `未同步：${exception.message}`; await readSpeakerMode(); }
  finally { speakerModeBusy = false; speakerModeToggle.disabled = false; }
}

function renderSpeakerVolume({ volume = null, device_volume = null, gain_percent = null, pending = false, verified = false, message = null } = {}) {
  speakerVolumeBusy = pending;
  speakerVolume.disabled = pending || volume === null || !api;
  if (Number.isInteger(volume)) speakerVolume.value = String(volume);
  const detail = verified
    ? (volume > 100 ? `已确认：${volume}%（设备 100% + Dock 安全增益 ${gain_percent ?? volume}%）` : `已确认：${volume}%（设备 ${device_volume ?? volume}%）`)
    : "正在读取实际音量";
  speakerVolumeDetail.textContent = pending ? "正在设置…" : message ?? detail;
}

async function readSpeakerVolume() {
  if (speakerVolumeRead) return speakerVolumeRead;
  speakerVolumeRead = (async () => {
    renderSpeakerVolume({ pending: true });
    try {
      const result = await api.getSpeakerVolume();
      speakerVolumeLoaded = true;
      renderSpeakerVolume({ ...result, verified: true });
    } catch (exception) {
      speakerVolumeLoaded = false;
      renderSpeakerVolume({ message: `不可用：${exception.message}` });
    }
  })();
  try { return await speakerVolumeRead; }
  finally { speakerVolumeRead = null; }
}

async function setSpeakerVolume() {
  if (speakerVolumeBusy || !speakerVolumeLoaded) return;
  const volume = Number(speakerVolume.value);
  renderSpeakerVolume({ volume, pending: true });
  try {
    const result = await api.setSpeakerVolume(volume);
    renderSpeakerVolume({ ...result, verified: result.verified === true });
  } catch (exception) {
    renderSpeakerVolume({ message: `设置失败：${exception.message}` });
    await readSpeakerVolume();
  }
}

function previewSpeakerVolume() {
  if (speakerVolumeBusy || !speakerVolumeLoaded) return;
  // Range `input` fires for every drag step.  It is deliberately local-only:
  // the device write happens once from `change` when the gesture commits.
  const volume = Number(speakerVolume.value);
  speakerVolumeDetail.textContent = volume > 100 ? `预览：${volume}%（设备将保持 100%，Dock 安全增益）` : `预览：${Number(speakerVolume.value)}%`;
}

const phaseCopy = {
  connected: { badge: "已连接", kicker: "ROBOT ONLINE", title: "StackChan 已连接", detail: "机器人已就绪，Dock 正在提供实时状态。", card: "在线", cardDetail: "会话已认证" },
  disconnected: { badge: "未连接", kicker: "ROBOT OFFLINE", title: "等待 StackChan", detail: "Dock 正在运行，等待机器人重新连接。", card: "未连接", cardDetail: "等待认证" },
  unavailable: { badge: "不可用", kicker: "STATUS UNAVAILABLE", title: "状态暂不可用", detail: "暂时无法读取 Dock 状态。", card: "不可用", cardDetail: "请稍后刷新" },
  connecting: { badge: "连接中", kicker: "CONNECTING", title: "正在连接 StackChan", detail: "正在读取机器人的状态。", card: "正在检查", cardDetail: "Dock 状态将在此显示" },
  offline: { badge: "不可用", kicker: "STATUS UNAVAILABLE", title: "状态暂不可用", detail: "控制台未能读取 Dock 状态。", card: "不可用", cardDetail: "请稍后刷新" },
};

// This keeps the transport fact separate from its UI projection.  A muted
// microphone is deliberately rendered with the established disconnected red
// layout, while the underlying connection phase remains connected.
const microphoneMutedCopy = {
  ...phaseCopy.disconnected,
  badge: "已关闭麦克风",
  kicker: "MICROPHONE MUTED",
  title: "麦克风已关闭",
  detail: "喇叭播放和 Dock 连接保持。",
  card: "已关闭麦克风",
  cardDetail: "喇叭播放和 Dock 连接保持",
};

function renderConnectionProjection(state = {}) {
  const phase = state.connection?.phase ?? "connecting";
  const microphoneMuted = phase === "connected"
    && latestSpeakerMode.enabled === true
    && latestSpeakerMode.synchronized === true
    && latestSpeakerMode.input_muted === true;
  const projection = microphoneMuted ? "microphone-muted" : phase;
  const copy = microphoneMuted ? microphoneMutedCopy : (phaseCopy[phase] ?? phaseCopy.unavailable);

  document.body.dataset.connection = projection;
  const badge = document.querySelector("#connection-badge");
  badge.lastElementChild.textContent = copy.badge;
  badge.setAttribute("aria-label", `机器人连接状态：${copy.badge}`);
  document.querySelector("#connection-kicker").textContent = copy.kicker;
  document.querySelector("#connection-title").textContent = copy.title;
  document.querySelector("#connection-detail").textContent = copy.detail;
  document.querySelector("#connection-card-title").textContent = copy.card;
  document.querySelector("#connection-card-detail").textContent = copy.cardDetail;
}

function compactValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "object" ? "已提供" : String(value);
}

function renderDetails(state) {
  const fields = {
    "连接阶段": state.connection?.phase,
    "设备": state.connection?.deviceId,
    "会话": state.connection?.sessionId,
    "运行状态": state.health?.runtime,
    "电池": state.robot?.battery?.availability === "available" ? `${state.robot.battery.level}%` : "不可用",
  };
  document.querySelector("#technical-status").innerHTML = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([label, value]) => `<dt>${label}</dt><dd>${compactValue(value)}</dd>`)
    .join("") || "<dt>状态</dt><dd>等待 Dock 回报</dd>";
}

function render(state = {}) {
  const revision = Number.isInteger(state.revision) ? state.revision : 0;
  if (revision < latestRevision) return;
  latestRevision = revision;
  latestState = state;
  const phase = state.connection?.phase ?? "connecting";
  const subtitle = state.voice?.subtitle ?? {};
  const voicePhase = state.voice?.phase ?? state.voice?.status ?? "等待状态";
  const robot = state.robot ?? {};
  const battery = robot.battery ?? {};
  const led = robot.led ?? {};

  renderConnectionProjection(state);
  document.querySelector("#runtime-state").textContent = compactValue(state.health?.runtime ?? (phase === "connected" ? "已就绪" : "准备中"));
  document.querySelector("#robot-name").textContent = compactValue(robot.name ?? robot.displayName ?? "StackChan");
  document.querySelector("#voice-state").textContent = compactValue(voicePhase);
  renderSubtitle(subtitle);
  document.querySelector("#battery-state").textContent = battery.availability === "available" ? `${battery.level}%${battery.charging ? " · 充电中" : ""}` : "状态不可用";
  document.querySelector("#battery-detail").textContent = battery.availability === "available" ? "每分钟更新一次" : "设备未提供电池读数";
  const ledNames = { waiting: "琥珀 · 等待", listening: "绿色 · 监听", playing: "蓝色 · 播放", fault: "红色 · 故障" };
  document.querySelector("#led-state").textContent = led.availability === "derived" ? (ledNames[led.phase] ?? "状态色未知") : "状态色未知";
  document.querySelector("#led-detail").textContent = led.availability === "derived" ? "运行状态推导" : "无法读取硬件颜色";
  document.querySelector("#led-icon").style.color = led.rgb ? `rgb(${led.rgb.red}, ${led.rgb.green}, ${led.rgb.blue})` : "";
  error.textContent = state.health?.lastError ?? "";
  renderDetails(state);

  // This phase comes from the Owner's authenticated event (or the attached
  // controller's status poll). A startup page and a stale slider are never
  // treated as proof that the robot can accept a volume operation.
  if (phase === "connected" && previousConnectionPhase !== "connected" && !speakerVolumeBusy) {
    void readSpeakerVolume();
  } else if (phase !== "connected" && previousConnectionPhase === "connected") {
    speakerVolumeLoaded = false;
    renderSpeakerVolume({ message: "等待机器人认证" });
  }
  previousConnectionPhase = phase;
}

document.querySelector("#robot-image").addEventListener("error", () => {
  document.querySelector("#robot-image").hidden = true;
  document.querySelector("#robot-fallback").classList.add("is-visible");
});

document.querySelector("#refresh").onclick = async () => {
  try { render(await api.refresh()); if (!speakerVolumeBusy) await readSpeakerVolume(); await readSpeakerMode(); }
  catch (exception) { error.textContent = exception.message; }
};

speakerVolume.addEventListener("input", previewSpeakerVolume);
speakerVolume.addEventListener("change", () => { void setSpeakerVolume(); });
subtitleToggle.addEventListener("click", () => { void setSubtitleEnabled(); });
speakerModeToggle.addEventListener("click", () => { void setSpeakerMode(); });

if (!api) {
  render({ connection: { phase: "unavailable" }, health: { runtime: "未连接", lastError: "控制台 IPC 桥未加载。" } });
  document.querySelector("#refresh").disabled = true;
} else {
  api.onState((state) => {
    const connectionChanged = state?.connection?.phase !== previousConnectionPhase;
    render(state);
    if (connectionChanged) api.getState().then(render).catch(() => {});
  });
  api.onSubtitle((subtitle) => renderSubtitle(subtitle));
  api.onSpeakerMode((mode) => renderSpeakerMode(mode));
  void readSpeakerMode();
  api.getState().then(render).catch((exception) => render({
    connection: { phase: "offline" }, health: { runtime: "未连接", lastError: exception.message },
  }));
  api.getSubtitle().then(renderSubtitle).catch(() => {});
}
