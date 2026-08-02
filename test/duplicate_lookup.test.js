const test = require('node:test');
const assert = require('node:assert/strict');
const { findMatchingDuplicateInDocs } = require('../duplicate_lookup');

test('finds a duplicate that appears later in the document list', async () => {
  const docs = Array.from({ length: 25 }, (_, index) => ({
    id: `doc-${index}`,
    data: () => ({
      uploadedByUid: index === 20 ? 'user-1' : 'other-user',
      fileHash: index === 20 ? 'same-hash' : '',
    }),
  }));

  const match = await findMatchingDuplicateInDocs({
    docs,
    fileHash: 'same-hash',
    currentFileId: '',
    fileBuffer: Buffer.from('same-content'),
    fileName: 'sample.pdf',
    mimeType: 'application/pdf',
    getOrComputeFileHash: async (doc) => doc.data().fileHash || '',
  });

  assert.ok(match);
  assert.equal(match.id, 'doc-20');
});
