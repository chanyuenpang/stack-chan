# Stack-chan Codex Companion Dock

Windows Dock for the official StackChan/XiaoZhi Wi-Fi audio lifecycle and typed
Codex MCP control. USB UAC/CDC and raw-PCM Wi-Fi implementations are retained
below only as rollback and diagnostic references.

## Official XiaoZhi Wi-Fi route

The current product route uses the official StackChan/XiaoZhi audio lifecycle:
`AudioService -> Opus -> XiaoZhi WebSocket v1`. The PC side is one process that
owns the authenticated bootstrap endpoint, WebSocket session, native event-driven
WASAPI broker, half-duplex TTS boundary, and typed robot MCP adapter. It does not
use the legacy raw-PCM/UDP/VB Python path.

The historical `stackchan_wifi` entry point below starts a complete Dock runtime
and is retained only for compatibility and diagnostics. It must not be launched
while the Electron Dock Owner is running.

### Unified Electron-Owner MCP

The normal Codex integration is the single `stackchan` MCP proxy:

```powershell
.\scripts\start-stackchan-mcp.ps1
```

It does **not** create a Dock, WebSocket listener, bootstrap listener, or WASAPI
broker. It decrypts the current-user local token only to authenticate one request
at a time to the named-pipe management endpoint already hosted by the Electron
Dock Owner. When Dock is stopped, calls fail visibly with `OWNER_UNAVAILABLE`;
when the robot is not authenticated, device tools fail with `DEVICE_OFFLINE`.

The v1 capability set is status/health, head pose, LED override, and physical
robot speaker codec volume. The Owner remains the sole state and safety owner:
head motion uses the same `yaw -45..45`, `pitch 0..45`, and `speed 100..300`
envelope as the Dock UI; LED writes use its arbiter; volume writes require an
Owner device read-back. Camera remains intentionally deferred.

Migration: configure Codex with only this proxy as `mcp_servers.stackchan` and
remove `stackchan_wifi` and `stackchan_volume` from normal startup after the
Dock restart acceptance test. The legacy `stackchan_volume` entry can remain
temporarily for callers that still use its old tool names, but it is not a
second runtime and should be removed once callers migrate.

The old full-runtime MCP entry point is:

```powershell
.\scripts\start-xiaozhi-mcp.ps1
```

The script discovers the existing route to the robot and only reads the selected
local IPv4 address; it never changes the PC network, gateway, DNS, or Wi-Fi. It
automatically targets the single root `ChatGPT.exe` process tree unless
`-TargetProcessId` is given. The shared 256-bit token is decrypted from the
current-user DPAPI file and passed to Node only through the child environment,
not the command line or logs.

The robot must be provisioned once with the bootstrap URL printed by the runtime
(normally `http://<pc-ip>:8766/xiaozhi/ota`) and the same token. Normal audio and
MCP operation then use Wi-Fi and do not depend on USB. Development HTTP/WS is
restricted to a trusted LAN; a production deployment must use HTTPS/WSS.

The Dock is a runtime dependency, not a one-shot provisioning tool. Start it
before booting the robot and keep it running while the local product is in use:
the robot reads the OTA bootstrap during startup and then connects to the Dock's
WebSocket for audio and MCP. Stopping both listeners can prevent the robot from
entering the local product runtime correctly.

On Windows, `python .\scripts\ble-provision-wifi-audio.py --scan` lists only
advertising StackChan devices. After selecting its current BLE address, run
`.\scripts\provision-xiaozhi-dock.ps1 -BleAddress <address>` for a read-only
preflight and add `-Execute` for the one-time bootstrap write. The wrapper reads
the PC's existing route and the current-user DPAPI secret, does not place the
secret on the command line, preserves the robot's existing Wi-Fi credentials,
and never changes the PC network.

For hardware diagnostics, start the same runtime without MCP stdio:

```powershell
.\scripts\start-xiaozhi-dock.ps1
```

