const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldBlockDuplicateUpload } = require('../duplicate_policy');

test('blocks exact duplicates from the same uploader', () => {
  assert.equal(
    shouldBlockDuplicateUpload({
      existingUploadedByUid: 'user-1',
      currentUploadedByUid: 'user-1',
    }),
    true,
  );
});

test('allows exact duplicates from different uploaders', () => {
  assert.equal(
    shouldBlockDuplicateUpload({
      existingUploadedByUid: 'user-1',
      currentUploadedByUid: 'user-2',
    }),
    false,
  );
});

test('allows uploads when uploader information is missing', () => {
  assert.equal(
    shouldBlockDuplicateUpload({
      existingUploadedByUid: '',
      currentUploadedByUid: '',
    }),
    false,
  );
});
