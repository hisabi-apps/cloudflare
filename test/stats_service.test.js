const test = require('node:test');
const assert = require('node:assert/strict');
const { createSubjectStatsService, normalizeStateValue, matchesFileFilters, buildSubjectStatsEntries, getStatsForFilters } = require('../services/statsService');

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

test('getStatsForFilters returns exact match and combined specialties', () => {
  const stats = {
    'year_2024|state_alger|specialty_علوم|fileYear_2023': { count: 2, specialties: ['علوم'] },
    'year_all|state_alger|specialty_علوم|fileYear_all': { count: 3, specialties: ['علوم'] },
    'year_2024|state_all|specialty_all|fileYear_all': { count: 5, specialties: [] },
    'year_all|state_all|specialty_all|fileYear_all': { count: 12, specialties: ['علوم', 'جغرافيا'] },
  };

  const filtersExact = {
    yearFilter: '2024',
    stateFilter: 'alger',
    specialtyFilter: 'علوم',
    fileYearFilter: '2023',
    fileYearFromFilter: null,
    fileYearToFilter: null,
  };

  const resultExact = getStatsForFilters(stats, filtersExact);
  assert.equal(resultExact.count, 2);
  assert.deepEqual(resultExact.specialties, ['علوم']);

  const filtersRange = {
    yearFilter: 'all',
    stateFilter: 'all',
    specialtyFilter: 'all',
    fileYearFilter: 'all',
    fileYearFromFilter: 2023,
    fileYearToFilter: 2024,
  };

  const resultRange = getStatsForFilters(stats, filtersRange);
  assert.equal(resultRange.count, 20);
  assert.deepEqual(resultRange.specialties, ['جغرافيا', 'علوم']);
});

test('updateSubjectStats writes subject_stats and subjects_index in the same batch', async () => {
  const mockSets = [];
  const db = {
    collection: (name) => ({
      doc: (id) => ({ path: `${name}/${id}` }),
    }),
    batch: () => ({
      set: (ref, payload, options) => mockSets.push({ ref, payload, options }),
      commit: async () => {},
    }),
  };

  const admin = {
    firestore: {
      FieldValue: {
        increment: (value) => ({ increment: value }),
        serverTimestamp: () => 'SERVER_TIMESTAMP',
        arrayUnion: (...values) => ({ arrayUnion: values }),
      },
    },
  };

  const service = createSubjectStatsService({ admin, db, cache: { flushAll() {} } });
  const fileRecord = {
    subject: 'Physics',
    type: 'exercise',
    specialty: 'General',
    year: '2024',
    state: 'الجزائر',
    fileYear: 2023,
  };

  await service.updateSubjectStats(fileRecord, 1);

  assert.ok(mockSets.length > 1, 'Expected multiple batch set operations');
  assert.ok(mockSets.some((op) => op.ref.path === 'app_metadata/subjects_index'), 'Expected subjects_index update');
  assert.ok(mockSets.some((op) => op.ref.path.startsWith('subject_stats/')), 'Expected subject_stats update');
});

test('updateSubjectStats can use sharded stats payload when enabled', async () => {
  const mockSets = [];
  const db = {
    collection: (name) => ({
      doc: (id) => ({ path: `${name}/${id}` }),
    }),
    batch: () => ({
      set: (ref, payload, options) => mockSets.push({ ref, payload, options }),
      commit: async () => {},
    }),
  };

  const admin = {
    firestore: {
      FieldValue: {
        increment: (value) => ({ increment: value }),
        delete: () => ({ delete: true }),
        serverTimestamp: () => 'SERVER_TIMESTAMP',
        arrayUnion: (...values) => ({ arrayUnion: values }),
      },
    },
  };

  const originalRandom = Math.random;
  Math.random = () => 0.4;

  const service = createSubjectStatsService({ admin, db, cache: { flushAll() {} }, useStatsShards: true, statsShardCount: 5 });
  const fileRecord = {
    subject: 'Biology',
    type: 'exercise',
    specialty: 'Genetics',
    year: '2024',
    state: 'الجزائر',
    fileYear: 2023,
  };

  await service.updateSubjectStats(fileRecord, 1);
  Math.random = originalRandom;

  const statsSet = mockSets.find((op) => op.ref.path.startsWith('subject_stats/'));
  assert.ok(statsSet, 'Expected a subject_stats set operation');
  const payload = statsSet.payload.stats;
  const entry = Object.values(payload)[0];
  assert.equal(typeof entry.shards, 'object');
  assert.equal(entry.shards.shard_2.count.increment, 1);
});

test('updateSubjectStatsTransaction updates both subject_stats and subjects_index', () => {
  const sets = [];
  const transaction = {
    set: (ref, payload, options) => sets.push({ ref, payload, options }),
  };

  const db = {
    collection: (name) => ({
      doc: (id) => ({ path: `${name}/${id}` }),
    }),
  };

  const admin = {
    firestore: {
      FieldValue: {
        increment: (value) => ({ increment: value }),
        serverTimestamp: () => 'SERVER_TIMESTAMP',
        arrayUnion: (...values) => ({ arrayUnion: values }),
      },
    },
  };

  const service = createSubjectStatsService({ admin, db, cache: { flushAll() {} } });
  const fileRecord = {
    subject: 'Chemistry',
    type: 'exam',
    specialty: 'Organic',
    year: '2024',
    state: 'الجزائر',
    fileYear: 2023,
  };

  service.updateSubjectStatsTransaction(fileRecord, 1, transaction);

  assert.ok(sets.length > 1, 'Expected multiple transaction set operations');
  assert.ok(sets.some((op) => op.ref.path === 'app_metadata/subjects_index'), 'Expected subjects_index update in transaction');
  assert.ok(sets.some((op) => op.ref.path.startsWith('subject_stats/')), 'Expected subject_stats update in transaction');
});
