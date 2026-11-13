const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { atomicWrite, readJSON, listTree, isWithin, VersionStore, migrateMarkdownImages, createMarkdownFile } = require('../electron/file-store.cjs');
const { pathToFileURL } = require('node:url');

async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mojian-store-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('creating a named Markdown file never overwrites an existing file or escapes its folder', async t => {
  const directory = await temporary(t);
  const filePath = await createMarkdownFile(directory, '我的笔记');
  assert.equal(path.basename(filePath), '我的笔记.md');
  await fs.writeFile(filePath, '已经存在的内容');
  await assert.rejects(createMarkdownFile(directory, '我的笔记.md'), /已经存在/);
  assert.equal(await fs.readFile(filePath, 'utf8'), '已经存在的内容');
  for (const name of ['../越界.md', '/tmp/越界.md', '目录\\文稿.md', '.hidden.md', 'bad:name.md', 'app.js', '']) {
    await assert.rejects(createMarkdownFile(directory, name));
  }
  assert.deepEqual(await fs.readdir(directory), ['我的笔记.md']);
});

test('saving replaces the full Unicode document and preserves its permissions', async t => {
  const directory = await temporary(t);
  const filePath = path.join(directory, '中文 空格.md');
  await fs.writeFile(filePath, '# 旧文档', { mode: 0o600 });
  await atomicWrite(filePath, '# 新文档\n\n一段没有丢失的中文。\n');
  assert.equal(await fs.readFile(filePath, 'utf8'), '# 新文档\n\n一段没有丢失的中文。\n');
  if (process.platform !== 'win32') assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600);
  assert.deepEqual(await fs.readdir(directory), ['中文 空格.md']);
});

test('atomic saving survives a temporary Windows file lock without deleting the original', async t => {
  const directory = await temporary(t);
  const filePath = path.join(directory, 'locked.md');
  await fs.writeFile(filePath, 'original');
  const rename = fs.rename;
  let calls = 0;
  const mock = t.mock.method(fs, 'rename', async (from, to) => {
    if (++calls === 1) {
      assert.equal(await fs.readFile(filePath, 'utf8'), 'original');
      throw Object.assign(new Error('locked'), { code: 'EPERM' });
    }
    return rename(from, to);
  });
  await atomicWrite(filePath, 'saved 中文');
  mock.mock.restore();
  assert.equal(calls, 2);
  assert.equal(await fs.readFile(filePath, 'utf8'), 'saved 中文');
  assert.deepEqual(await fs.readdir(directory), ['locked.md']);
});

test('a persistent save error preserves the original and removes its temporary file', async t => {
  const directory = await temporary(t);
  const filePath = path.join(directory, 'locked.md');
  await fs.writeFile(filePath, 'original');
  const mock = t.mock.method(fs, 'rename', async () => {
    throw Object.assign(new Error('locked'), { code: 'EACCES' });
  });
  await assert.rejects(atomicWrite(filePath, 'unsaved'), { code: 'EACCES' });
  mock.mock.restore();
  assert.equal(await fs.readFile(filePath, 'utf8'), 'original');
  assert.deepEqual(await fs.readdir(directory), ['locked.md']);
});

test('folder browser includes Markdown and skips hidden, generated and symbolic-link directories', async t => {
  const directory = await temporary(t);
  await fs.mkdir(path.join(directory, '笔记'));
  await fs.mkdir(path.join(directory, 'node_modules'));
  await fs.mkdir(path.join(directory, '.secret'));
  await fs.writeFile(path.join(directory, '笔记', '日记.md'), '# 日记');
  await fs.writeFile(path.join(directory, 'welcome.MD'), 'hello');
  await fs.writeFile(path.join(directory, 'image.png'), 'image');
  await fs.writeFile(path.join(directory, 'node_modules', 'dependency.md'), 'ignore');
  await fs.symlink(path.join(directory, '笔记'), path.join(directory, 'shortcut'), process.platform === 'win32' ? 'junction' : 'dir');
  const nodes = await listTree(directory);
  assert.deepEqual(nodes.map(node => [node.name, node.type]), [['笔记', 'directory'], ['welcome.MD', 'file']]);
  assert.equal(nodes[0].children[0].name, '日记.md');
});

test('version history retains forty readable snapshots and rejects unknown IDs', async t => {
  const directory = await temporary(t);
  const store = new VersionStore(path.join(directory, 'history'));
  const filePath = path.join(directory, 'document.md');
  for (let i = 0; i < 43; i++) await store.add(filePath, `# 版本 ${i}`);
  await store.add(filePath, '# 版本 42');
  const versions = await store.list(filePath);
  assert.equal(versions.length, 40);
  assert.equal(await store.get(filePath, versions[0].id), '# 版本 42');
  assert.equal(await store.get(filePath, versions[39].id), '# 版本 3');
  await assert.rejects(store.get(filePath, '../index'), /不存在/);
  assert.equal((await fs.readdir(store.location(filePath))).length, 41);
});

