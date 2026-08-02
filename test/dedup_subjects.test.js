const assert = require('assert');
const { resolveSubjectItemsForDisplay } = require('../services/statsService');

const statsItems = [
  { subject: 'Math', count: 2, specialties: ['info'] },
  { subject: 'Math', count: 2, specialties: ['info'] },
  { subject: 'Physics', count: 1, specialties: ['science'] },
];

const fallbackItems = [
  { subject: 'Math', count: 5, specialties: ['info', 'math'], files: [{ id: '1' }] },
  { subject: 'Chemistry', count: 3, specialties: ['lab'] },
];

const result = resolveSubjectItemsForDisplay({
  subjectStatsItems: statsItems,
  fallbackItems,
});

assert.strictEqual(result.length, 3, 'Should preserve all unique subjects after deduplication');
assert.deepStrictEqual(result.map((item) => item.subject), ['Math', 'Physics', 'Chemistry']);
console.log('dedup_subjects test passed');
