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

  assert.deepEqual(result, fallbackItems);
});
