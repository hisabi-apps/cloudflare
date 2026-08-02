const assert = require('assert');
const { resolveSubjectItemsForDisplay } = require('../services/statsService');

const statsOnly = [{ subject: 'Math', count: 0, specialties: [] }];
const fallbackItems = [{ subject: 'Math', count: 2, specialties: ['info'], files: [{ id: '1' }] }];

const result = resolveSubjectItemsForDisplay({
  subjectStatsItems: statsOnly,
  fallbackItems,
});

assert.deepStrictEqual(result, fallbackItems, 'Should prefer fallback items when stats are empty');
console.log('resolveSubjectItemsForDisplay test passed');
