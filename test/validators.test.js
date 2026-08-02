const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDeviceTokens, createDeviceTokenService } = require('../utils/validators');

test('normalizeDeviceTokens deduplicates and collects fallback tokens', () => {
  const userData = {
    deviceTokens: ['token-1', 'token-2', 'token-1'],
    fcmToken: 'token-3',
    messagingToken: 'token-4',
  };

  const tokens = normalizeDeviceTokens(userData);
  assert.deepEqual(tokens, ['token-1', 'token-2', 'token-3', 'token-4']);
});

test('createDeviceTokenService exposes removeInvalidDeviceToken', async () => {
  const removed = [];
  const db = {
    collection() {
      return {
        doc() {
          return {
            async update(payload) {
              removed.push(payload);
            },
          };
        },
      };
    },
  };
  const admin = {
    firestore: {
      FieldValue: {
        arrayRemove(token) {
          return { op: 'remove', token };
        },
      },
    },
  };

  const service = createDeviceTokenService({ admin, db });
  await service.removeInvalidDeviceToken('user-1', 'token-x');
  assert.deepEqual(removed, [{ deviceTokens: { op: 'remove', token: 'token-x' } }]);
});
