const test = require('node:test');
const assert = require('node:assert/strict');
const { findDuplicateBySignatureStore } = require('../duplicate_signature_store');

test('returns a matching file from the signature store when the hash exists', async () => {
  const signatureDoc = {
    exists: true,
    data: () => ({ relatedFileIds: ['file-1', 'file-2'] }),
  };

  const docs = {
    'file-1': {
      exists: true,
      id: 'file-1',
      data: () => ({ uploadedByUid: 'user-a', title: 'First file' }),
    },
    'file-2': {
      exists: true,
      id: 'file-2',
      data: () => ({ uploadedByUid: 'user-b', title: 'Second file' }),
    },
  };

  const match = await findDuplicateBySignatureStore({
    fileHash: 'hash-123',
    currentFileId: '',
    getSignatureDoc: async () => signatureDoc,
    getFileDoc: async (id) => docs[id] || { exists: false },
  });

  assert.ok(match);
  assert.equal(match.id, 'file-1');
});

test('skips the current file id and returns null when no other matches exist', async () => {
  const signatureDoc = {
    exists: true,
    data: () => ({ relatedFileIds: ['file-1'] }),
  };

  const match = await findDuplicateBySignatureStore({
    fileHash: 'hash-456',
    currentFileId: 'file-1',
    getSignatureDoc: async () => signatureDoc,
    getFileDoc: async () => ({ exists: true, id: 'file-1', data: () => ({}) }),
  });

  assert.equal(match, null);
});
