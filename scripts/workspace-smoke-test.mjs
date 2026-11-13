import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root=process.cwd();
const temporary=await mkdtemp(path.join(os.tmpdir(),'mojian-workspace-test-'));
const english=path.join(temporary,'英语');
const notes=path.join(temporary,'日记');
const nested=path.join(english,'阅读');
await mkdir(nested,{recursive:true});await mkdir(notes);
const sample=path.join(english,'格列佛游记.md');
const markdown='# 第一章\n\n前面的正文。\n\n```text\nThe captain was a good man and had sailed a great deal.\n  "Welcome aboard, Doctor Gulliver," he said.\n```\n\n```javascript\nconst greeting = "hello";\nconsole.log(greeting);\n```\n\n```mermaid\ngraph LR\nA[阅读] --> B[笔记]\n```\n\n后面的正文。\n';
await writeFile(sample,markdown);await writeFile(path.join(nested,'阅读笔记.md'),'# 阅读');await writeFile(path.join(notes,'日记.md'),'# 日记');
const canonicalEnglish=await realpath(english);const canonicalNotes=await realpath(notes);
const checks=[];const errors=[];let app,page;
async function check(name,run){await run();checks.push(name);console.log(`✓ ${name}`);}
async function chooseOpen(file){await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);}
const execute=action=>page.evaluate(action=>window.__mojian.execute(action),action);
async function waitForDisk(file,text){const deadline=Date.now()+7000;while(Date.now()<deadline){try{if((await readFile(file,'utf8')).includes(text))return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert.fail('停止输入后没有自动保存到磁盘');}
async function waitForAsync(predicate){const deadline=Date.now()+7000;while(Date.now()<deadline){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,50));}assert.fail('异步状态没有按时更新');}
try{
 app=await electron.launch({...(process.env.MOJIAN_EXECUTABLE?{executablePath:process.env.MOJIAN_EXECUTABLE,args:[]}:{args:[root]}),env:{...process.env,MOJIAN_TEST:'1',MOJIAN_USER_DATA:path.join(temporary,'profile')}});
 page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
 await page.waitForFunction(()=>window.__mojian?.getEditor()?.vditor?.lute);
 await check('同时添加多个文件夹，切换时只显示对应文件',async()=>{
  await chooseOpen(english);await execute('open-folder');await chooseOpen(notes);await execute('open-folder');
  assert.equal(await page.locator('.workspace-row').count(),2);
  assert.match(await page.locator('.file-tree').innerText(),/日记\.md/);
  assert.ok(!(await page.locator('.file-tree').innerText()).includes('格列佛'));
  await page.locator('.workspace-select').filter({hasText:'英语'}).click();
  assert.match(await page.locator('.file-tree').innerText(),/格列佛游记\.md/);
  assert.ok(!(await page.locator('.file-tree').innerText()).includes('日记.md'));
  assert.equal(await page.locator('.workspace-row').filter({hasText:'英语'}).locator('.workspace-count').innerText(),'2');
 });
 await check('在选中文件夹新建文稿，并真实输入后自动保存',async()=>{
  await execute('new-file');await page.locator('#new-file-name').fill('今日笔记');await page.locator('#new-file-name').press('Enter');
  await page.waitForFunction(()=>window.__mojian.getState().documents.some(doc=>doc.name==='今日笔记.md'));
  await page.locator('#editor [contenteditable="true"]:visible').click();await page.keyboard.insertText('不按保存键，这段中文会自动保存。');
  await waitForDisk(path.join(english,'今日笔记.md'),'这段中文会自动保存');
  await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('自动保存已开启'));
  const duplicate=await page.evaluate(async directory=>{try{await window.desktop.createFile({folderPath:directory,name:'今日笔记.md'});}catch(error){return error.message;}},canonicalEnglish);
  assert.match(duplicate,/已经存在/);assert.match(await readFile(path.join(english,'今日笔记.md'),'utf8'),/这段中文会自动保存/);
 });
 await check('在选中的子文件夹内新建文稿',async()=>{
  await page.locator('.folder-row').filter({hasText:'阅读'}).click();await execute('new-file');
  await page.locator('#new-file-name').fill('子文件夹文稿');await page.locator('#new-file-name').press('Enter');
  await page.waitForFunction(()=>window.__mojian.getState().documents.some(doc=>doc.name==='子文件夹文稿.md'));
  assert.ok((await stat(path.join(nested,'子文件夹文稿.md'))).isFile());
 });
 await check('非当前文件夹仍会监测文件变化和更新数量',async()=>{
  await page.locator('.workspace-select').filter({hasText:'日记'}).click();
  await writeFile(path.join(english,'外部新增.md'),'# 外部文稿');
  await page.waitForFunction(()=>window.__mojian.getState().workspaces.find(folder=>folder.path.replace(/\\/g,'/').endsWith('/英语'))?.fileCount===5);
  assert.match(await page.locator('.file-tree').innerText(),/日记\.md/);
 });
 await check('移除和重新添加文件夹，不删除文件，不重复添加',async()=>{
  await page.locator('.workspace-row').filter({hasText:'英语'}).locator('.workspace-remove').click();
  await waitForAsync(async()=>await page.locator('.workspace-row').count()===1);
  assert.equal(await page.locator('.workspace-row').count(),1);assert.ok((await stat(sample)).isFile());
  await chooseOpen(english);await execute('open-folder');await chooseOpen(english);await execute('open-folder');
  assert.equal(await page.locator('.workspace-row').count(),2);
 });
 await check('普通代码块只显示上方编辑框，聚焦和失焦都不重复',async()=>{
  await chooseOpen(sample);await execute('open');await execute('instant');
  const source=page.locator('#editor .vditor-ir__marker--pre > code.language-text:visible');
  assert.equal(await source.count(),1);
  assert.equal(await page.locator('#editor .vditor-ir__preview > code:visible').count(),0);
  await source.click();assert.equal(await page.locator('#editor .vditor-ir__preview > code:visible').count(),0);
  await page.locator('#editor h1:visible').click();assert.equal(await source.count(),1);
  await page.waitForFunction(()=>Boolean(window.__mojian.getEditor().vditor.element.querySelector('.vditor-ir__preview .language-mermaid svg')));
  assert.ok(await page.locator('#editor .language-mermaid svg:visible').count());
  const before=await page.evaluate(()=>window.__mojian.getEditor().getValue());await execute('source');await execute('instant');
  assert.equal(await page.evaluate(()=>window.__mojian.getEditor().getValue()),before);
 });
 let rememberedZoom;
 await check('真实触摸板手势路径放大缩小正文，并保存缩放比例',async()=>{
  const sidebarWidth=await page.locator('.sidebar').evaluate(el=>el.getBoundingClientRect().width);
  const session=await page.context().newCDPSession(page);
  await session.send('Input.synthesizePinchGesture',{x:700,y:350,scaleFactor:1.5,relativeSpeed:800,gestureSourceType:'mouse'});
  const expanded=await page.evaluate(()=>window.__mojian.getState().settings.editorZoom);assert.ok(expanded>1.1);
  await session.send('Input.synthesizePinchGesture',{x:700,y:350,scaleFactor:.8,relativeSpeed:800,gestureSourceType:'mouse'});
  rememberedZoom=await page.evaluate(()=>window.__mojian.getState().settings.editorZoom);assert.ok(rememberedZoom<expanded);
  assert.equal(await page.evaluate(()=>visualViewport.scale),1);
  assert.equal(await page.locator('.sidebar').evaluate(el=>el.getBoundingClientRect().width),sidebarWidth);
  await waitForAsync(async()=>Math.abs((await page.evaluate(()=>window.desktop.getSettings())).editorZoom-rememberedZoom)<.001);
  await page.mouse.move(700,350);await page.mouse.wheel(0,100);
  assert.equal(await page.evaluate(()=>window.__mojian.getState().settings.editorZoom),rememberedZoom);
 });
 await check('重启恢复多个文件夹、缩放比例，百分比可恢复原大',async()=>{
  await page.reload();await page.waitForFunction(()=>window.__mojian?.getState().workspaces.length===2);
  assert.equal(await page.evaluate(()=>window.__mojian.getState().settings.editorZoom),rememberedZoom);
  assert.equal((await page.evaluate(()=>window.__mojian.getState().workspaces)).some(folder=>folder.path===canonicalNotes),true);
  await page.locator('#zoom-status').click();await page.waitForFunction(()=>window.__mojian.getState().settings.editorZoom===1);
  await chooseOpen(sample);await execute('open');
  await page.locator('#editor .vditor-ir__marker--pre > code.language-text:visible').click();
  await page.evaluate(()=>{document.querySelector('.toast-stack').innerHTML='';});
  await page.screenshot({path:path.join(root,'test-results/mojian-1.1.png'),scale:'css'});
 });
 assert.deepEqual(errors,[]);
 console.log(`全部 ${checks.length} 项新版功能验证通过。`);
 await writeFile(path.join(root,'test-results/workspace-report.json'),JSON.stringify({passed:true,checks,errors},null,2));
}catch(error){console.error(error);process.exitCode=1;if(page)await page.screenshot({path:path.join(root,'test-results/workspace-failure.png')}).catch(()=>{});await writeFile(path.join(root,'test-results/workspace-report.json'),JSON.stringify({passed:false,checks,errors,failure:error.stack},null,2));}
finally{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}await rm(temporary,{recursive:true,force:true});}
