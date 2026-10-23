// The window's only door to the main process. The renderer gets these few
// calls and nothing else from Node or Electron.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("larper", {
  init: () => ipcRenderer.invoke("larper:init"),
  submit: (line) => ipcRenderer.invoke("larper:submit", String(line)),
  interrupt: () => ipcRenderer.send("larper:interrupt"),
  approve: (id, answer) => ipcRenderer.send("larper:approve", id, answer),
  pickFolder: () => ipcRenderer.invoke("larper:pickFolder"),
  onEvent: (fn) => {
    const listener = (_e, name, payload) => fn(name, payload);
    ipcRenderer.on("larper:event", listener);
    return () => ipcRenderer.off("larper:event", listener);
  },
  onApproval: (fn) => {
    const listener = (_e, id, req) => fn(id, req);
    ipcRenderer.on("larper:approval", listener);
    return () => ipcRenderer.off("larper:approval", listener);
  },
});
