const crypto = require('crypto');

function normalizeTextContent(text) {
  return (text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractTextContent(input) {
  if (Buffer.isBuffer(input)) {
    return normalizeTextContent(input.toString('utf8'));
  }

  if (typeof input === 'string') {
    return normalizeTextContent(input);
  }

  return '';
}

function computeTextFingerprint(input) {
  return crypto.createHash('sha256').update(extractTextContent(input)).digest('hex');
}

function isTextLikeFile(fileName = '', mimeType = '') {
  const loweredName = (fileName || '').toLowerCase();
  const loweredMime = (mimeType || '').toLowerCase();
  const textExtensions = ['.txt', '.md', '.rtf', '.csv', '.json', '.xml', '.html', '.pdf'];
  const isTextMime = loweredMime.startsWith('text/') || loweredMime.includes('json') || loweredMime.includes('xml');
  const isTextExtension = textExtensions.some((ext) => loweredName.endsWith(ext));
  return isTextMime || isTextExtension;
}

module.exports = {
  normalizeTextContent,
  computeTextFingerprint,
  isTextLikeFile,
};
