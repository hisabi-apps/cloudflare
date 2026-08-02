const test = require('node:test');
const assert = require('node:assert/strict');
const { createFirebaseAdminService } = require('../services/firebase_admin');

test('normalizeRecipientData filters invalid tokens and preserves uid', () => {
  const service = createFirebaseAdminService({ admin: {}, db: {}, serviceAccount: {} });
  const normalized = service.normalizeRecipientData({
    uid: 'user-1',
    language: 'EN',
    deviceTokens: ['token-1', '', 'token-2'],
  });

  assert.deepEqual(normalized, {
    uid: 'user-1',
    language: 'en',
    deviceTokens: ['token-1', 'token-2'],
  });
});

test('isAdminUserData recognizes role-based admin status', () => {
  const service = createFirebaseAdminService({ admin: {}, db: {}, serviceAccount: {} });
  assert.equal(service.isAdminUserData({ role: 'moderator' }, 'user@example.com'), true);
  assert.equal(service.isAdminUserData({ role: 'user' }, 'user@example.com'), false);
});
