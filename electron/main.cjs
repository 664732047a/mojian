const { app, BrowserWindow, dialog, ipcMain, Menu, shell, protocol, net } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { atomicWrite, readJSON, listTree, isWithin, VersionStore, migrateMarkdownImages, createMarkdownFile, MARKDOWN_EXTENSIONS, IMAGE_EXTENSIONS } = require('./file-store.cjs');

app.setName('墨笺');
if (process.env.MOJIAN_USER_DATA) app.setPath('userData', path.resolve(process.env.MOJIAN_USER_DATA));
protocol.registerSchemesAsPrivileged([{ scheme: 'mojian-file', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

let window;
let closeApproved = false;
let quitting = false;
let settings = {};
let recentFiles = [];
const folderWatchers = new Map();
const folderDebounces = new Map();
let rendererReady = false;
const pendingFiles = [];
const authorizedRoots = new Set();
const documentWatchers = new Map();
const documentContents = new Map();
const documentDebounces = new Map();
const saveQueues = new Map();
let settingsQueue = Promise.resolve();
let recoveryQueue = Promise.resolve();
const markdownFilters = [{ name: 'Markdown 文档', extensions: [...MARKDOWN_EXTENSIONS].map(ext => ext.slice(1)) }, { name: '所有文件', extensions: ['*'] }];
const imageExtensions = IMAGE_EXTENSIONS;
const defaults = { theme: 'system', autoSave: true, fontSize: 17, editorZoom: 1, lineHeight: 1.85, editorWidth: 780, spellcheck: false, restoreSession: true };
const dataPath = (...parts) => path.join(app.getPath('userData'), ...parts);
const versions = () => new VersionStore(dataPath('versions'));

function send(channel, payload) { if (window && !window.isDestroyed()) window.webContents.send(`mojian:${channel}`, payload); }
function menu(command) { send('menu', command); }
function assertString(value, maximum = 20 * 1024 * 1024) {
  if (typeof value !== 'string' || value.length > maximum) throw new Error('内容格式不正确或文件过大。');
  return value;
}
async function grantRoot(root) {
  const resolved = await fsp.realpath(root);
  authorizedRoots.add(resolved);
  return resolved;
}
async function requirePath(filePath, allowMissing = false) {
  assertString(filePath, 8192);
  const absolute = path.resolve(filePath);
  let resolved;
  try { resolved = await fsp.realpath(absolute); }
  catch (error) {
    if (!allowMissing || error.code !== 'ENOENT') throw error;
    resolved = path.join(await fsp.realpath(path.dirname(absolute)), path.basename(absolute));
  }
  if (![...authorizedRoots].some(root => isWithin(root, resolved))) throw new Error('请先通过“打开文件”或“打开文件夹”选择这个位置。');
  return resolved;
}
async function remember(filePath) {
  recentFiles = [{ path: filePath, name: path.basename(filePath) }, ...recentFiles.filter(item => item.path !== filePath)].slice(0, 20);
  await atomicWrite(dataPath('recent.json'), JSON.stringify(recentFiles));
  app.addRecentDocument(filePath);
  buildMenu();
}
function watchDocument(filePath) {
  if (documentWatchers.has(filePath)) return;
  // Watch the directory because atomic replacements change the document inode.
  try {
    const watcher = fs.watch(path.dirname(filePath), (_event, name) => {
      if (name && name.toString() !== path.basename(filePath)) return;
      clearTimeout(documentDebounces.get(filePath));
      documentDebounces.set(filePath, setTimeout(async () => {
        try {
          const content = await fsp.readFile(filePath, 'utf8');
          if (content !== documentContents.get(filePath)) {
            documentContents.set(filePath, content);
            send('external-change', { path: filePath, name: path.basename(filePath), content });
          }
        } catch (error) { if (error.code === 'ENOENT') send('external-change', { path: filePath, deleted: true }); }
      }, 240));
    });
    watcher.on('error', () => {});
    documentWatchers.set(filePath, watcher);
  } catch { /* Opening a file is still possible when its directory cannot be watched. */ }
}
async function readDocument(filePath) {
  const safePath = await requirePath(filePath);
  const stat = await fsp.stat(safePath);
  if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error('文档超过 20 MB，暂时无法打开。');
  const content = await fsp.readFile(safePath, 'utf8');
  documentContents.set(safePath, content);
  watchDocument(safePath);
  await remember(safePath);
  return { path: safePath, name: path.basename(safePath), content };
}
async function openDocument(filePath) {
  await grantRoot(path.dirname(filePath));
  return readDocument(filePath);
}
async function deliverDocument(filePath) {
  if (!rendererReady) { pendingFiles.push(filePath); return; }
  try { send('open-file', await openDocument(filePath)); }
  catch (error) { dialog.showErrorBox('无法打开文档', error.message); }
}
async function watchFolder(folderPath) {
  const safePath = await requirePath(folderPath);
  if (folderWatchers.has(safePath)) return true;
  try {
    const watcher = fs.watch(safePath, { recursive: true }, () => {
      clearTimeout(folderDebounces.get(safePath));
      folderDebounces.set(safePath, setTimeout(async () => {
        try { send('folder-changed', { path: safePath, tree: await listTree(safePath) }); } catch { /* Folder may have moved. */ }
      }, 450));
    });
    watcher.on('error', () => {});
    folderWatchers.set(safePath, watcher);
  } catch { /* User may still browse manually. */ }
  return true;
}
async function saveDocument(options) {
  assertString(options?.content);
  const sourcePath = options.sourcePath ? await requirePath(options.sourcePath) : null;
  const previousPath = options.path || sourcePath;
  let filePath = options.path;
  if (!filePath || options.saveAs) {
    const result = await dialog.showSaveDialog(window, { title: options.saveAs ? '文档另存为' : '保存文档', defaultPath: filePath || '未命名.md', filters: markdownFilters });
    if (result.canceled || !result.filePath) return null;
    filePath = result.filePath;
    if (!path.extname(filePath)) filePath += '.md';
    await grantRoot(path.dirname(filePath));
  }
  filePath = await requirePath(filePath, true);
  const previous = saveQueues.get(filePath) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    let oldContent;
    try { oldContent = await fsp.readFile(filePath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const content = await migrateMarkdownImages(options.content, {
      previousPath, nextPath: filePath, attachmentDirectory: dataPath('attachments'),
      authorize: candidate => requirePath(candidate),
    });
    if (oldContent !== undefined && oldContent !== content) await versions().add(filePath, oldContent);
    // Set before rename so filesystem watchers do not echo our own save.
    documentContents.set(filePath, content);
    await atomicWrite(filePath, content);
    watchDocument(filePath);
    await remember(filePath);
    return { path: filePath, name: path.basename(filePath), content };
  });
  saveQueues.set(filePath, operation);
  try { return await operation; }
  finally { if (saveQueues.get(filePath) === operation) saveQueues.delete(filePath); }
}

async function imageDirectory(documentPath) {
  if (documentPath) {
    const safePath = await requirePath(documentPath, true);
    const directory = path.join(path.dirname(safePath), 'assets');
    await fsp.mkdir(directory, { recursive: true });
    return requirePath(directory);
  }
  const directory = dataPath('attachments');
  await fsp.mkdir(directory, { recursive: true });
  await grantRoot(directory);
  return directory;
}
function imageResult(filePath, documentPath) {
  const markdownPath = documentPath ? path.relative(path.dirname(documentPath), filePath).split(path.sep).join('/') : pathToFileURL(filePath).href;
  return { name: path.basename(filePath), path: filePath, url: `mojian-file://local/?path=${encodeURIComponent(filePath)}`, markdownPath };
}
async function importImages(options = {}) {
  const result = await dialog.showOpenDialog(window, { title: '插入图片', properties: ['openFile', 'multiSelections'], filters: [{ name: '图片', extensions: [...imageExtensions].map(ext => ext.slice(1)) }] });
  if (result.canceled) return [];
  const directory = await imageDirectory(options.documentPath);
  const results = [];
  for (const sourcePath of result.filePaths) {
    const extension = path.extname(sourcePath).toLowerCase();
    if (!imageExtensions.has(extension)) continue;
    const destination = path.join(directory, `${path.basename(sourcePath, path.extname(sourcePath)).replace(/[^\p{L}\p{N}_.-]/gu, '-')}-${crypto.randomBytes(3).toString('hex')}${extension}`);
    await fsp.copyFile(sourcePath, destination);
    results.push(imageResult(destination, options.documentPath));
  }
  return results;
}
async function saveImage(options) {
  assertString(options?.dataUrl, 50 * 1024 * 1024);
  const match = /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml|avif);base64,([a-zA-Z0-9+/=\r\n]+)$/.exec(options.dataUrl);
  if (!match) throw new Error('不支持的图片格式。');
  const extension = { 'svg+xml': 'svg', jpeg: 'jpg' }[match[1]] || match[1];
  const directory = await imageDirectory(options.documentPath);
  const filePath = path.join(directory, `image-${Date.now()}-${crypto.randomBytes(2).toString('hex')}.${extension}`);
  await atomicWrite(filePath, Buffer.from(match[2], 'base64'));
  return imageResult(filePath, options.documentPath);
}

async function exportDocument(options) {
  assertString(options?.html);
  if (!['html', 'pdf'].includes(options.format)) throw new Error('不支持的导出格式。');
  const result = await dialog.showSaveDialog(window, { title: `导出 ${options.format.toUpperCase()}`, defaultPath: `${path.basename(options.suggestedName || '未命名', path.extname(options.suggestedName || ''))}.${options.format}`, filters: [{ name: options.format.toUpperCase(), extensions: [options.format] }] });
  if (result.canceled || !result.filePath) return null;
  if (options.format === 'html') await atomicWrite(result.filePath, options.html);
  else {
    const temporaryPath = dataPath(`export-${crypto.randomUUID()}.html`);
    const exportWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
    exportWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    try {
      await atomicWrite(temporaryPath, options.html);
      await exportWindow.loadFile(temporaryPath);
      await exportWindow.webContents.executeJavaScript('document.fonts.ready').catch(() => {});
      const pdf = await exportWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0.55, bottom: 0.55, left: 0.55, right: 0.55 }, preferCSSPageSize: true });
      await atomicWrite(result.filePath, pdf);
    } finally { exportWindow.destroy(); await fsp.rm(temporaryPath, { force: true }).catch(() => {}); }
  }
  return { path: result.filePath };
}