After the robot is authenticated and its development HTTP control is reachable,
the repository-level `ops\bin\test-xiaozhi-audio-hil.ps1 -Execute` command injects
the embedded, version-controlled 16 kHz voice sample through the robot's official
`AudioService -> Opus -> WebSocket` uplink, captures `CABLE Output` with native
WASAPI, and compares the received samples to that exact source. Run the command
without `-Execute` for a read-only preflight. This known-source gate validates the
digital uplink but does not replace a separate physical-microphone recording or
the user's final listening decision.

The complementary `ops\bin\test-xiaozhi-speaker-hil.ps1 -Execute` command plays
the same fixed voice sample from a bounded Windows fixture process, captures only
that process through the production loopback broker, and sends official 24 kHz
Opus downlink to the robot. It can prove the controlled downlink completed, but
it deliberately leaves speaker quality pending until the user hears the robot.

The user starts and stops Codex Voice manually. For the official XiaoZhi route,
configure the Voice devices as follows:

- microphone: `CABLE Output (VB-Audio Virtual Cable)`, which receives the
  robot's decoded Wi-Fi uplink;
- speaker: the user's normal Windows output or another non-CABLE render
  endpoint. The Dock captures the Codex process tree directly and forwards the
  same assistant audio to Stack-chan;
- never select `CABLE Input` as the Codex Voice speaker, because that would feed
  assistant audio back into the virtual microphone.

The configured Codex `stackchan_wifi` MCP server is the normal owner of the
bootstrap/WebSocket ports, WASAPI bridge and typed robot tools. Do not run the
standalone diagnostic Dock at the same time.

## Legacy USB Companion (rollback/reference only)

The following UAC2/CDC Companion behavior predates the official XiaoZhi Wi-Fi
route. It is not the normal product startup path and must not be used as evidence
that the current Wi-Fi product depends on USB.

### Boundary

- Discovers only USB `VID 303A / PID 8001`, and when Windows exposes a composite interface number, only `MI_03`.
- Resolves the stable USB composite-parent serial through Windows PnP after filtering VID/PID/MI_03, then pins that identity; a changed COM number or child-interface instance id is expected after unplug or reboot.
- Keeps retrying with bounded exponential backoff. A missing or disconnected device does not terminate the Dock process.
- Performs a `get_status` handshake, checks device/protocol identity, and uses `event_sequence` to reject duplicate events and resynchronize after gaps.
- MCP control methods are limited to status, robot audio endpoints, expression, LED and head controls. There is no raw command or passthrough API. Speech-bubble text is a Dock-owned presentation path and is not exposed through MCP.
- This process does not start or stop the Codex Voice session. It observes the existing session's reply lifecycle read-only so Wi-Fi audio can switch the robot between listening and speaking.
- The Companion runtime tails the current user's Codex desktop log database read-only and consumes assistant `OutputTranscriptDelta` / `OutputTranscriptDone` plus user `InputTranscriptDelta` interruption events. It does not open another app-server, Voice session, WebRTC connection, or audio stream.

### Commands

```powershell
npm install
npm run check
npm test
npm start
npm run start:dock
npm run start:mcp
```

`STACKCHAN_USB_SERIAL` may be set to the 12-character factory-MAC serial when more than one companion is connected. Do not configure a fixed COM port.

`npm start` runs the complete Companion: the reconnecting Dock plus the read-only Codex Voice transcript source and speech-bubble presenter. It starts at the current end of the Codex log so historic replies are not replayed. `npm run start:dock` runs only the device lifecycle/status CLI.

When the real device state reports `microphone_enabled=false`, the Companion clears the speech bubble immediately. This display cleanup does not start, stop, mute, or otherwise control the Codex Voice session.

The same Companion lifecycle drives a firmware-owned fixed-cadence mouth animation while an assistant reply is active. It starts on the first assistant output delta and stops on output done, user interruption, disconnect, source error, or process shutdown. Microphone mute is independent from assistant playback. The cadence is fixed in firmware at 180 ms, does not inspect the USB audio stream, and does not move the servos.

