const path = require('node:path');
const { fileURLToPath } = require('node:url');

function localReferencePath(documentPath, source, platform = process.platform) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (typeof source !== 'string' || !source) throw new Error('图片或文稿路径不能为空。');
  if (/^file:/i.test(source)) return fileURLToPath(source, { windows: platform === 'win32' });
  const decoded = decodeURIComponent(source);
  if (/^[a-z][a-z\d+.-]*:/i.test(decoded) && !/^[a-z]:[\\/]/i.test(decoded)) throw new Error('不支持这个本地链接。');
  if (paths.isAbsolute(decoded)) return paths.normalize(decoded);
  if (!documentPath) throw new Error('请先保存文稿，再使用相对路径。');
  return paths.resolve(paths.dirname(documentPath), decoded);
}

function windowChrome(platform = process.platform) {
  return platform === 'darwin'
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 19 } }
    : { titleBarStyle: 'default' };
}

function validateDocumentName(suppliedName, platform = process.platform) {
  if (typeof suppliedName !== 'string') throw new Error('请输入文稿名称。');
  const name = suppliedName.trim();
  if (!name || name.length > 200 || name.startsWith('.') || /[\\/\x00-\x1f:]/.test(name)) throw new Error('名称不能包含斜杠、冒号或以点开头。');
  if (platform === 'win32' && (/[<>"|?*]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))) {
    throw new Error('这个名称在 Windows 中不能使用，请换一个名称。');
  }
  return name;
}

module.exports = { localReferencePath, windowChrome, validateDocumentName };