function buildMenu() {
  const action = (label, command, accelerator) => ({ label, accelerator, click: () => menu(command) });
  const recent = recentFiles.slice(0, 10).map(item => ({ label: item.name, sublabel: item.path, click: () => deliverDocument(item.path) }));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '墨笺', submenu: [{ role: 'about', label: '关于墨笺' }, { type: 'separator' }, action('偏好设置…', 'preferences', 'CmdOrCtrl+,'), { type: 'separator' }, { role: 'services', label: '服务' }, { type: 'separator' }, { role: 'hide', label: '隐藏墨笺' }, { role: 'hideOthers', label: '隐藏其他' }, { role: 'unhide', label: '显示全部' }, { type: 'separator' }, { role: 'quit', label: '退出墨笺' }] },
    { label: '文件', submenu: [action('新建文档', 'new', 'CmdOrCtrl+N'), action('打开文档…', 'open', 'CmdOrCtrl+O'), action('打开文件夹…', 'open-folder', 'CmdOrCtrl+Shift+O'), { label: '最近打开', submenu: recent.length ? recent : [{ label: '暂无最近文档', enabled: false }] }, { type: 'separator' }, action('保存', 'save', 'CmdOrCtrl+S'), action('另存为…', 'save-as', 'CmdOrCtrl+Shift+S'), { type: 'separator' }, { label: '导出', submenu: [action('PDF 文档…', 'export-pdf'), action('HTML 网页…', 'export-html')] }, { type: 'separator' }, action('关闭标签页', 'close-tab', 'CmdOrCtrl+W')] },
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'pasteAndMatchStyle', label: '粘贴为纯文本' }, { role: 'selectAll', label: '全选' }, { type: 'separator' }, action('查找', 'find', 'CmdOrCtrl+F'), action('查找与替换', 'replace', 'CmdOrCtrl+Shift+H')] },
    { label: '格式', submenu: [action('粗体', 'bold', 'CmdOrCtrl+B'), action('斜体', 'italic', 'CmdOrCtrl+I'), action('删除线', 'strike', 'CmdOrCtrl+Shift+X'), { type: 'separator' }, ...[1, 2, 3, 4, 5, 6].map(level => action(`${level} 级标题`, `heading-${level}`, `CmdOrCtrl+${level}`)), { type: 'separator' }, action('链接…', 'link', 'CmdOrCtrl+K'), action('图片…', 'image', 'CmdOrCtrl+Shift+I'), action('表格', 'table', 'CmdOrCtrl+Alt+T'), action('代码块', 'code', 'CmdOrCtrl+Alt+C'), action('引用', 'quote', 'CmdOrCtrl+Shift+Q'), action('无序列表', 'list'), action('任务列表', 'check')] },
    { label: '视图', submenu: [action('文件侧栏', 'toggle-sidebar', 'CmdOrCtrl+Shift+L'), action('文档大纲', 'toggle-outline', 'CmdOrCtrl+Shift+T'), action('源码模式', 'toggle-source', 'CmdOrCtrl+/'), { type: 'separator' }, action('专注模式', 'toggle-focus', 'CmdOrCtrl+Shift+F'), action('打字机模式', 'toggle-typewriter'), action('命令面板', 'command-palette', 'CmdOrCtrl+Shift+P'), { type: 'separator' }, { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { type: 'separator' }, { role: 'togglefullscreen', label: '进入全屏' }] },
    { label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放' }, { type: 'separator' }, { role: 'front', label: '全部前置' }] },
    { label: '帮助', submenu: [action('快速入门', 'welcome'), action('Markdown 语法指南', 'markdown-guide'), { label: '在访达中显示数据文件夹', click: () => shell.showItemInFolder(dataPath('settings.json')) }] },
  ]));
}

