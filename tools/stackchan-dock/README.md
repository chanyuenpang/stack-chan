# Stack-chan Codex Companion Dock

Windows lifecycle and control layer for the ESP-IDF UAC2 + CDC-ACM Stack-chan firmware.

## Boundary

- Discovers only USB `VID 303A / PID 8001`, and when Windows exposes a composite interface number, only `MI_03`.
- Resolves the stable USB composite-parent serial through Windows PnP after filtering VID/PID/MI_03, then pins that identity; a changed COM number or child-interface instance id is expected after unplug or reboot.
- Keeps retrying with bounded exponential backoff. A missing or disconnected device does not terminate the Dock process.
- Performs a `get_status` handshake, checks device/protocol identity, and uses `event_sequence` to reject duplicate events and resynchronize after gaps.
- MCP control methods are limited to status, robot audio endpoints, expression, LED and head controls. There is no raw command or passthrough API. Speech-bubble text is a Dock-owned presentation path and is not exposed through MCP.
- This process does not manage the Codex Voice session lifecycle. Touch events only report device input and synchronize the robot's own audio data-path state.
- The Companion runtime tails the current user's Codex desktop log database read-only and consumes assistant `OutputTranscriptDelta` / `OutputTranscriptDone` plus user `InputTranscriptDelta` interruption events. It does not open another app-server, Voice session, WebRTC connection, or audio stream.

## Commands

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

The same Companion lifecycle drives a firmware-owned fixed-cadence mouth animation while an assistant reply is active. It starts on the first assistant output delta and stops on output done, user interruption, robot microphone disable, disconnect, source error, or process shutdown. The cadence is fixed in firmware at 180 ms, does not inspect the USB audio stream, does not move the servos, and does not change the white/green audio-state LED.

The CLI prints newline-delimited lifecycle, state and device-event JSON. The stdio MCP server publishes exactly six tools for live status, robot audio endpoints, expression, LED, and head pose. It is built only on the exported `StackchanDock` typed methods and has no raw command or generic transport tool. The Dock may use its internal bounded speech-text and talking-animation methods for Companion presentation without publishing them as MCP tools.

The transcript integration depends on Codex desktop's private `logs_2.sqlite` schema and is therefore a version-sensitive MVP adapter. `CODEX_LOGS_DATABASE` may override the database location for diagnostics; by default the runtime resolves `.codex/logs_2.sqlite` from the current Windows user profile rather than hard-coding a user path.
