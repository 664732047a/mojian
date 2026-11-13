const test = require('node:test');
const assert = require('node:assert/strict');
const { localReferencePath, windowChrome, validateDocumentName } = require('../electron/platform.cjs');

test('Windows local images preserve drive letters, Unicode, spaces, and UNC shares', () => {
  const document = 'C:\\Users\\测试用户\\Documents\\笔记\\文稿.md';
  assert.equal(localReferencePath(document, 'assets/一张%20图片.png', 'win32'), 'C:\\Users\\测试用户\\Documents\\笔记\\assets\\一张 图片.png');
  assert.equal(localReferencePath(document, '..\\附件\\图.png', 'win32'), 'C:\\Users\\测试用户\\Documents\\附件\\图.png');
  assert.equal(localReferencePath(document, 'file:///D:/%E5%9B%BE%E7%89%87/a%20b.png', 'win32'), 'D:\\图片\\a b.png');
  assert.equal(localReferencePath(document, 'file://server/share/a%20b.png', 'win32'), '\\\\server\\share\\a b.png');
  assert.equal(localReferencePath(document, 'D:\\附件\\图.png', 'win32'), 'D:\\附件\\图.png');
});

test('macOS local image and document links still resolve without losing characters', () => {
  assert.equal(localReferencePath('/Users/test/笔记/文稿.md', '../附件/图片%20一.png', 'darwin'), '/Users/test/附件/图片 一.png');
  assert.equal(localReferencePath(null, 'file:///Users/test/a%20b.png', 'darwin'), '/Users/test/a b.png');
  assert.throws(() => localReferencePath(null, 'assets/a.png', 'win32'), /先保存/);
  assert.throws(() => localReferencePath('/notes/a.md', 'javascript:bad', 'darwin'), /不支持/);
});

test('Windows gets native window controls and valid document names', () => {
  assert.deepEqual(windowChrome('win32'), { titleBarStyle: 'default' });
  assert.equal(windowChrome('darwin').titleBarStyle, 'hiddenInset');
  assert.equal(validateDocumentName('中文笔记.md', 'win32'), '中文笔记.md');
  for (const name of ['CON.md', 'nul', 'COM1.md', 'LPT9.txt', 'a?.md', 'a*.md', 'a|b.md', 'a.', '..\\escape.md']) {
    assert.throws(() => validateDocumentName(name, 'win32'));
  }
});

test('Windows labels and local image URLs avoid macOS-specific path assumptions', async () => {
  const { basename, shortPath, formatShortcut, localImageUrl } = await import('../src/platform.js');
  assert.equal(basename('C:\\Users\\测试\\笔记'), '笔记');
  assert.equal(shortPath('C:\\Users\\测试\\笔记\\文稿.md'), '笔记 / 文稿.md');
  assert.equal(formatShortcut('⌘⇧P / ⇧⌘S / ⌘,', 'win32'), 'Ctrl+Shift+P / Ctrl+Shift+S / Ctrl+,');
  assert.equal(formatShortcut('⌘⇧P', 'darwin'), '⌘⇧P');
  const url = new URL(localImageUrl('C:\\Users\\笔记\\文稿.md', 'assets/一张 图片.png'));
  assert.equal(url.searchParams.get('documentPath'), 'C:\\Users\\笔记\\文稿.md');
  assert.equal(url.searchParams.get('src'), 'assets/一张 图片.png');
});
