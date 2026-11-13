import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const sandbox = await mkdtemp(path.join(os.tmpdir(), 'mojian-app-test-'));
const userData = path.join(sandbox, 'user-data');
const workspace = path.join(sandbox, '文稿');
const documentPath = path.join(workspace, '测试文稿.md');
const savePath = path.join(workspace, '保存结果.md');
const htmlPath = path.join(workspace, '导出结果.html');
const pdfPath = path.join(workspace, '导出结果.pdf');
const imageDocumentPath = path.join(workspace, '新建含图.md');
const archive = path.join(sandbox, '归档');
const imageCopyPath = path.join(archive, '带图副本.md');
const collisionSource = path.join(workspace, '覆盖来源.md');
const collisionTarget = path.join(workspace, '目标原稿.md');
const preservedCopy = path.join(workspace, '原目标保留副本.md');
const report = [];
const errors = [];
const failures = [];
await mkdir(path.join(root, 'test-results'), { recursive: true });
await mkdir(workspace, { recursive: true });
await mkdir(archive, { recursive: true });
await writeFile(documentPath, '# 本地文稿\n\n这是一份用来验证读写的 Markdown。\n\n- [ ] 完成测试\n');
await writeFile(collisionSource, '# 来源文稿\n\n来源原始内容。\n');
await writeFile(collisionTarget, '# 目标文稿\n\n原目标内容需要保留。\n');
const canonicalCollisionTarget = await realpath(collisionTarget);

