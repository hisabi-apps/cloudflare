const test = require('node:test');
const assert = require('node:assert/strict');
const { createSubjectStatsService, normalizeStateValue, matchesFileFilters, buildSubjectStatsEntries } = require('../services/statsService');

test('sanitizeSegment removes unsafe characters and normalizes spacing', () => {
  const service = createSubjectStatsService({ admin: {}, db: {}, cache: { flushAll() {} } });
  assert.equal(service.sanitizeSegment('  Math & Science  '), 'math-science');
});

test('buildObjectKey uses the configured upload prefix and sanitized segments', () => {
  const service = createSubjectStatsService({
    admin: {},
    db: {},
    cache: { flushAll() {} },
    uploadPrefix: 'exercices',
  });

  const objectKey = service.buildObjectKey('Math', 'Intro Quiz', 'My File.pdf');
  assert.match(objectKey, /^exercices\/math\/\d+-intro-quiz-my-file.pdf$/);
});

test('normalizeStateValue normalizes Arabic and Latin state names', () => {
  assert.equal(normalizeStateValue('الجزائر'), 'alger');
  assert.equal(normalizeStateValue('Setif'), 'setif');
});

test('matchesFileFilters respects the requested filters', () => {
  const data = {
    year: '2024',
    state: 'الجزائر',
    specialty: 'علوم',
    fileYear: 2023,
  };

  assert.equal(matchesFileFilters(data, {
    yearFilter: '2024',
    stateFilter: 'alger',
    specialtyFilter: 'علوم',
    fileYearFilter: null,
    fileYearFromFilter: null,
    fileYearToFilter: null,
  }), true);

  assert.equal(matchesFileFilters(data, {
    yearFilter: '2024',
    stateFilter: 'setif',
    specialtyFilter: 'علوم',
    fileYearFilter: null,
    fileYearFromFilter: null,
    fileYearToFilter: null,
  }), false);
});

test('buildSubjectStatsEntries creates one aggregation entry per filter combination', () => {
  const entries = buildSubjectStatsEntries({
    subject: 'رياضيات',
    year: '2024',
    state: 'الجزائر',
    specialty: 'علوم',
    fileYear: 2023,
  }, 1);

  assert.equal(entries.length, 16);
  assert.ok(entries.some((entry) => entry.docId.includes('year_2024') && entry.docId.includes('state_alger') && entry.docId.includes('specialty_علوم') && entry.docId.includes('fileYear_2023')));
  assert.ok(entries.some((entry) => entry.docId.includes('year_all') && entry.docId.includes('state_all') && entry.docId.includes('specialty_all') && entry.docId.includes('fileYear_all')));
});
