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

test('GET /api/subjects uses subject_stats when active filters are provided', async () => {
  const createSubjectsRouter = require('../routes/api/subjects');
  const subjectStatsDocs = [
    {
      data: () => ({
        subjectDisplay: 'Physics',
        stats: {
          'year_2024|state_all|specialty_all|fileYear_all': {
            count: 5,
            specialties: ['General'],
          },
        },
      }),
    },
  ];

  const db = {
    collection: (name) => {
      if (name === 'app_metadata') {
        return {
          doc: () => ({
            get: async () => ({ exists: false }),
          }),
        };
      }

      if (name === 'subject_stats') {
        return {
          where: () => ({
            get: async () => ({
              empty: false,
              docs: subjectStatsDocs,
            }),
          }),
        };
      }

      return {
        where: () => ({
          get: async () => ({ empty: true, docs: [] }),
        }),
      };
    },
  };

  const cache = {
    store: new Map(),
    get(key) {
      return this.store.get(key);
    },
    set(key, value) {
      this.store.set(key, value);
    },
    del(key) {
      this.store.delete(key);
    },
  };

  const router = createSubjectsRouter({ db, cache });
  let responseBody;
  let resolveResponse;
  const responsePromise = new Promise((resolve) => { resolveResponse = resolve; });

  const req = {
    method: 'GET',
    url: '/',
    path: '/',
    originalUrl: '/',
    query: {
      year: '2024',
      type: 'exercise',
      page: '1',
      limit: '10',
    },
  };

  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    set() {},
    json(body) {
      responseBody = body;
      resolveResponse();
    },
  };

  router.handle(req, res, (err) => {
    if (err) throw err;
  });

  await responsePromise;

  assert.equal(responseBody.items.length, 1);
  assert.equal(responseBody.items[0].subject, 'Physics');
  assert.equal(responseBody.items[0].count, 5);
});
