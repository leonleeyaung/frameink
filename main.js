// 拉片标注器 · 桌面版主进程
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, Tray, nativeImage, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const FFMPEG = process.env.LAPIAN_FFMPEG ||
  (fs.existsSync('C:\\Users\\leonl\\Documents\\deepseek-harness\\default-workspace\\tools\\ffmpeg.exe')
    ? 'C:\\Users\\leonl\\Documents\\deepseek-harness\\default-workspace\\tools\\ffmpeg.exe'
    : 'ffmpeg');

const VIDEO_EXT = ['.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi', '.flv', '.ts'];
let win = null;
let tray = null;

const PROJ_FILE = path.join(app.getPath('userData'), 'projects.json');

protocol.registerSchemesAsPrivileged([
  { scheme: 'lap', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
]);

function notePathOf(videoPath) {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  return path.join(dir, base + '.拉片注释.json');
}

function mimeOf(p) {
  const e = path.extname(p).toLowerCase();
  return ({
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
    '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
    '.flv': 'video/x-flv', '.ts': 'video/mp2t', '.json': 'application/json'
  })[e] || 'application/octet-stream';
}

function streamToWeb(nodeStream) {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)));
      nodeStream.on('end', () => controller.close());
      nodeStream.on('error', (err) => controller.error(err));
    },
    cancel() { nodeStream.destroy(); }
  });
}

