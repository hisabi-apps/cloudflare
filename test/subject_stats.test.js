const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeText, normalizeStatsFilterValue, buildSubjectStatsDocId } = require('../services/subject_stats');

test('normalizeText trims and collapses whitespace', () => {
  assert.equal(normalizeText('  Math   101  '), 'math 101');
});

test('normalizeStatsFilterValue falls back to all', () => {
  assert.equal(normalizeStatsFilterValue('  '), 'all');
  assert.equal(normalizeStatsFilterValue('Algebra'), 'algebra');
});

test('buildSubjectStatsDocId produces stable composite ids', () => {
  const docId = buildSubjectStatsDocId({
    subject: 'Math',
    year: '2024',
    state: 'Alger',
    specialty: 'Science',
    fileYear: '2023',
  });

  assert.equal(docId, 'subject_math|year_2024|state_alger|specialty_science|fileYear_2023');
});