The CLI prints newline-delimited lifecycle, state and device-event JSON. The stdio MCP server publishes exactly six tools for live status, robot audio endpoints, expression, LED, and head pose. It is built only on the exported `StackchanDock` typed methods and has no raw command or generic transport tool. The Dock may use its internal bounded speech-text and talking-animation methods for Companion presentation without publishing them as MCP tools.

The transcript integration depends on Codex desktop's private `logs_2.sqlite` schema and is therefore a version-sensitive MVP adapter. `CODEX_LOGS_DATABASE` may override the database location for diagnostics; by default the runtime resolves `.codex/logs_2.sqlite` from the current Windows user profile rather than hard-coding a user path.

## Legacy raw-PCM Wi-Fi experiment (rollback only)

The section below documents the superseded first experiment for diagnostics and
rollback. It is not the current XiaoZhi product route and must not be launched
alongside the official runtime above.

The Wi-Fi firmware keeps authenticated typed control and 24 kHz speaker PCM on
one WebSocket connection. The verified four-slot TDM MIC1 path stays at its
native 24 kHz sample rate: two 10 ms reads are combined into one 20 ms,
960-byte mono `pcm_s16le` frame and sent over the session-bound authenticated
UDP microphone channel. The Dock forwards those bytes unchanged to the
24 kHz VB-CABLE player. The microphone payload is authenticated but not
encrypted; keep it on a trusted LAN. The MCP surface remains the same six
strict tools and does not expose a raw request.

There must be exactly one Wi-Fi Dock owner on port `8765`; microphone UDP,
speaker WebSocket audio, and typed control share one authenticated session. For normal Codex use,
the configured `stackchan_wifi`
MCP server owns that listener and the same process also owns VB-CABLE input,
the speaker named pipe, Codex reply lifecycle observation, and typed robot
control. Do not also start `start-wifi-audio-dock.ps1`; that standalone entry
is only for diagnostics outside a Codex MCP session. A port-in-use failure is
an ownership conflict, not a reason to launch another Dock.

For standalone diagnostics, start the Wi-Fi Dock and then the process-tree
speaker bridge:

```powershell
.\scripts\start-wifi-audio-dock.ps1 -MicrophoneEnabled $true
.\scripts\start-codex-voice-speaker-bridge.ps1
```

The second command automatically finds the single root `ChatGPT.exe` process.
Pass `-TargetProcessId` only when more than one Codex app root is running. The
bridge captures the Codex process tree directly, converts it to 24 kHz mono
signed PCM, removes idle frames, and writes only active audio to
`\\.\pipe\stackchan-wifi-speaker`.

The user still starts and stops Codex Voice manually. Configure its devices as:

- microphone: `CABLE Output (VB-Audio Virtual Cable)`;
- speaker: `扬声器 (Steam Streaming Microphone)`, used only as a silent render
  endpoint while process loopback forwards the same app audio to Stack-chan;
- do not select `CABLE Input` for Codex Voice output, because that would route
  assistant audio back into its microphone.

This first version is deliberately half duplex. While listening, the firmware
keeps the speaker codec closed and captures/encodes microphone audio. The first Codex
assistant output event closes microphone input before opening speaker output.
After assistant output is done, the firmware drains queued PCM plus a bounded
400 ms tail, closes speaker output, and restores the user's microphone setting.
The first speaker PCM frame is a fallback if the lifecycle event is late or
unavailable. If the reply-end control message is lost, three seconds without
speaker PCM forces the same bounded return to listening. No AEC or simultaneous
microphone/speaker claim is made.

The VB-CABLE writer converts 24 kHz microphone PCM to its native 48 kHz stream
with stateful linear interpolation across 10 ms frame boundaries; it no longer
duplicates every sample.

Robot LED states are amber while waiting for the Dock, green while listening,
gray while the robot microphone is disabled, blue for the complete speaking phase, and
red for a transport or codec fault. Forward/backward head swipes change only
the robot microphone state; the speaker stays enabled. A vertical drag from
anywhere on the screen previews volume as a black full-screen overlay with a
bottom-up green fill and persists the selected volume on release.