test('path boundary checks do not allow sibling directories or parent traversal', () => {
  assert.equal(isWithin('/Users/test/notes', '/Users/test/notes/日记.md'), true);
  assert.equal(isWithin('/Users/test/notes', '/Users/test/notes'), true);
  assert.equal(isWithin('/Users/test/notes', '/Users/test/notes-private/file.md'), false);
  assert.equal(isWithin('/Users/test/notes', '/Users/test/notes/../secret.md'), false);
});

test('settings recover safely when a local JSON file is missing or incomplete', async t => {
  const directory = await temporary(t);
  const filePath = path.join(directory, 'settings.json');
  assert.deepEqual(await readJSON(filePath, { theme: 'light' }), { theme: 'light' });
  await fs.writeFile(filePath, '{"theme":');
  assert.deepEqual(await readJSON(filePath, {}), {});
  await atomicWrite(filePath, '{"theme":"dark"}');
  assert.deepEqual(await readJSON(filePath, {}), { theme: 'dark' });
});

test('first save migrates untitled image attachments into portable adjacent assets', async t => {
  const directory = await temporary(t);
  const attachments = path.join(directory, 'attachments');
  const documents = path.join(directory, '我的文稿');
  await fs.mkdir(attachments);
  await fs.mkdir(documents);
  const source = path.join(attachments, '一张 图片.png');
  await fs.writeFile(source, 'test image content');
  const markdown = `# 标题\n\n![图片](<${pathToFileURL(source).href}> "说明")\n\n![remote](https://example.com/a.png)`;
  const result = await migrateMarkdownImages(markdown, { nextPath: path.join(documents, '日记.md'), attachmentDirectory: attachments });
  assert.match(result, /!\[图片\]\(<assets\/一张-图片-[a-f0-9]{12}\.png> "说明"\)/);
  assert.ok(result.includes('![remote](https://example.com/a.png)'));
  assert.ok(!result.includes('file:'));
  const [copied] = await fs.readdir(path.join(documents, 'assets'));
  assert.equal(await fs.readFile(path.join(documents, 'assets', copied), 'utf8'), 'test image content');
  assert.equal(await fs.readFile(source, 'utf8'), 'test image content');
});

test('save as copies old relative image links including angled and escaped spaces', async t => {
  const directory = await temporary(t);
  const oldDirectory = path.join(directory, 'old');
  const newDirectory = path.join(directory, 'new');
  await fs.mkdir(oldDirectory);
  await fs.mkdir(newDirectory);
  await fs.writeFile(path.join(oldDirectory, '图 1.png'), 'first');
  await fs.writeFile(path.join(oldDirectory, '图 2.png'), 'second');
  const markdown = '![one](<图 1.png>)\n![two](图\\ 2.png "说明")\n![missing](missing.png)';
  const options = { previousPath: path.join(oldDirectory, 'doc.md'), nextPath: path.join(newDirectory, 'copy.md') };
  const result = await migrateMarkdownImages(markdown, options);
  assert.match(result, /!\[one\]\(<assets\/图-1-[a-f0-9]{12}\.png>\)/);
  assert.match(result, /!\[two\]\(assets\/图-2-[a-f0-9]{12}\.png "说明"\)/);
  assert.ok(result.includes('![missing](missing.png)'));
  assert.equal((await fs.readdir(path.join(newDirectory, 'assets'))).length, 2);
  assert.equal(await migrateMarkdownImages(markdown, { ...options, nextPath: options.previousPath }), markdown);
});

test('image migration preserves code samples and supports reference-style images', async t => {
  const directory = await temporary(t);
  const oldDirectory = path.join(directory, 'old');
  const newDirectory = path.join(directory, 'new');
  await fs.mkdir(oldDirectory);
  await fs.mkdir(newDirectory);
  await fs.writeFile(path.join(oldDirectory, 'image.png'), 'picture');
  const markdown = [
    '```md', '![code](image.png)', '```',
    '`![inline](image.png)`',
    '![引用图片][picture]',
    '[picture]: <image.png> "说明"',
    '\\![escaped](image.png)',
  ].join('\n');
  const result = await migrateMarkdownImages(markdown, { previousPath: path.join(oldDirectory, 'a.md'), nextPath: path.join(newDirectory, 'b.md') });
  assert.ok(result.includes('```md\n![code](image.png)\n```'));
  assert.ok(result.includes('`![inline](image.png)`'));
  assert.ok(result.includes('\\![escaped](image.png)'));
  assert.match(result, /\[picture\]: <assets\/image-[a-f0-9]{12}\.png> "说明"/);
});
