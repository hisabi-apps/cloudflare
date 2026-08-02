const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTextContent, computeTextFingerprint, isTextLikeFile } = require('../content_fingerprint');

test('normalizes whitespace and case for text fingerprints', () => {
  const normalized = normalizeTextContent('  مرحبا   بالعالم\n\nمرحبا  ');
  assert.equal(normalized, 'مرحبا بالعالم مرحبا');
});

test('computes a stable fingerprint for normalized text', () => {
  const fingerprint = computeTextFingerprint('Hello World\nhello world');
  assert.equal(fingerprint, '79cc5fcbf139dbfe2155074558673e1ef0afebff9be34dd7ae9cf6b8cf176b1a');
});

test('detects text-like files by extension and mime type', () => {
  assert.equal(isTextLikeFile('notes.pdf', 'application/pdf'), true);
  assert.equal(isTextLikeFile('lesson.txt', 'text/plain'), true);
  assert.equal(isTextLikeFile('photo.png', 'image/png'), false);
});