function installIPC() {
  const handle = (name, handler) => ipcMain.handle(`mojian:${name}`, async (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('无效请求。');
    try { return await handler(...args); }
    catch (error) { throw new Error(error.message || '操作未完成，请重试。'); }
  });
  handle('open-file', async () => {
    const result = await dialog.showOpenDialog(window, { title: '打开 Markdown 文档', properties: ['openFile'], filters: markdownFilters });
    return result.canceled || !result.filePaths[0] ? null : openDocument(result.filePaths[0]);
  });
  handle('open-folder', async () => {
    const result = await dialog.showOpenDialog(window, { title: '打开文档文件夹', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const folderPath = await grantRoot(result.filePaths[0]);
    await watchFolder(folderPath);
    return { path: folderPath, tree: await listTree(folderPath) };
  });
  handle('read-file', readDocument);
  handle('save-file', saveDocument);
  handle('list-folder', async folderPath => listTree(await requirePath(folderPath)));
  handle('watch-folder', watchFolder);
  handle('unwatch-folder', async folderPath => {
    const safePath = await requirePath(folderPath, true);
    folderWatchers.get(safePath)?.close();folderWatchers.delete(safePath);
    clearTimeout(folderDebounces.get(safePath));folderDebounces.delete(safePath);
    return true;
  });
  handle('create-file', async options => {
    const directory = await requirePath(options?.folderPath);
    if (!(await fsp.stat(directory)).isDirectory()) throw new Error('请选择有效的文件夹。');
    const filePath = await createMarkdownFile(directory, options?.name);
    return readDocument(filePath);
  });
  handle('get-settings', () => ({ ...defaults, ...settings }));
  handle('save-settings', async patch => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || JSON.stringify(patch).length > 50000) throw new Error('设置格式不正确。');
    settings = { ...settings, ...patch };
    const snapshot = JSON.stringify(settings, null, 2);
    settingsQueue = settingsQueue.catch(() => {}).then(() => atomicWrite(dataPath('settings.json'), snapshot));
    await settingsQueue;
    return { ...defaults, ...settings };
  });
  handle('get-recent-files', () => recentFiles);
  handle('export-file', exportDocument);
  handle('pick-images', importImages);
  handle('save-image', saveImage);
  handle('resolve-asset', async ({ documentPath, src }) => {
    assertString(src, 8192);
    if (/^(https?:|data:image\/|mojian-file:)/i.test(src)) return src;
    let filePath;
    if (src.startsWith('file:')) filePath = require('node:url').fileURLToPath(src);
    else {
      if (!documentPath) return src;
      const safeDocumentPath = await requirePath(documentPath, true);
      filePath = path.resolve(path.dirname(safeDocumentPath), decodeURIComponent(src));
    }
    const safePath = await requirePath(filePath);
    return `mojian-file://local/?path=${encodeURIComponent(safePath)}`;
  });
  handle('reveal-in-finder', async filePath => { shell.showItemInFolder(await requirePath(filePath)); return true; });
  handle('open-external', async url => {
    const parsed = new URL(assertString(url, 8192));
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) throw new Error('无法打开这个链接。');
    await shell.openExternal(parsed.href);
    return true;
  });
  handle('get-recovery', async () => {
    const documents = await readJSON(dataPath('recovery.json'), []);
    // Recovery was created by this application and must remain readable after a restart.
    for (const document of documents) {
      if (document.path && path.isAbsolute(document.path)) await grantRoot(path.dirname(document.path)).catch(() => {});
      if (document.sourcePath && path.isAbsolute(document.sourcePath)) await grantRoot(path.dirname(document.sourcePath)).catch(() => {});
    }
    return documents;
  });
  handle('save-recovery', async documents => {
    if (!Array.isArray(documents) || documents.length > 100 || JSON.stringify(documents).length > 50 * 1024 * 1024) throw new Error('恢复数据过大。');
    const snapshot = JSON.stringify(documents);
    recoveryQueue = recoveryQueue.catch(() => {}).then(() => atomicWrite(dataPath('recovery.json'), snapshot));
    await recoveryQueue;
    return true;
  });
  handle('clear-recovery', async () => {
    recoveryQueue = recoveryQueue.catch(() => {}).then(() => atomicWrite(dataPath('recovery.json'), '[]'));
    await recoveryQueue;
    return true;
  });
  handle('get-versions', async filePath => versions().list(await requirePath(filePath, true)));
  handle('restore-version', async ({ path: filePath, id }) => {
    const safePath = await requirePath(filePath, true);
    const content = await versions().get(safePath, assertString(id, 100));
    return { path: safePath, name: path.basename(safePath), content };
  });
  ipcMain.on('mojian:confirm-close', event => {
    if (event.sender !== window?.webContents) return;
    closeApproved = true;
    window.close();
  });
  ipcMain.on('mojian:cancel-close', event => {
    if (event.sender !== window?.webContents) return;
    quitting = false;
    closeApproved = false;
  });
}

