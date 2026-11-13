export function basename(filePath = '') {
  return filePath.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() || filePath;
}

export function shortPath(filePath = '') {
  return filePath.replace(/\\/g, '/').split('/').slice(-2).join(' / ');
}

export function formatShortcut(text, platform) {
  if (platform === 'darwin') return text;
  return text.replace(/([⌘⇧⌥](?:\s*[⌘⇧⌥])*)\s*([A-Za-z0-9,;/])/g, (_match, modifiers, key) => [
    modifiers.includes('⌘') ? 'Ctrl' : '',
    modifiers.includes('⇧') ? 'Shift' : '',
    modifiers.includes('⌥') ? 'Alt' : '', key,
  ].filter(Boolean).join('+'));
}

export function localImageUrl(documentPath, src) {
  return `mojian-file://local/?documentPath=${encodeURIComponent(documentPath || '')}&src=${encodeURIComponent(src)}`;
}
