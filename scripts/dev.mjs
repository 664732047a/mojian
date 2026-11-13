import { spawn } from 'node:child_process';
import { cp, mkdir } from 'node:fs/promises';
await mkdir('public/vditor/dist', {recursive: true});
await cp('node_modules/vditor/dist', 'public/vditor/dist', {recursive:true});
const vite = spawn('node_modules/.bin/vite', [], {stdio:'inherit'});
let electron;
for(let i=0;i<80;i++) {
  try { if((await fetch('http://127.0.0.1:5173')).ok) break; } catch {}
  await new Promise(r=>setTimeout(r,250));
}
electron = spawn('node_modules/.bin/electron', ['.'], {stdio:'inherit',env:{...process.env,VITE_DEV_SERVER_URL:'http://127.0.0.1:5173'}});
electron.on('exit', code=>{vite.kill();process.exit(code||0)});
process.on('SIGINT',()=>{vite.kill();electron.kill();});
