import Vditor from 'vditor';
import './styles.css';
import { icon } from './icons.js';
import { welcome, markdownGuide } from './welcome.js';

const api = window.desktop;
const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => crypto.randomUUID();
const defaults = {theme:'system',fontSize:17,editorZoom:1,lineHeight:1.85,editorWidth:780,autoSave:true,sidebar:true,outline:true,focus:false,typewriter:false,spellcheck:false};
const state = {documents:[],activeId:null,settings:{...defaults},folder:null,selectedDirectory:null,workspaces:[],tree:[],recent:[],sidebarTab:'files',filter:'',expanded:new Set(),ready:false};
const editors = new Map();
const pendingDocuments = [];
let editor, recoveryTimer, outlineTimer, zoomSaveTimer, zoomFrame, zoomHintTimer, closeInProgress = false;
let modalResolve, savedEditorRange;
const cdn = new URL('vditor', location.href).href.replace(/\/$/,'');
const findState = {query:'',index:0,matches:[],ranges:[]};

function button(action, glyph, label, extra='') {
  return `<button class="icon-button ${extra}" data-action="${action}" title="${label}" aria-label="${label}">${icon(glyph)}</button>`;
}

$('#app').innerHTML = `<div class="app-shell">
  <header class="titlebar"><div class="window-spacer"></div><div class="brand">${icon('leaf')}墨笺<small>MOJIAN</small></div>
    <div class="titlebar-center" id="window-title">给想法，留一点空白。</div>
    <div class="titlebar-actions">${button('palette','command','命令面板 ⌘⇧P')}${button('sidebar','sidebar','文件侧栏')}${button('focus','focus','专注模式')}${button('theme','moon','切换明暗外观')}${button('outline','outline','文稿大纲')}<span class="titlebar-divider"></span>${button('export','export','导出文稿')}</div>
  </header>
  <div class="workspace">
    <aside class="sidebar"><div class="sidebar-header"><div class="workspace-name" id="workspace-name">${icon('folder')}我的文件夹</div><div class="sidebar-actions">${button('open-folder','folder','添加文件夹')}${button('new-file','plus','在当前文件夹新建文稿')}</div></div>
      <div class="sidebar-tabs"><button data-action="tab-files" class="active">文稿</button><button data-action="tab-recent">最近打开</button></div>
      <label class="sidebar-search">${icon('search')}<input id="file-filter" placeholder="搜索文件名…" aria-label="搜索文件名"><span>⌘P</span></label>
      <div class="sidebar-scroll" id="sidebar-content"></div>
      <div class="sidebar-footer"><div class="sidebar-bottom-card"><div class="card-icon">${icon('sparkle')}</div><strong>专注于此刻的想法</strong><p>文稿保存在你的 Mac。<br>无需账号，打开就能写。</p></div><div class="sidebar-footer-bottom"><span>本地写作 · 1.1</span>${button('preferences','settings','偏好设置 ⌘,')}</div></div>
    </aside>
    <main class="main-area"><div class="tabs-bar" id="tabs"></div>
      <div class="editor-toolbar"><div class="toolbar-group"><button class="toolbar-button heading-button" data-action="headings" title="标题级别">正文 ${icon('down')}</button><span class="toolbar-divider"></span>${button('bold','bold','加粗 ⌘B')}${button('italic','italic','斜体 ⌘I')}${button('strike','strike','删除线')}<span class="toolbar-divider"></span>${button('quote','quote','引用')}${button('list','list','无序列表')}${button('check','check','任务清单')}<span class="toolbar-divider"></span>${button('link','link','插入链接')}${button('image','image','插入图片')}${button('table','table','插入表格')}${button('code','code','代码块')}</div>
      <div class="mode-switch"><button data-action="instant" class="active" title="即时渲染">写作</button><button data-action="source" title="Markdown 源码 ⌘/">源码</button><button data-action="preview" title="源码与预览">分屏</button></div></div>
      <div class="find-bar" hidden><div class="find-input-wrap">${icon('search')}<input id="find-input" placeholder="查找文字" aria-label="查找文字"><span class="find-count">0 处</span></div>${button('find-prev','up','上一处')}${button('find-next','down','下一处')}<button class="button small" data-action="show-replace">替换</button>${button('close-find','close','关闭查找')}<div class="replace-fields" hidden><input id="replace-input" placeholder="替换为" aria-label="替换为"><button class="button small" data-action="replace-one">替换</button><button class="button small" data-action="replace-all">全部替换</button></div></div>
      <div class="editor-layout"><div class="editor-pane"><div id="editor"></div></div><aside class="outline-panel"><div class="outline-header">文稿大纲<span>CONTENTS</span></div><nav id="outline-content"></nav><div class="outline-note">在文字里，找到方向。</div></aside></div>
      <footer class="statusbar"><div class="status-left"><span class="status-indicator"></span><span id="save-status">已就绪</span><button data-action="history" title="查看历史版本">${icon('history')}</button></div><div class="status-right"><span id="word-count"></span><span id="reading-time"></span><button data-action="reset-zoom" id="zoom-status" title="双指缩放正文；点击恢复 100%">100%</button><button data-action="source" class="status-pill" id="mode-status">即时渲染</button><span class="encoding">UTF-8</span></div></footer>
    </main>
  </div></div><div id="modal-root"></div><div class="toast-stack" aria-live="polite"></div>`;

api.onOpenFile(doc => { if(state.ready) safe(()=>openDocument(doc)); else pendingDocuments.push(doc); });
api.onMenu(command => safe(()=>execute(command)));
api.onFolderChanged(data => { const folder=state.workspaces.find(folder=>folder.path===data.path);if(folder)folder.tree=data.tree;if(data.path===state.folder)state.tree=data.tree;renderSidebar(); });
api.onExternalChange(change => safe(()=>externalChange(change)));