function registerProtocol() {
  protocol.handle('lap', async (request) => {
    try {
      const url = new URL(request.url);
      const p = decodeURIComponent(url.searchParams.get('p') || '');
      if (!p || !fs.existsSync(p)) return new Response('not found', { status: 404 });
      const stat = fs.statSync(p);
      const type = mimeOf(p);
      const range = request.headers.get('range');
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
        const start = m[1] ? parseInt(m[1], 10) : 0;
        const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
        const stream = fs.createReadStream(p, { start, end });
        return new Response(streamToWeb(stream), {
          status: 206,
          headers: {
            'Content-Type': type,
            'Content-Length': String(end - start + 1),
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${start}-${end}/${stat.size}`
          }
        });
      }
      return new Response(streamToWeb(fs.createReadStream(p)), {
        status: 200,
        headers: { 'Content-Type': type, 'Content-Length': String(stat.size), 'Accept-Ranges': 'bytes' }
      });
    } catch (e) {
      return new Response('error: ' + e.message, { status: 500 });
    }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 950, minWidth: 980, minHeight: 620,
    backgroundColor: '#1b1e24',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', '拉片标注器.html'));
  win.once('ready-to-show', () => win.show());

  win.webContents.on('context-menu', (e, params) => {
    const template = [];
    if (params.isEditable) {
      template.push(
        { label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' },
        { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' }
      );
    } else if (params.selectionText) {
      template.push({ label: '复制选中', role: 'copy' });
    } else {
      template.push(
        { label: '导入视频…', click: () => win.webContents.send('menu', 'import-files') },
        { label: '导入文件夹…', click: () => win.webContents.send('menu', 'import-folder') },
        { type: 'separator' },
        { label: '撤销', click: () => win.webContents.send('menu', 'undo') },
        { label: '前进', click: () => win.webContents.send('menu', 'redo') },
        { type: 'separator' },
        { label: '保存注释', click: () => win.webContents.send('menu', 'save') },
        { label: '导出选区为视频…', click: () => win.webContents.send('menu', 'export-clip') },
        { type: 'separator' },
        { label: '打开所在文件夹', click: () => win.webContents.send('menu', 'reveal') }
      );
    }
    Menu.buildFromTemplate(template).popup({ window: win });
  });

  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; });
}

/* ---------------- 工程存储 ---------------- */
function readProjects() {
  try { return JSON.parse(fs.readFileSync(PROJ_FILE, 'utf8')); } catch (e) { return { list: [] }; }
}
function writeProjects(d) {
  try { fs.mkdirSync(path.dirname(PROJ_FILE), { recursive: true }); fs.writeFileSync(PROJ_FILE, JSON.stringify(d, null, 2), 'utf8'); } catch (e) {}
}

ipcMain.handle('projects-list', () => readProjects().list || []);

const SAVE_LOG = () => path.join(app.getPath('userData'), 'save.log');
function logSave(msg) {
  try { fs.appendFileSync(SAVE_LOG(), new Date().toISOString() + ' ' + msg + '\n'); } catch (err) {}
}

ipcMain.handle('project-save', (e, proj) => {
  const d = readProjects();
  d.list = d.list || [];
  const i = d.list.findIndex(x => x.id === proj.id);
  proj.updatedAt = Date.now();
  if (i >= 0) d.list[i] = proj; else d.list.unshift(proj);
  d.list = d.list.slice(0, 40);
  writeProjects(d);
  logSave('saved ' + (proj && proj.name) + ' videos=' + ((proj && proj.videos) ? proj.videos.length : 0));
  return true;
});

ipcMain.handle('project-remove', (e, id) => {
  const d = readProjects();
  d.list = (d.list || []).filter(x => x.id !== id);
  writeProjects(d);
  logSave('saved ' + (proj && proj.name) + ' videos=' + ((proj && proj.videos) ? proj.videos.length : 0));
  return true;
});

/* ---------------- 文件 ---------------- */
ipcMain.handle('pick-files', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '导入视频',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '视频', extensions: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'flv', 'ts'] }]
  });
  if (r.canceled) return [];
  return r.filePaths.map(p => ({ path: p, name: path.basename(p), size: fs.statSync(p).size, hasNote: fs.existsSync(notePathOf(p)) }));
});

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { title: '选择视频文件夹', properties: ['openDirectory'] });
  if (r.canceled) return { dir: null, files: [] };
  return { dir: r.filePaths[0], files: listVideos(r.filePaths[0]) };
});

function listVideos(dir) {
  const files = [];
  const MAX_FILES = 20000;
  const MAX_DEPTH = 8;
  const skipDirs = new Set(['$RECYCLE.BIN', 'System Volume Information', 'node_modules', '.git']);

  function walk(cur, depth) {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
    let entries = [];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of entries) {
      if (files.length >= MAX_FILES) return;
      const p = path.join(cur, ent.name);
      try {
        if (ent.isDirectory()) {
          if (skipDirs.has(ent.name)) continue;
          walk(p, depth + 1);
        } else if (ent.isFile()) {
          if (!VIDEO_EXT.includes(path.extname(ent.name).toLowerCase())) continue;
          const st = fs.statSync(p);
          files.push({
            path: p,
            name: ent.name,
            rel: path.relative(dir, p),
            size: st.size,
            hasNote: fs.existsSync(notePathOf(p))
          });
        }
      } catch (e) {}
    }
  }

  walk(dir, 0);
  files.sort((a, b) => (a.rel || a.name).localeCompare(b.rel || b.name, 'zh'));
  return files;
}

ipcMain.handle('list-videos', (e, dir) => listVideos(dir));

ipcMain.handle('stat-path', (e, p) => {
  try {
    if (!p || !fs.existsSync(p)) return { exists: false, isDir: false };
    const st = fs.statSync(p);
    return { exists: true, isDir: st.isDirectory(), size: st.size };
  } catch (err) { return { exists: false, isDir: false }; }
});

ipcMain.handle('notes-load', async (e, videoPath) => {
  try {
    const np = notePathOf(videoPath);
    if (!fs.existsSync(np)) return null;
    return JSON.parse(fs.readFileSync(np, 'utf8'));
  } catch (err) { return null; }
});

ipcMain.handle('notes-save', async (e, videoPath, data) => {
  try {
    const np = notePathOf(videoPath);
    fs.writeFileSync(np, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true, path: np };
  } catch (err) { return { ok: false, error: err.message }; }
});

/* ---------------- ffmpeg ---------------- */
ipcMain.handle('export-clip', async (e, opt) => {
  return new Promise((resolve) => {
    if (!opt || !opt.videoPath || !fs.existsSync(opt.videoPath)) {
      return resolve({ ok: false, error: '视频路径无效：' + (opt && opt.videoPath ? opt.videoPath : '(空)') + '\n请用「导入文件夹」或「导入视频」打开，别用拖拽。' });
    }
    const args = ['-y', '-ss', String(opt.startSec), '-to', String(opt.endSec), '-i', opt.videoPath,
      '-c', 'copy', '-avoid_negative_ts', 'make_zero', opt.outPath];
    const p = spawn(FFMPEG, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('close', (code) => {
      if (code === 0 && fs.existsSync(opt.outPath)) return resolve({ ok: true, path: opt.outPath });
      const args2 = ['-y', '-ss', String(opt.startSec), '-to', String(opt.endSec), '-i', opt.videoPath,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', opt.outPath];
      const p2 = spawn(FFMPEG, args2, { windowsHide: true });
      let err2 = '';
      p2.stderr.on('data', (d) => { err2 += d.toString(); });
      p2.on('close', (code2) => {
        if (code2 === 0 && fs.existsSync(opt.outPath)) return resolve({ ok: true, path: opt.outPath, reencoded: true });
        const tail = (err2 || err).split('\n').filter(x => /error|Invalid|No such|fail/i.test(x)).slice(-3).join('\n');
        resolve({ ok: false, error: tail || (err2 || err).slice(-400) });
      });
    });
    p.on('error', (er) => resolve({ ok: false, error: 'ffmpeg 启动失败：' + er.message + '\n路径：' + FFMPEG }));
  });
});

ipcMain.handle('probe', async (e, videoPath) => {
  return new Promise((resolve) => {
    if (!videoPath || !fs.existsSync(videoPath)) return resolve({ error: '路径无效' });
    const p = spawn(FFMPEG, ['-hide_banner', '-i', videoPath], { windowsHide: true });
    let out = '';
    p.stderr.on('data', (d) => { out += d.toString(); });
    p.on('close', () => {
      const dur = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(out);
      let fps = null;
      const m1 = /(\d+(?:\.\d+)?)\s*fps/.exec(out);
      const m2 = /\b(\d+)\/(\d+)\b/.exec((/\b(\d+)\/(\d+)\s*,\s*/.exec(out) || [])[0] || '');
      if (m1) fps = parseFloat(m1[1]);
      if (!fps && m2) fps = parseInt(m2[1], 10) / parseInt(m2[2], 10);
      const wh = /,\s*(\d{2,5})x(\d{2,5})/.exec(out);
      resolve({
        duration: dur ? (+dur[1]) * 3600 + (+dur[2]) * 60 + (+dur[3]) : null,
        fps: fps ? Math.round(fps * 1000) / 1000 : null,
        width: wh ? parseInt(wh[1], 10) : null,
        height: wh ? parseInt(wh[2], 10) : null,
        raw: out.slice(0, 200)
      });
    });
    p.on('error', (er) => resolve({ error: er.message }));
  });
});

/* 带注释导出：把 PNG 帧写盘，交给 ffmpeg 合成 */
ipcMain.handle('burn-frames', async (e, opt) => {
  // opt: { framesDir, fps, audioFrom, startSec, endSec, outPath }
  return new Promise((resolve) => {
    const args = ['-y',
      '-framerate', String(opt.fps),
      '-i', path.join(opt.framesDir, 'f_%06d.png'),
      '-ss', String(opt.startSec), '-t', String(opt.duration || 0), '-i', opt.audioFrom,
      '-map', '0:v:0', '-map', '1:a:0?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
      '-c:a', 'aac', '-b:a', '192k', '-shortest',
      opt.outPath];
    const p = spawn(FFMPEG, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('close', (code) => {
      if (code === 0 && fs.existsSync(opt.outPath)) resolve({ ok: true, path: opt.outPath });
      else resolve({ ok: false, error: err.split('\n').slice(-6).join('\n') });
    });
    p.on('error', (er) => resolve({ ok: false, error: er.message }));
  });
});

ipcMain.handle('write-file', async (e, p, b64) => {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.from(b64, 'base64'));
    return true;
  } catch (err) { return false; }
});

ipcMain.handle('temp-dir', () => {
  const d = path.join(app.getPath('temp'), 'lapian-' + Date.now());
  fs.mkdirSync(d, { recursive: true });
  return d;
});

ipcMain.handle('reveal', async (e, p) => { try { shell.showItemInFolder(p); return true; } catch (err) { return false; } });

/* ---------------- 托盘 ---------------- */
function createTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.setToolTip('拉片标注器');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示窗口', click: () => { if (win) { win.show(); win.focus(); } else createWindow(); } },
      { type: 'separator' },
      { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
    ]));
    tray.on('double-click', () => { if (win) { win.show(); win.focus(); } });
  } catch (e) {}
}

app.whenReady().then(() => {
  registerProtocol();
  createWindow();
  createTray();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { });
app.on('before-quit', () => { app.isQuitting = true; });
