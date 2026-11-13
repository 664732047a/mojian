import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
await mkdir('dist/vditor/dist', { recursive: true });
await cp('node_modules/vditor/dist', 'dist/vditor/dist', { recursive: true });
await mkdir('dist/third-party', { recursive: true });
await cp('node_modules/vditor/LICENSE', 'dist/third-party/Vditor-LICENSE.txt');
await cp('node_modules/diff-match-patch/LICENSE', 'dist/third-party/diff-match-patch-LICENSE.txt');
await cp('node_modules/electron/dist/LICENSE', 'dist/third-party/Electron-LICENSE.txt');
await cp('node_modules/electron/dist/LICENSES.chromium.html', 'dist/third-party/Electron-LICENSES.chromium.html');
await cp('build/third-party', 'dist/third-party', { recursive: true });
await cp('THIRD_PARTY_NOTICES.md', 'dist/third-party/THIRD_PARTY_NOTICES.md');
// These comments are also retained in the unchanged offline distribution above.
const mermaid = await readFile('node_modules/vditor/dist/js/mermaid/mermaid.min.js', 'utf8');
const mermaidStart = mermaid.lastIndexOf('/*! Bundled license information:');
if (mermaidStart >= 0) {
  const mermaidEnd = mermaid.indexOf('*/', mermaidStart) + 2;
  await writeFile('dist/third-party/Mermaid-BUNDLED-NOTICES.txt', mermaid.slice(mermaidStart, mermaidEnd) + '\n');
}
const viz = await readFile('node_modules/vditor/dist/js/graphviz/viz.js', 'utf8');
const vizStart = viz.indexOf('/*');
if (vizStart >= 0) {
  const vizEnd = viz.indexOf('*/', vizStart) + 2;
  await writeFile('dist/third-party/Vizjs-BUNDLED-NOTICES.txt', viz.slice(vizStart, vizEnd) + '\n');
}
console.log('离线编辑资源已就绪。');