function active() { return state.documents.find(doc=>doc.id===state.activeId); }
function syncDocument(doc) {
  const ed=editors.get(doc.id);if(doc.loading||!ed?.vditor?.lute)return;
  doc.content=ed.getValue();doc.dirty=doc.content!==doc.savedContent;
}
function safe(fn) { return Promise.resolve().then(fn).catch(error=>{ console.error(error); toast(error.message||'操作未完成，请再试一次。','error'); }); }
function toast(message,type='success') {
  const el=document.createElement('div');el.className=`toast ${type}`;el.textContent=message;$('.toast-stack').append(el);setTimeout(()=>el.remove(),4000);
}
function getTheme() { return state.settings.theme==='system' ? (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light') : state.settings.theme; }
function applySettings() {
  const theme=getTheme();document.documentElement.dataset.theme=theme;
  const style=document.documentElement.style;
  style.setProperty('--editor-font-size',`${state.settings.fontSize*(state.settings.editorZoom||1)}px`);
  style.setProperty('--editor-line-height',state.settings.lineHeight);
  style.setProperty('--editor-width',`${state.settings.editorWidth}px`);
  $('.sidebar').hidden=!state.settings.sidebar;
  $('.outline-panel').hidden=!state.settings.outline;
  $('.app-shell').classList.toggle('focus-mode',!!state.settings.focus);
  $('.app-shell').classList.toggle('typewriter-mode',!!state.settings.typewriter);
  for(const [id,ed] of editors) {
    if(!ed.vditor?.lute) continue;
    ed.setTheme(theme==='dark'?'dark':'classic',theme==='dark'?'dark':'light',theme==='dark'?'github-dark':'github');
    ed.vditor.options.typewriterMode=!!state.settings.typewriter;
    $$('[contenteditable]',ed.vditor.element).forEach(el=>{el.spellcheck=!!state.settings.spellcheck;});
  }
  $$('[data-action="theme"]').forEach(el=>el.innerHTML=icon(theme==='dark'?'sun':'moon'));
  for(const key of ['sidebar','outline','focus']) $$(`[data-action="${key}"]`).forEach(el=>el.classList.toggle('active',!!state.settings[key]));
  $('#zoom-status').textContent=`${Math.round((state.settings.editorZoom||1)*100)}%`;
}
async function updateSettings(patch) {
  Object.assign(state.settings,patch);applySettings();updateStatus();await api.saveSettings(patch);
  if(patch.autoSave) for(const doc of state.documents) if(doc.path&&doc.dirty) scheduleSave(doc);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applySettings);

function setEditorZoom(value,point) {
  const zoom=Math.max(.6,Math.min(2.4,Math.round(value*1000)/1000));
  if(zoom===state.settings.editorZoom)return;
  const root=editor?.vditor[editor.getCurrentMode()].element;
  const anchor=point?document.caretRangeFromPoint(point.x,point.y):null;
  const anchored=anchor&&root?.contains(anchor.startContainer)?anchor:null;
  const before=anchored?.getBoundingClientRect().top;
  state.settings.editorZoom=zoom;
  cancelAnimationFrame(zoomFrame);
  zoomFrame=requestAnimationFrame(()=>{
    document.documentElement.style.setProperty('--editor-font-size',`${state.settings.fontSize*state.settings.editorZoom}px`);
    $('#zoom-status').textContent=`${Math.round(state.settings.editorZoom*100)}%`;
    const scroller=root?.matches('.vditor-sv')?root:root?.parentElement;
    if(anchored&&scroller)scroller.scrollTop+=anchored.getBoundingClientRect().top-before;
  });
  let hint=$('.zoom-hint');if(!hint){hint=document.createElement('div');hint.className='zoom-hint';$('.editor-pane').append(hint);}
  hint.textContent=`${Math.round(zoom*100)}%`;clearTimeout(zoomHintTimer);zoomHintTimer=setTimeout(()=>hint.remove(),900);
  clearTimeout(zoomSaveTimer);zoomSaveTimer=setTimeout(()=>safe(()=>api.saveSettings({editorZoom:state.settings.editorZoom})),300);
}
document.addEventListener('wheel',event=>{
  if(!event.ctrlKey||!state.ready||!event.target.closest('.editor-pane')||$('#modal-root').children.length)return;
  event.preventDefault();event.stopPropagation();
  const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?innerHeight:1);
  setEditorZoom((state.settings.editorZoom||1)*Math.exp(-delta*.012),{x:event.clientX,y:event.clientY});
},{passive:false,capture:true});

function countFiles(nodes) {return nodes.reduce((count,node)=>count+(node.type==='directory'?countFiles(node.children||[]):1),0);}
async function persistFolders() {const patch={workspaceFolders:state.workspaces.map(folder=>folder.path),lastFolder:state.folder};Object.assign(state.settings,patch);await api.saveSettings(patch);}
async function selectWorkspace(path) {
  const folder=state.workspaces.find(folder=>folder.path===path);if(!folder)return;
  state.folder=path;state.selectedDirectory=path;state.tree=folder.tree;state.sidebarTab='files';renderSidebar();await persistFolders();
}
async function refreshWorkspace(path=state.folder) {
  const folder=state.workspaces.find(folder=>folder.path===path);if(!folder)return;
  folder.tree=await api.listFolder(path);if(path===state.folder)state.tree=folder.tree;renderSidebar();
}

function renderTabs() {
  $('#tabs').innerHTML=state.documents.map(doc=>`<div class="document-tab ${doc.id===state.activeId?'active':''}" data-document="${doc.id}" role="tab" aria-selected="${doc.id===state.activeId}" title="${escape(doc.path||doc.name)}"><span class="tab-icon">${icon(doc.guide?'leaf':'file')}</span><span class="tab-name">${escape(doc.name.replace(/\.md$/i,''))}</span>${doc.dirty?'<span class="tab-dot"></span>':''}<button class="tab-close" data-close="${doc.id}" aria-label="关闭 ${escape(doc.name)}">${icon('close')}</button></div>`).join('')+`<button class="new-tab" data-action="new" aria-label="新建文稿">${icon('plus')}</button>`;
  const doc=active();$('#window-title').textContent=doc?.path?doc.path.split('/').slice(-2).join(' / '):doc?.name||'墨笺';
  document.title=`${doc?.dirty?'● ':''}${doc?.name||'墨笺'} — 墨笺`;
}
function treeHTML(nodes,depth=0) {
  return nodes.map(node=>{
    if(node.type==='directory') {
      const children=treeHTML(node.children||[],depth+1);if(state.filter&&!children)return '';
      const expanded=state.expanded.has(node.path)||!!state.filter;
      return `<div><button class="tree-row folder-row ${state.selectedDirectory===node.path?'selected':''}" data-folder="${escape(node.path)}"><span class="tree-chevron">${icon(expanded?'down':'chevron')}</span><span class="file-icon">${icon('folder')}</span><span class="file-name">${escape(node.name)}</span></button><div class="tree-children" ${expanded?'':'hidden'}>${children}</div></div>`;
    }
    if(state.filter&&!node.name.toLowerCase().includes(state.filter.toLowerCase()))return '';
    return `<button class="tree-row ${active()?.path===node.path?'active':''}" data-path="${escape(node.path)}"><span class="tree-chevron"></span><span class="file-icon">${icon('file')}</span><span class="file-name">${escape(node.name)}</span></button>`;
  }).join('');
}
function renderSidebar() {
  $$('[data-action="tab-files"],[data-action="tab-recent"]').forEach(el=>el.classList.toggle('active',el.dataset.action===`tab-${state.sidebarTab}`));
  $('#workspace-name').innerHTML=`${icon('folder')}<span>我的文件夹</span>`;
  if(state.sidebarTab==='recent') {
    $('#sidebar-content').innerHTML=`<div class="section-label">最近的文字</div><div class="recent-list">${state.recent.filter(doc=>doc.name.toLowerCase().includes(state.filter.toLowerCase())).map(doc=>`<button class="recent-item" data-path="${escape(doc.path)}"><strong>${escape(doc.name)}</strong><small>${escape(doc.path.replace(/^\/Users\/[^/]+/,'~'))}</small></button>`).join('')||'<p class="sidebar-empty">打开的文稿会出现在这里。</p>'}</div>`;return;
  }
  let html=`<div class="section-label">文件夹 <span>${state.workspaces.length}</span></div><div class="workspace-list">${state.workspaces.map(folder=>`<div class="workspace-row ${folder.path===state.folder?'active':''}"><button class="workspace-select" data-workspace="${escape(folder.path)}" title="${escape(folder.path)}">${icon('folder')}<span>${escape(folder.path.split('/').pop())}</span><small class="workspace-count">${countFiles(folder.tree)}</small></button><button class="workspace-remove" data-remove-workspace="${escape(folder.path)}" title="从列表移除，保留磁盘文件" aria-label="移除文件夹">${icon('close')}</button></div>`).join('')}</div>`;
  if(state.folder) html+=`<div class="folder-files-header"><span title="${escape(state.selectedDirectory||state.folder)}">${escape((state.selectedDirectory||state.folder).split('/').pop())}</span>${button('refresh-folder','history','刷新文件夹')}${button('new-file','plus','在此文件夹新建文稿')}</div><div class="file-tree">${treeHTML(state.tree)||'<div class="folder-empty"><p>还没有文稿</p><button class="button" data-action="new-file">新建文稿</button></div>'}</div>`;
  else {
    html+=`<div class="folder-empty"><div class="folder-empty-icon">${icon('folder')}</div><p>让文字有一个家</p><span>可以同时添加多个文件夹。</span><button class="button" data-action="open-folder">添加文件夹 ${icon('plus')}</button></div>`;
    html+=`<div class="section-label">独立文稿</div><div class="file-tree">${state.documents.filter(doc=>doc.name.toLowerCase().includes(state.filter.toLowerCase())).map(doc=>`<button class="file-row ${doc.id===state.activeId?'active':''}" data-document="${doc.id}"><span class="file-icon">${icon(doc.guide?'leaf':'file')}</span><span class="file-name">${escape(doc.name.replace(/\.md$/i,''))}</span>${doc.dirty?'<span class="tab-dot"></span>':''}</button>`).join('')}</div>`;
  }
  $('#sidebar-content').innerHTML=html;
}

async function createEditor(doc) {
  const initialContent=doc.content;doc.loading=true;
  const host=document.createElement('div');host.className='document-editor';host.id=`editor-${doc.id}`;host.hidden=doc.id!==state.activeId;$('#editor').append(host);
  await new Promise((resolve,reject)=>{
    let ed;
    try {
      ed=new Vditor(host,{
        cdn,lang:'zh_CN',mode:doc.mode||'ir',height:'100%',width:'100%',cache:{enable:false},value:'',
        theme:getTheme()==='dark'?'dark':'classic',placeholder:'在这里，写下你的第一个想法…',
        toolbar:['headings','bold','italic','strike','link','list','ordered-list','check','quote','code','inline-code','table','undo','redo','edit-mode'],
        toolbarConfig:{hide:true,pin:false},typewriterMode:!!state.settings.typewriter,
        outline:{enable:false},counter:{enable:false},resize:{enable:false},tab:'    ',
        preview:{delay:180,maxWidth:state.settings.editorWidth,mode:'editor',actions:[],transform:html=>displayImageHTML(html,doc),theme:{current:getTheme()==='dark'?'dark':'light'},markdown:{toc:true,mark:true,footnotes:true,autoSpace:false,fixTermTypo:false,sanitize:true,codeBlockPreview:true,mathBlockPreview:true},math:{engine:'KaTeX',inlineDigit:true},hljs:{enable:true,lineNumber:false,style:getTheme()==='dark'?'github-dark':'github'}},
        hint:{emoji:{},extend:[]},link:{isOpen:false,click:el=>safe(()=>openLink(el.getAttribute('href'),doc))},
        upload:{accept:'image/*',handler:files=>importImageFiles(files,doc,ed),handleDataUrl:async dataUrl=>(await api.saveImage({dataUrl,name:`粘贴图片-${Date.now()}.png`,documentPath:doc.path})).markdownPath},
        input:value=>{if(!doc.loading)onChange(doc,value);},
        after:()=>{
          for(const method of ['Md2VditorDOM','Md2VditorIRDOM','SpinVditorDOM','SpinVditorIRDOM','HTML2VditorDOM','HTML2VditorIRDOM']){
            if(typeof ed.vditor.lute[method]!=='function')continue;
            const render=ed.vditor.lute[method].bind(ed.vditor.lute);
            ed.vditor.lute[method]=(...args)=>displayImageHTML(render(...args),doc);
          }
          // Keep local image display URLs out of every Markdown conversion, including mode switches.
          for(const method of ['VditorDOM2Md','VditorIRDOM2Md']){
            const convert=ed.vditor.lute[method].bind(ed.vditor.lute);
            ed.vditor.lute[method]=html=>{
              if(!html.includes('data-original-src'))return convert(html);
              const template=document.createElement('template');template.innerHTML=html;
              $$('img[data-original-src]',template.content).forEach(image=>{image.setAttribute('src',image.dataset.originalSrc);image.removeAttribute('data-original-src');});
              return convert(template.innerHTML);
            };
          }
          ed.setValue(initialContent,true);
          editors.set(doc.id,ed);if(doc.id===state.activeId)editor=ed;
          doc.content=ed.getValue();if(!doc.dirty)doc.savedContent=doc.content;doc.loading=false;
          ed.vditor.element.addEventListener('mousedown',event=>{if(event.target.closest('a'))event.preventDefault();});
          const observer=new MutationObserver(()=>{clearTimeout(doc.imageTimer);doc.imageTimer=setTimeout(()=>safe(()=>resolveImages(doc,ed)),120);});
          observer.observe(host,{childList:true,subtree:true});doc.observer=observer;
          applySettings();updateStatus();renderOutline();safe(()=>resolveImages(doc,ed));resolve(ed);
        }
      });
    } catch(error){reject(error);}
  });
}
async function openDocument(input) {
  const existing=input.path&&state.documents.find(doc=>doc.path===input.path);
  if(existing){await activate(existing.id);return existing;}
  const doc={id:uid(),path:null,name:'未命名.md',content:'',savedContent:'',dirty:false,...input};
  doc.savedContent=input.savedContent??doc.content;doc.dirty=!!input.dirty||doc.content!==doc.savedContent;
  state.documents.push(doc);state.activeId=doc.id;
  for(const el of $$('.document-editor'))el.hidden=true;
  await createEditor(doc);await activate(doc.id);queueRecovery();
  if(doc.path) state.recent=await api.getRecentFiles();renderSidebar();return doc;
}
async function activate(id) {
  const doc=state.documents.find(item=>item.id===id);if(!doc)return;
  state.activeId=id;editor=editors.get(id);
  for(const el of $$('.document-editor')) el.hidden=el.id!==`editor-${id}`;
  renderTabs();renderSidebar();updateStatus();renderOutline();
  requestAnimationFrame(()=>{window.dispatchEvent(new Event('resize'));});
}
function onChange(doc,value) {
  doc.content=value;doc.dirty=value!==doc.savedContent;doc.guide=false;
  renderTabs();updateStatus();clearTimeout(outlineTimer);outlineTimer=setTimeout(renderOutline,180);
  queueRecovery();if(state.settings.autoSave&&doc.path)scheduleSave(doc);
}
function scheduleSave(doc) {clearTimeout(doc.saveTimer);if(doc.externalConflict)return;doc.saveTimer=setTimeout(()=>safe(()=>saveDocument(doc,false,true)),1100);}
function serialDocuments() {for(const doc of state.documents)syncDocument(doc);return state.documents.filter(doc=>!doc.guide).map(({id,path,sourcePath,name,content,savedContent,dirty,mode})=>({id,path,sourcePath,name,content,savedContent,dirty,mode}));}
function queueRecovery() {clearTimeout(recoveryTimer);recoveryTimer=setTimeout(()=>safe(()=>api.saveRecovery(serialDocuments())),350);}
async function saveDocument(doc=active(),saveAs=false,automatic=false) {
  if(!doc)return false;
  if(automatic&&(!doc.path||!doc.dirty||doc.externalConflict))return true;
  if(doc.saving){doc.saveAgain=true;await doc.saving;syncDocument(doc);if(saveAs||doc.dirty)return saveDocument(doc,saveAs,automatic);return true;}
  clearTimeout(doc.saveTimer);const content=editors.get(doc.id)?.getValue()??doc.content;
  const previousPath=doc.path;
  const lockEditor=!doc.path||saveAs;
  if(lockEditor){doc.locked=true;editors.get(doc.id)?.disabled();}
  doc.saving=(async()=>{
    const result=await api.saveFile({path:doc.path,sourcePath:doc.sourcePath,content,saveAs,suggestedName:doc.name});if(!result)return false;
    let finishCollisionWrite=false;
    for(const other of state.documents.filter(item=>item.id!==doc.id&&item.path===result.path)){
      clearTimeout(other.saveTimer);if(other.saving){await other.saving.catch(()=>{});finishCollisionWrite=true;}
      syncDocument(other);other.sourcePath=other.path;other.path=null;other.name=other.name.replace(/\.(md|markdown)$/i,'')+'（保留副本）.md';other.savedContent='';other.dirty=true;other.guide=false;
      toast('同一文件的另一标签已保留为独立草稿，避免覆盖。');
    }
    if(finishCollisionWrite)await api.saveFile({path:result.path,content:result.content??content});
    const currentEditor=editors.get(doc.id);const current=currentEditor?.getValue()??doc.content;
    const saved=result.content??content;
    doc.path=result.path;delete doc.sourcePath;
    if((saved!==content||doc.path!==previousPath)&&current===content)currentEditor?.setValue(saved);
    doc.name=result.name;doc.savedContent=saved;doc.content=current===content?saved:current;doc.dirty=doc.content!==saved;doc.guide=false;doc.lastSaved=Date.now();
    if(doc.path!==previousPath)await resolveImages(doc,editors.get(doc.id));
    renderTabs();renderSidebar();updateStatus();queueRecovery();
    state.recent=await api.getRecentFiles();if(!automatic)toast('文稿已保存');return true;
  })();
  try{return await doc.saving;}finally{doc.saving=null;if(lockEditor){doc.locked=false;editors.get(doc.id)?.enable();}if(doc.saveAgain){doc.saveAgain=false;if(doc.dirty&&state.settings.autoSave)scheduleSave(doc);}}
}
async function closeDocument(id) {
  const doc=state.documents.find(item=>item.id===id);if(!doc)return true;
  clearTimeout(doc.saveTimer);if(doc.saving)await doc.saving;
  syncDocument(doc);
  if(doc.dirty){
    const result=await choice('保存这份文稿？',`「${doc.name}」有尚未保存的修改。`,[{id:'cancel',label:'取消'},{id:'discard',label:'不保存'},{id:'save',label:'保存',primary:true}]);
    if(result==='cancel'||!result)return false;
    if(result==='save'){
      if(!await saveDocument(doc))return false;
      syncDocument(doc);if(doc.dirty)return closeDocument(id);
    }
  }
  const index=state.documents.indexOf(doc);doc.observer?.disconnect();clearTimeout(doc.imageTimer);editors.get(id)?.destroy();editors.delete(id);$(`#editor-${id}`)?.remove();state.documents.splice(index,1);
  if(!state.documents.length)await execute('new');else if(state.activeId===id)await activate(state.documents[Math.min(index,state.documents.length-1)].id);else{renderTabs();renderSidebar();}
  queueRecovery();return true;
}
async function beforeClose() {
  if(closeInProgress)return;closeInProgress=true;let confirmed=false;
  try{
    for(const doc of state.documents){clearTimeout(doc.saveTimer);if(doc.saving)await doc.saving;syncDocument(doc);}
    for(const doc of state.documents){
      syncDocument(doc);
      while(doc.dirty){
      await activate(doc.id);
      const answer=await choice('退出前保存文稿？',`「${doc.name}」有尚未保存的修改。`,[{id:'cancel',label:'取消退出'},{id:'discard',label:'不保存'},{id:'save',label:'保存',primary:true}]);
      if(!answer||answer==='cancel')return;
      if(answer==='save'&&!await saveDocument(doc))return;
      if(answer==='discard'){editors.get(doc.id)?.setValue(doc.savedContent);doc.content=doc.savedContent;doc.dirty=false;}
      else syncDocument(doc);
      }
    }
    clearTimeout(recoveryTimer);await api.saveRecovery(serialDocuments().filter(doc=>doc.path||doc.content.trim()));clearTimeout(zoomSaveTimer);await api.saveSettings({editorZoom:state.settings.editorZoom||1});confirmed=true;api.confirmClose();
  }finally{closeInProgress=false;if(!confirmed){clearTimeout(recoveryTimer);await api.saveRecovery(serialDocuments());api.cancelClose?.();if(state.settings.autoSave)for(const doc of state.documents)if(doc.path&&doc.dirty)scheduleSave(doc);}}
}
async function externalChange(change) {
  const doc=state.documents.find(doc=>doc.path===change.path);if(!doc)return;
  syncDocument(doc);
  if(change.deleted){doc.dirty=true;renderTabs();updateStatus();toast('文稿已在外部移走；当前内容仍保留在墨笺中。');return;}
  if(change.content===doc.content||change.content===doc.savedContent)return;
  if(doc.saving)return;
  if(doc.dirty){
    clearTimeout(doc.saveTimer);doc.externalConflict=true;await api.saveRecovery(serialDocuments());
    let answer;
    try{answer=await choice('文件在外部被修改',`「${doc.name}」在其他地方发生了变化。当前编辑内容已经保留在恢复副本中。`,[{id:'keep',label:'保留当前编辑'},{id:'reload',label:'载入外部版本',primary:true}]);}finally{doc.externalConflict=false;}
    if(answer!=='reload'){toast('已保留当前编辑；再次保存会覆盖外部版本。');return;}
  }
  doc.content=change.content;doc.savedContent=change.content;doc.dirty=false;editors.get(doc.id)?.setValue(change.content,true);renderTabs();updateStatus();renderOutline();queueRecovery();
}

function updateStatus() {
  const doc=active();if(!doc)return;
  const text=doc.content.replace(/```[\s\S]*?```/g,' ').replace(/[#*_~>`\[\]()|!-]/g,' ');
  const chinese=(text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)||[]).length;
  const words=(text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu,' ').match(/[\p{L}\p{N}]+/gu)||[]).length;
  $('#word-count').textContent=`${(chinese+words).toLocaleString()} 字`;
  $('#reading-time').textContent=`约 ${Math.max(1,Math.ceil((chinese+words)/350))} 分钟阅读`;
  $('#save-status').textContent=doc.dirty?(doc.path&&state.settings.autoSave?'正在自动保存…':'有未保存的修改'):(doc.path?(state.settings.autoSave?'自动保存已开启 · 已保存':'自动保存已关闭 · 已保存'):doc.guide?'欢迎，开始写作吧':'首次保存后将自动保存');
  $('.status-indicator').classList.toggle('unsaved',doc.dirty);
  const mode=editor?.getCurrentMode()||'ir';const split=mode==='sv'&&editor?.vditor.options.preview.mode==='both';
  $('#mode-status').textContent=mode==='sv'?(split?'分屏预览':'Markdown'):(mode==='wysiwyg'?'所见即所得':'即时渲染');
  $$('.mode-switch button').forEach(el=>el.classList.toggle('active',el.dataset.action===(mode==='sv'?(split?'preview':'source'):'instant')));
}
function renderOutline() {
  const doc=active();if(!doc)return;let fenced=false;const headings=[];
  for(const line of doc.content.split('\n')){if(/^\s*(```|~~~)/.test(line)){fenced=!fenced;continue;}if(fenced)continue;const m=line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/);if(m)headings.push({level:m[1].length,title:m[2].replace(/[*_`]/g,'')});}
  $('#outline-content').innerHTML=headings.map((h,i)=>`<button class="outline-item ${i===0?'active':''}" data-heading="${i}" data-level="${h.level}" title="${escape(h.title)}"><span>${escape(h.title)}</span></button>`).join('')||'<p class="outline-empty">添加标题后，<br>章节会在这里出现。</p>';
}
function setMode(mode,split=false) {
  if(!editor)return;
  editor.setPreviewMode(split?'both':'editor');
  editor.vditor.toolbar.elements['edit-mode'].querySelector(`[data-mode="${mode}"]`).click();
  active().mode=mode;updateStatus();queueRecovery();safe(()=>resolveImages(active(),editor));
}
function focusEditor(ed=editor) {
  if(!ed)return;
  const root=ed.vditor[ed.getCurrentMode()].element;
  const selection=getSelection();const range=selection.rangeCount?selection.getRangeAt(0):null;
  const container=range?.startContainer.nodeType===Node.ELEMENT_NODE?range.startContainer:range?.startContainer.parentElement;
  const valid=range&&root.contains(range.commonAncestorContainer)&&!container?.closest('.vditor-ir__marker');
  const retained=valid?range.cloneRange():null;
  ed.focus();
  const target=retained||document.createRange();if(!retained){target.selectNodeContents(root);target.collapse(false);}
  selection.removeAllRanges();selection.addRange(target);
}
function format(name) {
  if(!editor)return;focusEditor();const element=editor.vditor.toolbar.elements[name];
  if(element?.querySelector('button'))element.querySelector('button').click();
}
function insert(markdown) {if(active()?.locked)return;focusEditor();editor?.insertMD(markdown);if(editor)onChange(active(),editor.getValue());}
async function openLink(href,doc) {
  if(!href)return;
  if(href.startsWith('#')){const target=$(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`,editor.vditor.element);target?.scrollIntoView({behavior:'smooth'});return;}
  if(/^(https?:|mailto:)/i.test(href)){await api.openExternal(href);return;}
  if(doc.path&&/\.(md|markdown|mdown|mkd)(#.*)?$/i.test(href)){
    const parts=doc.path.split('/');parts.pop();for(const part of decodeURIComponent(href.split('#')[0]).split('/')){if(part==='..')parts.pop();else if(part!=='.')parts.push(part);}await openDocument(await api.readFile(parts.join('/')));
  }
}
function displayImageHTML(html,doc) {
  if(!html.includes('<img'))return html;
  const template=document.createElement('template');template.innerHTML=html;
  $$('img',template.content).forEach(image=>{
    const raw=image.dataset.originalSrc||image.getAttribute('src');
    if(!raw||/^(data:|https?:|mojian-file:)/i.test(raw))return;
    try{
      if(!doc.path&&!doc.sourcePath&&!raw.startsWith('file:')&&!raw.startsWith('/'))return;
      const url=new URL(raw,`file://${doc.path||doc.sourcePath||'/'}`);
      if(url.protocol!=='file:')return;
      image.dataset.originalSrc=raw;image.src=api.assetUrl(decodeURIComponent(url.pathname));
    }catch{}
  });
  return template.innerHTML;
}
async function resolveImages(doc,ed) {
  if(!ed?.vditor?.lute)return;
  for(const image of $$('img',ed.vditor.element)){
    const raw=image.getAttribute('src');if(!raw||/^(data:|https?:|mojian-file:)/i.test(raw)||image.dataset.resolving)continue;
    image.dataset.resolving='true';try{const url=await api.resolveAsset({documentPath:doc.path||doc.sourcePath,src:raw});if(url!==raw){image.dataset.originalSrc=raw;image.src=url;}}catch{image.title='无法读取此图片，请检查图片路径。';}finally{delete image.dataset.resolving;}
  }
}
async function importImageFiles(files,doc=active(),ed=editor) {
  try{for(const file of files){if(!file.type.startsWith('image/')){toast('请选择图片文件。','error');continue;}if(file.size>30*1024*1024){toast('图片不能超过 30 MB。','error');continue;}
    const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
    const result=await api.saveImage({dataUrl,name:file.name,documentPath:doc.path});focusEditor(ed);ed.insertMD(`![${file.name.replace(/[\[\]]/g,'')}](${result.markdownPath})`);onChange(doc,ed.getValue());}
    return null;
  }catch(error){toast(error.message,'error');return error.message;}
}