function createWindow() {
  closeApproved = false;
  rendererReady = false;
  window = new BrowserWindow({
    title: '墨笺', width: 1360, height: 900, minWidth: 860, minHeight: 580,
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 19 },
    backgroundColor: '#fbfaf7', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL();
    if (url !== current) {
      event.preventDefault();
      if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url).catch(() => {});
    }
  });
  window.webContents.on('did-finish-load', async () => {
    rendererReady = true;
    const files = pendingFiles.splice(0);
    for (const filePath of files) await deliverDocument(filePath);
  });
  window.on('close', event => {
    if (!closeApproved) { event.preventDefault(); menu('before-close'); }
  });
  window.on('closed', () => {
    window = null;
    rendererReady = false;
    if (quitting) app.quit();
  });
  if (process.env.VITE_DEV_SERVER_URL) window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.on('open-file', (event, filePath) => { event.preventDefault(); deliverDocument(filePath); });
app.on('before-quit', event => {
  quitting = true;
  if (window && !closeApproved) { event.preventDefault(); menu('before-close'); }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin' || quitting) app.quit(); });
app.on('activate', () => { if (!window) createWindow(); else window.show(); });

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, argv) => {
    if (!window) createWindow();
    if (window.isMinimized()) window.restore();
    window.focus();
    const candidate = argv.find(arg => path.isAbsolute(arg) && MARKDOWN_EXTENSIONS.has(path.extname(arg).toLowerCase()));
    if (candidate) deliverDocument(candidate);
  });
  app.whenReady().then(async () => {
    if (process.platform === 'darwin' && app.isPackaged && !process.env.MOJIAN_TEST && process.execPath.startsWith('/Volumes/') && !app.isInApplicationsFolder()) {
      const choice = dialog.showMessageBoxSync({ type: 'question', title: '安装墨笺', message: '将墨笺安装到“应用程序”？', detail: '安装后可以在 macOS 的应用程序列表和搜索中找到墨笺，也不必每次打开安装盘。', buttons: ['安装并打开', '暂时使用'], defaultId: 0, cancelId: 1 });
      if (choice === 0) { try { if (app.moveToApplicationsFolder()) return; } catch (error) { dialog.showErrorBox('安装未完成', error.message); } }
    }
    if (process.platform === 'darwin' && app.isPackaged && !process.env.MOJIAN_TEST && app.isInApplicationsFolder()) {
      const bundle = path.resolve(path.dirname(process.execPath), '../..');
      execFile('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', bundle], () => {});
      execFile('/usr/bin/mdimport', [bundle], () => {});
    }
    await fsp.mkdir(app.getPath('userData'), { recursive: true });
    await fsp.mkdir(dataPath('attachments'), { recursive: true });
    await grantRoot(dataPath('attachments'));
    settings = await readJSON(dataPath('settings.json'), {});
    const savedFolders = [...(Array.isArray(settings.workspaceFolders) ? settings.workspaceFolders : []), settings.lastFolder].filter(folder => typeof folder === 'string' && path.isAbsolute(folder));
    for (const folder of [...new Set(savedFolders)].slice(0, 50)) {
      try {
        if ((await fsp.stat(folder)).isDirectory()) await grantRoot(folder);
      } catch { /* A previously selected folder may no longer exist. */ }
    }
    recentFiles = await readJSON(dataPath('recent.json'), []);
    // Recent paths were selected by the user in a previous session.
    for (const item of recentFiles) await grantRoot(path.dirname(item.path)).catch(() => {});
    protocol.handle('mojian-file', async request => {
      try {
        const filePath = await requirePath(new URL(request.url).searchParams.get('path'));
        if (!imageExtensions.has(path.extname(filePath).toLowerCase())) return new Response('Unsupported image', { status: 415 });
        return net.fetch(pathToFileURL(filePath).href);
      } catch { return new Response('Image unavailable', { status: 404 }); }
    });
    app.setAboutPanelOptions({ applicationName: '墨笺 Mojian', applicationVersion: app.getVersion(), copyright: '本地优先 · 专注书写', credits: '独立 Markdown 编辑器 · 基于 Electron 与 Vditor' });
    installIPC();
    buildMenu();
    createWindow();
    for (const arg of process.argv.slice(1)) {
      if (path.isAbsolute(arg) && MARKDOWN_EXTENSIONS.has(path.extname(arg).toLowerCase())) pendingFiles.push(arg);
    }
  }).catch(error => { dialog.showErrorBox('墨笺启动失败', error.message); app.quit(); });
}