let app;
let page;
const check = async (label, run) => {
  try {
    await run();
    report.push(label);
    console.log(`✓ ${label}`);
  } catch (error) {
    failures.push({ label, error: error.stack });
    console.error(`✗ ${label}\n${error.stack}`);
    await page?.screenshot({ path: path.join(root, `test-results/failure-${failures.length}.png`) }).catch(() => {});
  }
};
const execute = action => page.evaluate(action => window.__mojian.execute(action), action);
const editorValue = () => page.evaluate(() => window.__mojian.getEditor().getValue());
const normalizeMarkdown = value => value.replace(/^(\s*[-*+] \[[ xX]\])\s+/gm, '$1 ').trimEnd();
const chooseOpen = file => app.evaluate(({ dialog }, file) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
}, file);
const chooseSave = file => app.evaluate(({ dialog }, file) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
}, file);
const waitForValue = value => page.waitForFunction(value => window.__mojian.getEditor()?.getValue().includes(value), value);
const waitForAsync = async predicate => {const deadline=Date.now()+30000;while(Date.now()<deadline){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('等待异步状态更新超时');};

try {
  app = await electron.launch({
    ...(process.env.MOJIAN_EXECUTABLE ? { executablePath: process.env.MOJIAN_EXECUTABLE, args: [] } : { args: [root] }),
    cwd: root,
    env: { ...process.env, MOJIAN_TEST: '1', MOJIAN_USER_DATA: userData },
    timeout: 90_000,
  });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error' && !/Electron Security Warning/.test(msg.text())) {
      errors.push(msg.text());
    }
  });
  await page.waitForFunction(() => Boolean(window.__mojian?.getEditor()?.vditor?.lute), null, { timeout: 45_000 });
  await page.context().route(/^https?:\/\//, route => route.abort('internetdisconnected'));

  await check('离线启动编辑器与中文界面', async () => {
    assert.match(await page.title(), /墨笺/);
    assert.ok(await page.locator('#editor [contenteditable="true"]:visible').count());
    assert.ok((await editorValue()).length > 0);
    await page.screenshot({ path: path.join(root, 'test-results/mojian-light.png') });
  });

  await check('打开本地 Markdown 文稿', async () => {
    await chooseOpen(documentPath);
    await execute('open');
    await waitForValue('本地文稿');
    assert.match(await editorValue(), /完成测试/);
  });

  await check('即时渲染与源码往返保持内容', async () => {
    const before = await editorValue();
    await execute('source');
    await page.waitForFunction(() => window.__mojian.getEditor().getCurrentMode() === 'sv');
    assert.equal(normalizeMarkdown(await editorValue()), normalizeMarkdown(before));
    await execute('source');
    await page.waitForFunction(() => window.__mojian.getEditor().getCurrentMode() !== 'sv');
    assert.equal(normalizeMarkdown(await editorValue()), normalizeMarkdown(before));
  });

  await check('实际键盘输入与保存', async () => {
    await execute('source');
    const editable = page.locator('#editor [contenteditable="true"]:visible').first();
    await editable.click();
    await page.keyboard.press('Meta+End');
    await page.keyboard.press('End');
    await page.keyboard.insertText('\n\n键盘输入验证：中文、English、123。');
    await waitForValue('键盘输入验证');
    await execute('save');
    const saved = await readFile(documentPath, 'utf8');
    assert.match(saved, /键盘输入验证/);
  });

  await check('另存为产生独立文稿', async () => {
    await chooseSave(savePath);
    await execute('save-as');
    assert.match(await readFile(savePath, 'utf8'), /键盘输入验证/);
  });

  await check('新标签页与文件切换', async () => {
    const before = await page.locator('.document-tab').count();
    await execute('new');
    assert.equal(await page.locator('.document-tab').count(), before + 1);
    await chooseOpen(savePath);
    await execute('open');
    await waitForValue('键盘输入验证');
  });

  await check('文件夹浏览与本地文件列表', async () => {
    await chooseOpen(workspace);
    await execute('open-folder');
    await page.waitForFunction(() => [...document.querySelectorAll('.file-tree')].some(tree => tree.textContent.includes('测试文稿.md')));
  });

  await check('查找和替换可用', async () => {
    await execute('find');
    await page.locator('.find-bar').waitFor({ state: 'visible' });
    const search = page.locator('.find-bar input').first();
    await search.fill('键盘输入验证');
    await page.keyboard.press('Enter');
    assert.match(await page.locator('.find-count').textContent(), /1 \/ 1/);
    await execute('replace');
    await search.fill('123');
    await page.locator('#replace-input').fill('456');
    await execute('replace-all');
    assert.match(await editorValue(), /456/);
    assert.ok(!(await editorValue()).includes('123'));
    await page.keyboard.press('Escape');
  });

  await check('本地图片显示与 Markdown 路径持久保存', async () => {
    await execute('instant');
    await chooseOpen(path.join(root, 'build/icon.png'));
    await execute('image');
    await page.waitForFunction(() => {
      const ed = window.__mojian.getEditor();
      return [...ed.vditor.element.querySelectorAll('img')].some(image => image.complete && image.naturalWidth > 0);
    });
    for (const mode of ['source', 'wysiwyg', 'instant']) {
      await execute(mode);
      const markdown = await editorValue();
      assert.match(markdown, /assets\//);
      assert.ok(!markdown.includes('mojian-file:'), `Temporary URL leaked into Markdown in ${mode}`);
    }
    await execute('save');
    const markdown = await readFile(savePath, 'utf8');
    assert.match(markdown, /assets\//);
    assert.ok(!markdown.includes('mojian-file:'));
  });

  await check('HTML 导出包含正文', async () => {
    await chooseSave(htmlPath);
    await execute('export-html');
    const html = await readFile(htmlPath, 'utf8');
    assert.match(html, /键盘输入验证/);
    assert.match(html, /<!doctype html>/i);
    assert.ok(/data:image\/png;base64,/.test(html), 'Export must embed local PNG bytes in a data URL');
    await writeFile(path.join(root, 'test-results/export-preview.html'), html);
  });

  await check('PDF 导出生成有效文件', async () => {
    await chooseSave(pdfPath);
    await execute('export-pdf');
    const pdf = await readFile(pdfPath);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.byteLength > 1_000);
    await execute('export');
    await page.screenshot({ path: path.join(root, 'test-results/mojian-export.png') });
    await execute('close-modal');
  });

  await check('离线数学公式和流程图渲染', async () => {
    await page.evaluate(content => window.__mojian.openDocument({ name: '离线公式与图表.md', content }), '# 离线数学与流程图\n\n$$\nE = mc^2\n$$\n\n```mermaid\ngraph LR\n  A[写作] --> B[完成]\n```\n');
    await page.waitForFunction(() => {
      const element = window.__mojian.getEditor().vditor.element;
      return Boolean(element.querySelector('.katex') && element.querySelector('.language-mermaid svg'));
    }, null, { timeout: 30_000 });
  });

  await check('持久保存偏好设置', async () => {
    await execute('preferences');
    await page.screenshot({ path: path.join(root, 'test-results/mojian-preferences.png') });
    await page.locator('#pref-theme').selectOption('dark');
    const fontSize = page.locator('#pref-fontSize');
    await fontSize.focus();
    await fontSize.press('Home');
    for (let i = 0; i < 6; i++) await fontSize.press('ArrowRight');
    assert.equal(await fontSize.inputValue(), '19');
    await waitForAsync(async () => (await page.evaluate(() => window.desktop.getSettings())).fontSize === 19);
    await execute('close-modal');
    const readBack = await page.evaluate(() => window.desktop.getSettings());
    assert.equal(readBack.theme, 'dark');
    assert.equal(readBack.fontSize, 19);
  });

  await check('历史备份与恢复缓冲区', async () => {
    const versions = await page.evaluate(file => window.desktop.getVersions(file), documentPath);
    assert.ok(Array.isArray(versions));
    assert.ok(versions.length >= 1);
    const recovery = await page.evaluate(() => window.desktop.getRecovery());
    assert.ok(recovery !== undefined);
  });

  await check('未命名图片随初次保存和另存为迁移', async () => {
    await execute('new');
    await chooseOpen(path.join(root, 'build/icon.png'));
    await execute('image');
    assert.match(await editorValue(), /file:/);
    await chooseSave(imageDocumentPath);
    await execute('save');
    const firstSave = await readFile(imageDocumentPath, 'utf8');
    assert.match(firstSave, /assets\//);
    assert.ok(!firstSave.includes('file:'));
    await chooseSave(imageCopyPath);
    await execute('save-as');
    const copy = await readFile(imageCopyPath, 'utf8');
    const imagePath = copy.match(/!\[[^\]]*\]\(([^)]+)\)/)?.[1];
    assert.ok(imagePath?.startsWith('assets/'));
    assert.ok((await readFile(path.join(archive, decodeURIComponent(imagePath)))).byteLength > 0);
    await page.waitForFunction(() => [...window.__mojian.getEditor().vditor.element.querySelectorAll('img')].some(image => image.complete && image.naturalWidth > 0));
  });

  await check('另存为已打开文件时保留原标签内容', async () => {
    for (const file of [collisionSource, collisionTarget, collisionSource]) {
      await chooseOpen(file);
      await execute('open');
    }
    await execute('source');
    await page.locator('#editor [contenteditable="true"]:visible').first().click();
    await page.keyboard.press('Meta+End');
    await page.keyboard.press('End');
    await page.keyboard.insertText('\n\n来源新内容覆盖目标。');
    await waitForValue('来源新内容覆盖目标');
    await chooseSave(collisionTarget);
    await execute('save-as');
    const state = await page.evaluate(() => window.__mojian.getState());
    const owners = state.documents.filter(doc => doc.path === canonicalCollisionTarget);
    assert.equal(owners.length, 1);
    assert.match(owners[0].content, /来源新内容覆盖目标/);
    assert.match(await readFile(collisionTarget, 'utf8'), /来源新内容覆盖目标/);
    const preserved = state.documents.find(doc => !doc.path && doc.content.includes('原目标内容需要保留'));
    assert.ok(preserved, 'Existing target tab must survive as an independent draft');
    assert.equal(preserved.dirty, true);
    await page.locator(`.document-tab[data-document="${preserved.id}"]`).click();
    await chooseSave(preservedCopy);
    await execute('save');
    assert.match(await readFile(preservedCopy, 'utf8'), /原目标内容需要保留/);
  });

  await check('退出时取消保留未保存文字', async () => {
    await execute('new');
    await page.locator('#editor [contenteditable="true"]:visible').first().click();
    await page.keyboard.insertText('退出取消测试：这些未保存的文字仍然存在。');
    await waitForValue('退出取消测试');
    await app.evaluate(({ app }) => app.quit());
    await page.locator('[data-choice="cancel"]').waitFor();
    await page.locator('[data-choice="cancel"]').click();
    await page.locator('.modal-backdrop').waitFor({ state: 'detached' });
    assert.match(await editorValue(), /退出取消测试/);
    await waitForAsync(async () => (await page.evaluate(() => window.desktop.getRecovery())).some(doc => doc.content.includes('退出取消测试')));
  });

  await writeFile(path.join(root, 'test-results/recovery-before-reload.json'), JSON.stringify(await page.evaluate(() => window.__mojian.getState()), null, 2));
  const beforeRecovery = await page.evaluate(() => window.desktop.getRecovery());
  await writeFile(path.join(root, 'test-results/recovery-snapshot.json'), JSON.stringify(beforeRecovery, null, 2));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__mojian?.getEditor()?.vditor?.lute), null, { timeout: 45_000 });
  await check('重启后恢复深色偏好', async () => {
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.waitForFunction(() => window.__mojian.getState().documents.some(doc => doc.content.includes('退出取消测试')));
    await execute('welcome');
    await page.screenshot({ path: path.join(root, 'test-results/mojian-dark.png') });
  });
  await writeFile(path.join(root, 'test-results/state-after-reload.json'), JSON.stringify(await page.evaluate(() => window.__mojian.getState()), null, 2));

  assert.equal(failures.length, 0, `Failed checks:\n${failures.map(item => `${item.label}: ${item.error}`).join('\n')}`);
  assert.equal(errors.length, 0, `Renderer errors:\n${errors.join('\n')}`);
  console.log(`\n全部 ${report.length} 项桌面集成验证通过。`);
  await writeFile(path.join(root, 'test-results/smoke-report.json'), JSON.stringify({ passed: true, checks: report, errors, failures }, null, 2));
} catch (error) {
  console.error(error);
  if (page) await page.screenshot({ path: path.join(root, 'test-results/failure.png') }).catch(() => {});
  await writeFile(path.join(root, 'test-results/smoke-report.json'), JSON.stringify({ passed: false, checks: report, errors, failures, failure: error.stack }, null, 2));
  process.exitCode = 1;
} finally {
  if (app) {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
  }
  await rm(sandbox, { recursive: true, force: true });
}
