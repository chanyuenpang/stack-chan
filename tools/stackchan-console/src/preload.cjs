const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("stackchanConsole", Object.freeze({
  getState: () => ipcRenderer.invoke("stackchan:get-state"),
  getSubtitle: () => ipcRenderer.invoke("stackchan:get-subtitle"),
  setSubtitleEnabled: (enabled) => ipcRenderer.invoke("stackchan:set-subtitle-enabled", enabled),
  refresh: () => ipcRenderer.invoke("stackchan:refresh"),
  getSpeakerVolume: () => ipcRenderer.invoke("stackchan:get-speaker-volume"),
  setSpeakerVolume: (volume) => ipcRenderer.invoke("stackchan:set-speaker-volume", volume),
  getSpeakerMode: () => ipcRenderer.invoke("stackchan:get-speaker-mode"),
  setSpeakerMode: (enabled) => ipcRenderer.invoke("stackchan:set-speaker-mode", enabled),
  onState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("stackchan:state", handler);
    return () => ipcRenderer.removeListener("stackchan:state", handler);
  },
  onSubtitle: (listener) => {
    const handler = (_event, subtitle) => listener(subtitle);
    ipcRenderer.on("stackchan:subtitle", handler);
    return () => ipcRenderer.removeListener("stackchan:subtitle", handler);
  },
  onSpeakerMode: (listener) => {
    const handler = (_event, mode) => listener(mode);
    ipcRenderer.on("stackchan:speaker-mode", handler);
    return () => ipcRenderer.removeListener("stackchan:speaker-mode", handler);
  },
}));
