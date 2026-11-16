const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('lapian', {
  isDesktop: true,
  // 新版 Electron 用这个拿真实路径（file.path 已被移除）
  pathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch (e) { return ''; } },
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  listVideos: (dir) => ipcRenderer.invoke('list-videos', dir),
  statPath: (p) => ipcRenderer.invoke('stat-path', p),
  notesLoad: (p) => ipcRenderer.invoke('notes-load', p),
  notesSave: (p, data) => ipcRenderer.invoke('notes-save', p, data),
  exportClip: (opt) => ipcRenderer.invoke('export-clip', opt),
  burnFrames: (opt) => ipcRenderer.invoke('burn-frames', opt),
  writeFile: (p, b64) => ipcRenderer.invoke('write-file', p, b64),
  tempDir: () => ipcRenderer.invoke('temp-dir'),
  probe: (p) => ipcRenderer.invoke('probe', p),
  reveal: (p) => ipcRenderer.invoke('reveal', p),
  projectsList: () => ipcRenderer.invoke('projects-list'),
  projectSave: (p) => ipcRenderer.invoke('project-save', p),
  projectRemove: (id) => ipcRenderer.invoke('project-remove', id),
  mediaUrl: (p) => 'lap://media?p=' + encodeURIComponent(p),
  onMenu: (cb) => ipcRenderer.on('menu', (e, cmd) => cb(cmd))
});
