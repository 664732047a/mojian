const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { validateDocumentName } = require('./platform.cjs');
const { fileURLToPath } = require('node:url');

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdx', '.txt']);
const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'target', '.DS_Store', '.Trash']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp', '.ico', '.heic', '.tiff']);

async function atomicWrite(filePath, content) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  let mode;
  try { mode = (await fs.stat(filePath)).mode; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try {
    await fs.writeFile(temporaryPath, content, mode ? { mode } : undefined);
    // Windows can briefly lock the destination while it is being read or scanned.
    // Keep the original intact and retry the atomic replacement for a bounded time.
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(temporaryPath, filePath); break; }
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 6) throw error;
        await delay(25 * 2 ** attempt);
      }
    }
  } finally { await fs.rm(temporaryPath, { force: true }).catch(() => {}); }
}

async function readJSON(filePath, fallback) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return fallback; throw error; }
}

async function listTree(rootPath, depth = 0, budget = { count: 0 }) {
  if (depth > 10 || budget.count > 6000) return [];
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const nodes = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || IGNORED_DIRECTORIES.has(entry.name) || entry.isSymbolicLink()) continue;
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      budget.count++;
      try { nodes.push({ name: entry.name, path: entryPath, type: 'directory', children: await listTree(entryPath, depth + 1, budget) }); }
      catch (error) { if (!['EACCES', 'ENOENT', 'EPERM'].includes(error.code)) throw error; }
    } else if (entry.isFile() && MARKDOWN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      budget.count++;
      nodes.push({ name: entry.name, path: entryPath, type: 'file' });
    }
    if (budget.count > 6000) break;
  }
  return nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'zh-CN', { numeric: true }) : a.type === 'directory' ? -1 : 1));
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function markdownImageDestinations(markdown) {
  const destinations = [];
  const codeRanges = [];
  let offset = 0;
  let fence;
  for (const line of markdown.split(/(?<=\n)/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)/.exec(line);
    if (marker) {
      if (!fence) fence = { start: offset, character: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) {
        codeRanges.push([fence.start, offset + line.length]);
        fence = null;
      }
    }
    offset += line.length;
  }
  if (fence) codeRanges.push([fence.start, markdown.length]);
  const inlineCode = /`+/g;
  let tick;
  while ((tick = inlineCode.exec(markdown))) {
    if (codeRanges.some(([start, end]) => tick.index >= start && tick.index < end)) continue;
    let closing = markdown.indexOf(tick[0], inlineCode.lastIndex);
    while (closing >= 0 && (markdown[closing - 1] === '`' || markdown[closing + tick[0].length] === '`')) closing = markdown.indexOf(tick[0], closing + tick[0].length);
    if (closing >= 0) { codeRanges.push([tick.index, closing + tick[0].length]); inlineCode.lastIndex = closing + tick[0].length; }
  }
  const isCode = index => codeRanges.some(([start, end]) => index >= start && index < end);
  const isEscaped = index => {
    let backslashes = 0;
    for (let i = index - 1; i >= 0 && markdown[i] === '\\'; i--) backslashes++;
    return backslashes % 2;
  };
  const opening = /!\[(?:\\.|[^\]\\\n])*\]\(/g;
  let match;
  while ((match = opening.exec(markdown))) {
    if (isEscaped(match.index) || isCode(match.index)) continue;
    let start = opening.lastIndex;
    while (/\s/.test(markdown[start] || '') && start < markdown.length) start++;
    const angled = markdown[start] === '<';
    if (angled) start++;
    let end = start;
    let depth = 0;
    for (; end < markdown.length; end++) {
      const character = markdown[end];
      if (character === '\\') { end++; continue; }
      if (angled && character === '>') break;
      if (angled) continue;
      if (character === '(') depth++;
      if (character === ')') { if (!depth) break; depth--; }
      if (!depth && /\s/.test(character)) break;
    }
    if (end > start && end < markdown.length) destinations.push({ start, end, value: markdown.slice(start, end) });
  }
  const referenceIds = new Set();
  const normalizeReference = id => id.trim().replace(/\s+/g, ' ').toLowerCase();
  const references = /!\[((?:\\.|[^\]\\\n])*)\](?:\[([^\]\n]*)\])?/g;
  while ((match = references.exec(markdown))) {
    if (markdown[references.lastIndex] === '(' || isEscaped(match.index) || isCode(match.index)) continue;
    referenceIds.add(normalizeReference(match[2] || match[1]));
  }
  const definitions = /^[ \t]{0,3}\[([^\]\n]+)\]:[ \t]*(?:<([^>\n]+)>|((?:\\.|[^\s])+))/gm;
  while ((match = definitions.exec(markdown))) {
    if (!referenceIds.has(normalizeReference(match[1])) || isCode(match.index)) continue;
    const value = match[2] || match[3];
    const colon = match[0].indexOf(']:') + 2;
    const start = match.index + colon + match[0].slice(colon).indexOf(value);
    destinations.push({ start, end: start + value.length, value });
  }
  return destinations.sort((a, b) => a.start - b.start);
}

async function migrateMarkdownImages(markdown, { previousPath, nextPath, attachmentDirectory, authorize = async value => value }) {
  if (previousPath && path.resolve(previousPath) === path.resolve(nextPath)) return markdown;
  const replacements = [];
  const copied = new Map();
  for (const destination of markdownImageDestinations(markdown)) {
    let raw = destination.value.replace(/\\([ !"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1');
    if (/^(?:https?:|data:|\/\/|#)/i.test(raw)) continue;
    let sourcePath;
    try {
      if (raw.startsWith('file:')) sourcePath = fileURLToPath(raw);
      else if (raw.startsWith('mojian-file:')) sourcePath = new URL(raw).searchParams.get('path');
      else {
        raw = decodeURIComponent(raw);
        if (path.isAbsolute(raw)) sourcePath = raw;
        else if (previousPath) sourcePath = path.resolve(path.dirname(previousPath), raw);
      }
      if (!sourcePath || !IMAGE_EXTENSIONS.has(path.extname(sourcePath).toLowerCase())) continue;
      // Untitled documents may only reference application-managed attachments.
      if (!previousPath && (!attachmentDirectory || !isWithin(path.resolve(attachmentDirectory), path.resolve(sourcePath)))) continue;
      sourcePath = await authorize(sourcePath);
      if (!copied.has(sourcePath)) {
        const stat = await fs.stat(sourcePath);
        if (!stat.isFile() || stat.size > 50 * 1024 * 1024) continue;
        const content = await fs.readFile(sourcePath);
        const extension = path.extname(sourcePath).toLowerCase();
        const stem = path.basename(sourcePath, path.extname(sourcePath)).replace(/[^\p{L}\p{N}_.-]/gu, '-').slice(0, 70) || 'image';
        const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
        const assetsDirectory = path.join(path.dirname(nextPath), 'assets');
        await fs.mkdir(assetsDirectory, { recursive: true });
        const authorizedAssets = await authorize(assetsDirectory);
        const copiedPath = path.join(authorizedAssets, `${stem}-${hash}${extension}`);
        try { await fs.writeFile(copiedPath, content, { flag: 'wx' }); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        copied.set(sourcePath, `assets/${path.basename(copiedPath)}`);
      }
      replacements.push({ ...destination, replacement: copied.get(sourcePath) });
    } catch (error) {
      // Preserve inaccessible and missing links verbatim instead of losing the document.
      if (!['ENOENT', 'EACCES', 'EPERM', 'EINVAL'].includes(error.code) && !error.message?.includes('请先通过')) throw error;
    }
  }
  for (const destination of replacements.reverse()) markdown = markdown.slice(0, destination.start) + destination.replacement + markdown.slice(destination.end);
  return markdown;
}

class VersionStore {
  constructor(directory) { this.directory = directory; }
  location(filePath) { return path.join(this.directory, crypto.createHash('sha256').update(path.resolve(filePath)).digest('hex')); }
  async list(filePath) { return readJSON(path.join(this.location(filePath), 'index.json'), []); }
  async add(filePath, content) {
    const directory = this.location(filePath);
    const versions = await this.list(filePath);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    if (versions[0]?.hash === hash) return;
    const id = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    await atomicWrite(path.join(directory, `${id}.md`), content);
    versions.unshift({ id, createdAt: Date.now(), size: Buffer.byteLength(content), hash });
    const removed = versions.splice(40);
    await atomicWrite(path.join(directory, 'index.json'), JSON.stringify(versions));
    await Promise.all(removed.map(version => fs.rm(path.join(directory, `${version.id}.md`), { force: true })));
  }
  async get(filePath, id) {
    const versions = await this.list(filePath);
    if (!versions.some(version => version.id === id)) throw new Error('这个历史版本不存在。');
    return fs.readFile(path.join(this.location(filePath), `${id}.md`), 'utf8');
  }
}

async function createMarkdownFile(directory, suppliedName) {
  let name = validateDocumentName(suppliedName);
  if (!path.extname(name)) name += '.md';
  if (!MARKDOWN_EXTENSIONS.has(path.extname(name).toLowerCase())) throw new Error('请使用 .md 或 .markdown 等文稿扩展名。');
  const filePath = path.join(directory, name);
  try { await fs.writeFile(filePath, '', { flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('同名文稿已经存在，请换一个名称。'); throw error; }
  return filePath;
}

module.exports = { atomicWrite, readJSON, listTree, isWithin, VersionStore, migrateMarkdownImages, markdownImageDestinations, createMarkdownFile, MARKDOWN_EXTENSIONS, IMAGE_EXTENSIONS };