function showModal(title,body,footer='',className='') {
  const range=getSelection()?.rangeCount?getSelection().getRangeAt(0):null;
  if(range&&editor?.vditor.element.contains(range.commonAncestorContainer))savedEditorRange=range.cloneRange();
  if(modalResolve){modalResolve(null);modalResolve=null;}
  $('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal ${className}" role="dialog" aria-modal="true" aria-label="${escape(title)}"><div class="modal-header"><h2>${escape(title)}</h2>${button('close-modal','close','关闭')}</div><div class="modal-body">${body}</div>${footer?`<div class="modal-footer">${footer}</div>`:''}</section></div>`;
  setTimeout(()=>$('.modal input, .modal select, .modal .button.primary, .modal button')?.focus(),30);
}
function closeModal(value=null) {$('#modal-root').innerHTML='';if(savedEditorRange){try{const selection=getSelection();selection.removeAllRanges();selection.addRange(savedEditorRange);}catch{}savedEditorRange=null;}const resolve=modalResolve;modalResolve=null;resolve?.(value);}
function choice(title,message,choices) {
  showModal(title,`<p class="dialog-message">${escape(message)}</p>`,choices.map(c=>`<button class="button ${c.primary?'primary':''}" data-choice="${c.id}">${escape(c.label)}</button>`).join(''));
  return new Promise(resolve=>modalResolve=resolve);
}
function preferences() {
  const s=state.settings;
  showModal('让写作更合心意',`<p class="modal-description">一点调整，让墨笺成为你的写作空间。</p>
  <label class="form-row"><span><strong>外观</strong><small>选择纸张与界面的颜色</small></span><select id="pref-theme" data-setting="theme"><option value="system" ${s.theme==='system'?'selected':''}>跟随系统</option><option value="light" ${s.theme==='light'?'selected':''}>浅色 · 晨光</option><option value="dark" ${s.theme==='dark'?'selected':''}>深色 · 夜林</option></select></label>
  <label class="form-row"><span><strong>正文字号</strong><small>适合你的阅读距离</small></span><span class="range-control"><input id="pref-fontSize" type="range" min="13" max="26" value="${s.fontSize}" data-setting="fontSize"><output>${s.fontSize} px</output></span></label>
  <label class="form-row"><span><strong>行距</strong><small>给文字留出呼吸</small></span><select id="pref-lineHeight" data-setting="lineHeight">${[1.5,1.7,1.85,2,2.2].map(n=>`<option value="${n}" ${Number(s.lineHeight)===n?'selected':''}>${n}</option>`).join('')}</select></label>
  <label class="form-row"><span><strong>正文宽度</strong><small>长文阅读时的舒适行宽</small></span><select data-setting="editorWidth">${[640,720,780,900,1100].map(n=>`<option value="${n}" ${Number(s.editorWidth)===n?'selected':''}>${n} px</option>`).join('')}</select></label>
  <label class="form-row"><span><strong>自动保存</strong><small>停止输入后，保存已命名的文稿</small></span><input type="checkbox" class="toggle" data-setting="autoSave" ${s.autoSave?'checked':''}></label>
  <label class="form-row"><span><strong>打字机模式</strong><small>让当前段落停在视野中央</small></span><input type="checkbox" class="toggle" data-setting="typewriter" ${s.typewriter?'checked':''}></label>
  <label class="form-row"><span><strong>拼写检查</strong><small>使用 macOS 提供的检查功能</small></span><input type="checkbox" class="toggle" data-setting="spellcheck" ${s.spellcheck?'checked':''}></label>
  <p class="settings-note">文稿、恢复副本与设置均保存在本机。历史版本最多保留每个文件最近 40 次保存前的内容。</p>`,`<button class="button primary" data-action="close-modal">开始写作</button>`,'preferences-modal');
}
const commands=[
  ['new','新建文稿','给新的想法一张白纸','⌘N','plus'],['open','打开文稿','继续写你的 Markdown','⌘O','file'],['open-folder','打开文件夹','浏览整个写作项目','','folder'],['save','保存文稿','把文字留在本机','⌘S','save'],['save-as','另存为','保存一份独立副本','⇧⌘S','file'],['source','切换源码模式','查看 Markdown 标记','⌘/','code'],['wysiwyg','所见即所得模式','隐藏标记，直接编辑排版','','file'],['preview','源码与预览分屏','同时查看 Markdown 和排版','','sidebar'],['focus','切换专注模式','只留下眼前的文字','','focus'],['typewriter','切换打字机模式','当前段落保持在中央','','typewriter'],['theme','切换明暗外观','晨光或夜林','','moon'],['find','查找与替换','在当前文稿中定位文字','⌘F','search'],['export-pdf','导出 PDF','适合打印与分享','','export'],['export-html','导出 HTML','保存为独立网页','','export'],['history','文稿历史版本','找回之前保存的内容','','history'],['math','插入数学公式','支持 LaTeX / KaTeX','','code'],['mermaid','插入流程图','使用 Mermaid 绘图','','sparkle'],['table','插入表格','让信息井然有序','','table'],['image','插入图片','将图片复制到文稿附件目录','','image'],['preferences','偏好设置','字号、行距与自动保存','⌘,','settings'],['markdown-guide','Markdown 语法手册','常用语法与快捷键','','help']
];
function palette(filesOnly=false) {
  showModal(filesOnly?'快速打开文稿':'命令面板',`<div class="palette-search">${icon('search')}<input id="palette-input" placeholder="${filesOnly?'搜索文件名…':'输入命令，或者搜索文稿…'}" autocomplete="off"></div><div class="palette-list" id="palette-list"></div><div class="palette-hint"><span>↑ ↓ 选择</span><span>↵ 执行</span><span>esc 关闭</span></div>`,'','command-palette');
  const list=()=>{
    const query=$('#palette-input').value.toLowerCase();
    const results=filesOnly?[]:commands.filter(c=>(c[1]+c[2]).toLowerCase().includes(query)).map(c=>({action:c[0],name:c[1],detail:c[2],shortcut:c[3],glyph:c[4]}));
    const files=new Map();state.documents.forEach(doc=>files.set(doc.path||doc.id,{name:doc.name,document:doc.id}));
    const walk=nodes=>nodes.forEach(n=>n.type==='directory'?walk(n.children||[]):files.set(n.path,{name:n.name,path:n.path}));state.workspaces.forEach(folder=>walk(folder.tree));state.recent.forEach(doc=>{if(!files.has(doc.path))files.set(doc.path,doc);});
    for(const [key,doc] of files)if(doc.name.toLowerCase().includes(query))results.push({name:doc.name,detail:doc.path||'已打开的文稿',glyph:'file',path:doc.path,document:doc.document});
    $('#palette-list').innerHTML=results.slice(0,40).map((r,i)=>`<button class="palette-item ${i===0?'active':''}" ${r.action?`data-command="${r.action}"`:r.document?`data-palette-document="${r.document}"`:`data-palette-path="${escape(r.path)}"`}>${icon(r.glyph)}<span><strong>${escape(r.name)}</strong><small>${escape(r.detail)}</small></span><kbd class="palette-shortcut">${r.shortcut||''}</kbd></button>`).join('')||'<p class="palette-empty">没有找到匹配项。</p>';
  };
  $('#palette-input').addEventListener('input',list);list();$('#palette-input').focus();
  $('#palette-input').addEventListener('keydown',event=>{
    const items=$$('.palette-item');const i=items.findIndex(el=>el.classList.contains('active'));
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();items[i]?.classList.remove('active');const next=items[(i+(event.key==='ArrowDown'?1:-1)+items.length)%items.length];next?.classList.add('active');next?.scrollIntoView({block:'nearest'});}
    if(event.key==='Enter'){event.preventDefault();items[i>=0?i:0]?.click();}
  });
}
function openFind(replace=false) {
  $('.find-bar').hidden=false;$('.replace-fields').hidden=!replace;
  const selection=editor?.getSelection();if(selection&&selection.length<200)$('#find-input').value=selection;
  $('#find-input').focus();$('#find-input').select();updateFind();
}
function closeFind() {$('.find-bar').hidden=true;CSS.highlights?.delete('search');CSS.highlights?.delete('search-current');editor?.focus();}
function updateFind(direction=0) {
  const query=$('#find-input').value;findState.query=query;
  const source=editor?.getValue()||'';findState.matches=[];
  if(query){let index=0;while((index=source.toLocaleLowerCase().indexOf(query.toLocaleLowerCase(),index))!==-1){findState.matches.push(index);index+=query.length;}}
  if(direction&&findState.matches.length)findState.index=(findState.index+direction+findState.matches.length)%findState.matches.length;
  else findState.index=Math.max(0,Math.min(findState.index,findState.matches.length-1));
  $('.find-count').textContent=findState.matches.length?`${findState.index+1} / ${findState.matches.length}`:'0 处';
  if(!CSS.highlights||!window.Highlight)return;
  CSS.highlights.delete('search');CSS.highlights.delete('search-current');if(!query||!editor)return;
  const root=editor.vditor[editor.getCurrentMode()].element;const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const ranges=[];let node;
  while((node=walker.nextNode())){if(!node.parentElement.checkVisibility())continue;let index=0;const text=node.textContent.toLocaleLowerCase();while((index=text.indexOf(query.toLocaleLowerCase(),index))!==-1){const range=new Range();range.setStart(node,index);range.setEnd(node,index+query.length);ranges.push(range);index+=query.length;}}
  CSS.highlights.set('search',new Highlight(...ranges));
  const selected=ranges[findState.index%ranges.length];if(selected){CSS.highlights.set('search-current',new Highlight(selected));if(direction)selected.startContainer.parentElement.scrollIntoView({block:'center',behavior:'smooth'});}
}
function replaceText(all=false) {
  const query=$('#find-input').value;if(!query)return;const value=editor.getValue();const replacement=$('#replace-input').value;
  updateFind();if(!findState.matches.length)return;let next;
  if(all){const regex=new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');next=value.replace(regex,()=>replacement);}
  else{const i=findState.matches[findState.index];next=value.slice(0,i)+replacement+value.slice(i+query.length);}
  editor.setValue(next);onChange(active(),editor.getValue());updateFind();
}

async function exportDocument(format) {
  const doc=active();if(!doc)return;toast('正在准备导出…');
  const preview=document.createElement('div');preview.className='vditor-reset export-preview';preview.style.cssText='position:fixed;left:-20000px;width:800px;';document.body.append(preview);
  try{
    await Vditor.preview(preview,editor.getValue(),{cdn,mode:'light',lang:'zh_CN',anchor:0,transform:html=>displayImageHTML(html,doc),theme:{current:'light',path:`${cdn}/dist/css/content-theme`},markdown:{toc:true,mark:true,footnotes:true,sanitize:true},math:{engine:'KaTeX',inlineDigit:true},hljs:{enable:true,style:'github'},speech:{enable:false}});
    // Wait for bundled renderers rather than exporting a partially drawn formula or diagram.
    const deadline=Date.now()+8000;
    do{
      await new Promise(resolve=>setTimeout(resolve,120));
      if(!$('.language-mermaid:not([data-processed="true"]),.language-math:not([data-math])',preview))break;
    }while(Date.now()<deadline);
    await document.fonts.ready;
    const toDataUrl=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});
    for(const image of $$('img',preview)){
      try{const src=await api.resolveAsset({documentPath:doc.path||doc.sourcePath,src:image.getAttribute('src')});if(!/^data:/i.test(src)){const response=await fetch(src);if(response.ok)image.src=await toDataUrl(await response.blob());}}catch{}
    }
    let css='';for(const sheet of [...document.styleSheets]){try{if(sheet.href&&!/(content-theme|katex|github)/i.test(sheet.href))continue;css += [...sheet.cssRules].map(rule=>rule.cssText).join('\n').replace(/url\(["']?([^)'"\s]+)["']?\)/g,(match,url)=>`url("${new URL(url,sheet.href||location.href).href}")`);}catch{}}
    const fontURLs=[...new Set([...css.matchAll(/url\("([^"]+)"\)/g)].map(m=>m[1]).filter(url=>/\.(woff2?|ttf)(\?|$)/i.test(url)))];
    await Promise.all(fontURLs.map(async url=>{try{const response=await fetch(url);if(response.ok)css=css.split(url).join(await toDataUrl(await response.blob()));}catch{}}));
    const content=preview.innerHTML;
    const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(doc.name.replace(/\.md$/i,''))}</title><style>${css}\nhtml{color-scheme:light!important;background:white!important}body{margin:0;background:white!important;color:#262d28!important}.vditor-reset{max-width:820px;margin:0 auto;padding:55px 40px;font:16px/1.85 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;background:white!important;color:#262d28!important}.vditor-reset h1{font-size:2.2em}.vditor-reset h2{margin-top:2em}img,svg{max-width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#326657}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px 12px}blockquote{margin-left:0;padding-left:18px;border-left:3px solid #769b82;color:#647167}button,.vditor-copy{display:none!important}@media print{.vditor-reset{max-width:none;padding:0}pre,blockquote,tr,svg{break-inside:avoid}h1,h2,h3{break-after:avoid}}</style></head><body><article class="vditor-reset">${content}</article></body></html>`;
    const result=await api.exportFile({format,html,suggestedName:doc.name.replace(/\.(md|markdown)$/i,'')});if(result)toast(`${format.toUpperCase()} 已导出`);
  }finally{preview.remove();applySettings();}
}
async function history() {
  const doc=active();if(!doc.path){toast('保存文稿后，即可查看历史版本。');return;}
  const versions=await api.getVersions(doc.path);
  showModal('文稿历史版本',`<p class="modal-description">每次覆盖保存前，墨笺会保留上一版。载入历史后可以检查，再决定保存。</p><div class="versions-list">${versions.map(v=>`<button class="version-row" data-version="${escape(v.id)}"><span>${icon('history')} ${escape(new Date(v.timestamp||v.createdAt||v.time||Number(v.id.split('-')[0])).toLocaleString('zh-CN'))}</span><span>${v.size?`${Math.ceil(v.size/1024)} KB`:''} 载入 →</span></button>`).join('')||'<p class="empty-message">还没有历史版本。修改并保存这份文稿后，上一版会出现在这里。</p>'}</div>`,`<button class="button" data-action="close-modal">返回写作</button>`);
}
async function execute(command) {
  if(!state.ready&&command!=='before-close')return;
  if(active()?.locked&&(command.startsWith('heading-')||['bold','italic','strike','quote','list','ordered-list','check','code','table','inline-code','undo','redo','image','link','insert-link','math','mermaid','replace-one','replace-all','source','toggle-source','instant','wysiwyg','preview','close-tab'].includes(command))){toast('正在保存，请稍候。');return;}
  switch(command){
    case 'new': {let n=1;while(state.documents.some(d=>d.name===`未命名 ${n}.md`))n++;await openDocument({name:`未命名 ${n}.md`,content:''});editor?.focus();break;}
    case 'open': {const doc=await api.openFile();if(doc)await openDocument(doc);break;}
    case 'open-folder': {const folder=await api.openFolder();if(folder){const existing=state.workspaces.find(item=>item.path===folder.path);if(existing)existing.tree=folder.tree;else state.workspaces.push(folder);await selectWorkspace(folder.path);await updateSettings({sidebar:true});}break;}
    case 'refresh-folder': return refreshWorkspace();
    case 'new-file': {
      if(!state.folder)return execute('new');
      const directory=state.selectedDirectory||state.folder;
      showModal('新建文稿',`<p class="modal-description">保存到 ${escape(directory.split('/').pop())} 文件夹，之后自动保存。</p><label class="input-label">文稿名称<input id="new-file-name" value="未命名文稿.md" autocomplete="off"></label>`,`<button class="button" data-action="close-modal">取消</button><button class="button primary" data-action="create-file">新建文稿</button>`);
      $('.modal').dataset.directory=directory;setTimeout(()=>{const input=$('#new-file-name');input?.setSelectionRange(0,input.value.replace(/\.md$/i,'').length);},50);break;
    }
    case 'create-file': {
      const name=$('#new-file-name').value.trim();const directory=$('.modal').dataset.directory;
      const doc=await api.createFile({folderPath:directory,name});closeModal();await openDocument(doc);await refreshWorkspace();editor?.focus();toast('已新建文稿，后续修改会自动保存');break;
    }
    case 'zoom-in': setEditorZoom((state.settings.editorZoom||1)*1.1);break;
    case 'zoom-out': setEditorZoom((state.settings.editorZoom||1)/1.1);break;
    case 'reset-zoom': setEditorZoom(1);break;
    case 'save': return saveDocument();
    case 'save-as': return saveDocument(active(),true);
    case 'close-tab': return closeDocument(state.activeId);
    case 'before-close': return beforeClose();
    case 'sidebar': case 'toggle-sidebar': return updateSettings({sidebar:!state.settings.sidebar});
    case 'outline': case 'toggle-outline': return updateSettings({outline:!state.settings.outline});
    case 'focus': case 'toggle-focus': return updateSettings({focus:!state.settings.focus});
    case 'typewriter': case 'toggle-typewriter': return updateSettings({typewriter:!state.settings.typewriter});
    case 'theme': return updateSettings({theme:getTheme()==='dark'?'light':'dark'});
    case 'source': case 'toggle-source': setMode(editor.getCurrentMode()==='sv'?'ir':'sv');break;
    case 'instant': setMode('ir');break;
    case 'wysiwyg': setMode('wysiwyg');break;
    case 'preview': setMode('sv',true);break;
    case 'find': openFind();break;
    case 'replace': openFind(true);break;
    case 'show-replace': $('.replace-fields').hidden=!$('.replace-fields').hidden;$('#replace-input').focus();break;
    case 'close-find': closeFind();break;
    case 'find-next': updateFind(1);break;
    case 'find-prev': updateFind(-1);break;
    case 'replace-one': replaceText();break;
    case 'replace-all': replaceText(true);break;
    case 'preferences': preferences();break;
    case 'palette': case 'command-palette': palette();break;
    case 'quick-open': palette(true);break;
    case 'tab-files': state.sidebarTab='files';renderSidebar();break;
    case 'tab-recent': state.sidebarTab='recent';state.recent=await api.getRecentFiles();renderSidebar();break;
    case 'close-modal': closeModal();break;
    case 'export': showModal('把文字带去更远的地方',`<p class="modal-description">导出当前文稿，保留清晰的排版。</p><div class="export-options"><button data-command="export-pdf" class="export-option">${icon('file')}<strong>PDF 文档</strong><small>适合打印、阅读和分享</small></button><button data-command="export-html" class="export-option">${icon('code')}<strong>HTML 网页</strong><small>独立网页，内嵌样式与本地图片</small></button></div>`);break;
    case 'export-pdf': return exportDocument('pdf');
    case 'export-html': return exportDocument('html');
    case 'image': {const images=await api.pickImages({documentPath:active().path});for(const img of images)insert(`![${img.name.replace(/[\[\]]/g,'')}](${img.markdownPath})`);break;}
    case 'history': return history();
    case 'welcome': {const exists=state.documents.find(d=>d.guide==='welcome');if(exists)await activate(exists.id);else await openDocument({name:'欢迎使用墨笺',content:welcome,guide:'welcome'});break;}
    case 'markdown-guide': await openDocument({name:'Markdown 语法手册',content:markdownGuide,guide:'syntax'});break;
    case 'headings': showModal('选择标题层级',`<div class="heading-options">${[1,2,3,4,5,6].map(n=>`<button class="heading-option" data-command="heading-${n}"><span>H${n}</span><strong style="font-size:${25-n*2}px">${['一','二','三','四','五','六'][n-1]}级标题</strong></button>`).join('')}</div>`);break;
    case 'math': insert('\n$$\nE = mc^2\n$$\n');break;
    case 'mermaid': insert('\n```mermaid\ngraph LR\n  A[开始] --> B[写下想法]\n  B --> C[完成]\n```\n');break;
    case 'link': {const selection=editor.getSelection();showModal('插入链接',`<label class="input-label">显示文字<input id="link-text" value="${escape(selection||'链接文字')}" placeholder="链接文字"></label><label class="input-label">链接地址<input id="link-url" value="https://" placeholder="https://example.com"></label>`,`<button class="button" data-action="close-modal">取消</button><button class="button primary" data-action="insert-link">插入链接</button>`);break;}
    case 'insert-link': {const text=$('#link-text').value.replace(/[\[\]]/g,'');const href=$('#link-url').value.trim();if(!/^(https?:|mailto:|#)/i.test(href)){toast('请输入 https://、http:// 或 mailto: 链接。','error');break;}closeModal();insert(`[${text}](${href.replace(/[()\s]/g,c=>encodeURIComponent(c))})`);break;}
    default: if(command.startsWith('heading-')){focusEditor();editor.vditor.toolbar.elements.headings.querySelector(`[data-tag="h${Number(command.slice(-1))||1}"]`).click();}else if(['bold','italic','strike','quote','list','ordered-list','check','code','table','inline-code','undo','redo'].includes(command))format(command);
  }
}

document.addEventListener('mousedown',event=>{if(event.target.closest('.editor-toolbar button'))event.preventDefault();});
document.addEventListener('click',event=>safe(async()=>{
  const close=event.target.closest('[data-close]');if(close){await closeDocument(close.dataset.close);return;}
  const choiceButton=event.target.closest('[data-choice]');if(choiceButton){closeModal(choiceButton.dataset.choice);return;}
  const command=event.target.closest('[data-command]');if(command){const action=command.dataset.command;closeModal();await execute(action);return;}
  const action=event.target.closest('[data-action]');if(action){await execute(action.dataset.action);return;}
  const tab=event.target.closest('[data-document]');if(tab){await activate(tab.dataset.document);return;}
  const file=event.target.closest('[data-path]');if(file){await openDocument(await api.readFile(file.dataset.path));return;}
  const workspace=event.target.closest('[data-workspace]');if(workspace){await selectWorkspace(workspace.dataset.workspace);return;}
  const removed=event.target.closest('[data-remove-workspace]');if(removed){
    const path=removed.dataset.removeWorkspace;state.workspaces=state.workspaces.filter(folder=>folder.path!==path);await api.unwatchFolder(path);
    if(state.folder===path){state.folder=null;state.selectedDirectory=null;state.tree=[];if(state.workspaces.length)await selectWorkspace(state.workspaces[0].path);}
    await persistFolders();renderSidebar();return;
  }
  const folder=event.target.closest('[data-folder]');if(folder){const path=folder.dataset.folder;state.selectedDirectory=path;state.expanded.has(path)?state.expanded.delete(path):state.expanded.add(path);renderSidebar();return;}
  const heading=event.target.closest('[data-heading]');if(heading){const index=Number(heading.dataset.heading);const root=editor.vditor[editor.getCurrentMode()].element;$$('h1,h2,h3,h4,h5,h6',root)[index]?.scrollIntoView({behavior:'smooth',block:'start'});$$('.outline-item').forEach(el=>el.classList.toggle('active',el===heading));return;}
  const paletteDoc=event.target.closest('[data-palette-document]');if(paletteDoc){const id=paletteDoc.dataset.paletteDocument;closeModal();await activate(id);return;}
  const palettePath=event.target.closest('[data-palette-path]');if(palettePath){const path=palettePath.dataset.palettePath;closeModal();await openDocument(await api.readFile(path));return;}
  const version=event.target.closest('[data-version]');if(version){const doc=active();const old=await api.restoreVersion({path:doc.path,id:version.dataset.version});closeModal();editor.setValue(old.content);onChange(doc,editor.getValue());clearTimeout(doc.saveTimer);toast('已载入历史内容，请检查后按 ⌘S 保存。');return;}
  if(event.target.classList.contains('modal-backdrop'))closeModal();
}));
document.addEventListener('input',event=>{
  if(event.target.id==='file-filter'){state.filter=event.target.value;renderSidebar();}
  if(event.target.id==='find-input'){findState.index=0;updateFind();}
  if(event.target.dataset.setting&&event.target.type==='range'){event.target.nextElementSibling.textContent=`${event.target.value} px`;safe(()=>updateSettings({[event.target.dataset.setting]:Number(event.target.value)}));}
});
document.addEventListener('change',event=>{if(event.target.dataset.setting){const key=event.target.dataset.setting;const value=event.target.type==='checkbox'?event.target.checked:['fontSize','lineHeight','editorWidth'].includes(key)?Number(event.target.value):event.target.value;safe(()=>updateSettings({[key]:value}));}});
document.addEventListener('keydown',event=>{
  if(event.target.id==='new-file-name'&&event.key==='Enter'){event.preventDefault();safe(()=>execute('create-file'));return;}
  if(event.key==='Escape'){if($('#modal-root').children.length)closeModal();else if(!$('.find-bar').hidden)closeFind();else if(state.settings.focus)safe(()=>updateSettings({focus:false}));return;}
  if(event.target.id==='find-input'&&event.key==='Enter'){event.preventDefault();updateFind(event.shiftKey?-1:1);return;}
  if((event.metaKey||event.ctrlKey)&&!event.altKey){const key=event.key.toLowerCase();let command;
    if(key==='/')command='source';else if(key==='p')command=event.shiftKey?'palette':'quick-open';
    if(command){event.preventDefault();event.stopImmediatePropagation();safe(()=>execute(command));}
  }
},true);
window.addEventListener('dragover',event=>event.preventDefault());
window.addEventListener('drop',event=>safe(async()=>{
  const files=[...event.dataTransfer.files];if(files.some(file=>file.type.startsWith('image/'))){event.preventDefault();event.stopPropagation();await importImageFiles(files);}
}));

window.__mojian={getState:()=>({documents:state.documents.map(({id,path,name,content,savedContent,dirty})=>({id,path,name,content,savedContent,dirty})),activeId:state.activeId,settings:{...state.settings},folder:state.folder,workspaces:state.workspaces.map(folder=>({path:folder.path,fileCount:countFiles(folder.tree)})),mode:editor?.getCurrentMode()}),getEditor:()=>editor,execute,openDocument};

async function init() {
  const [settings,recent,recovered]=await Promise.all([api.getSettings(),api.getRecentFiles(),api.getRecovery()]);
  state.settings={...defaults,...settings};state.recent=recent;applySettings();state.ready=true;
  if(Array.isArray(recovered)&&recovered.length){
    for(const input of recovered.slice(0,20)){
      if(typeof input.content!=='string')continue;
      if(input.path&&!input.dirty){try{const current=await api.readFile(input.path);input.content=current.content;input.savedContent=current.content;}catch{input.dirty=true;}}
      await openDocument({...input,id:uid()});
    }
    if(state.documents.length)toast('已恢复上次的写作空间');
  }
  if(!state.documents.length)await execute('welcome');
  for(const doc of pendingDocuments.splice(0))await openDocument(doc);
  const folders=Array.isArray(settings.workspaceFolders)?settings.workspaceFolders:settings.lastFolder?[settings.lastFolder]:[];
  for(const path of [...new Set(folders)].slice(0,50)){
    try{const tree=await api.listFolder(path);state.workspaces.push({path,tree});await api.watchFolder(path);}catch{ /* Keep missing locations out of the current sidebar. */ }
  }
  if(state.workspaces.length)await selectWorkspace(state.workspaces.some(folder=>folder.path===settings.lastFolder)?settings.lastFolder:state.workspaces[0].path);
  renderTabs();renderSidebar();applySettings();
}
safe(init);
