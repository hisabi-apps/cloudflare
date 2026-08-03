const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveSubjectItemsForDisplay } = require('../services/statsService');

test('falls back to files-backed items when subject_stats returns no matching items', () => {
  const subjectStatsItems = [];
  const fallbackItems = [{ subject: 'Math', count: 2 }];

  const result = resolveSubjectItemsForDisplay({
    subjectStatsItems,
    fallbackItems,
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].subject, 'Math');
  assert.equal(result[0].count, 2);
});

test('filters out subjects with zero count and no files', () => {
  const result = resolveSubjectItemsForDisplay({
    subjectStatsItems: [{ subject: 'Empty', count: 0, specialties: [] }],
    fallbackItems: [{ subject: 'Math', count: 2, specialties: ['info'], files: [{ id: '1' }] }],
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].subject, 'Math');
  assert.equal(result[0].count, 2);
});
