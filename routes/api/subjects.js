const express = require('express');
const {
  normalizeText,
  normalizeStatsFilterValue,
  normalizeStateValue,
  getStatsForFilters,
  matchesFileFilters,
  mergeSubjectItemsBySubject,
  resolveSubjectItemsForDisplay,
} = require('../../services/statsService');

module.exports = function createSubjectsRouter({ db, cache }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const { year, state, specialty, fileYear, fileYearFrom, fileYearTo, type, page = 1, limit = 10 } = req.query;
      const pageNum = Math.max(parseInt(page, 10) || 1, 1);
      const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
      const normalizedType = ['exercise', 'exam'].includes((type || 'exercise').toString().trim().toLowerCase())
        ? (type || 'exercise').toString().trim().toLowerCase()
        : 'exercise';
      const queryKeyBase = `subject_stats_v2_${normalizedType}_${year || 'all'}_${state || 'all'}_${specialty || 'all'}_${fileYear || fileYearFrom || 'all'}_${fileYearTo || 'all'}`;
      const cacheKey = `${queryKeyBase}_${pageNum}_${limitNum}`;

      const cached = cache.get(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const yearFilter = year ? normalizeStatsFilterValue(year) : null;
      const stateFilter = state ? normalizeStateValue(state) : null;
      const specialtyFilter = specialty ? normalizeStatsFilterValue(specialty) : null;
      const fileYearFilter = fileYear != null && fileYear !== '' && !Number.isNaN(Number(fileYear))
        ? Number(fileYear)
        : null;
      const fileYearFromFilter = fileYearFrom != null && fileYearFrom !== '' && !Number.isNaN(Number(fileYearFrom))
        ? Number(fileYearFrom)
        : null;
      const fileYearToFilter = fileYearTo != null && fileYearTo !== '' && !Number.isNaN(Number(fileYearTo))
        ? Number(fileYearTo)
        : null;
      const hasActiveFilters = Boolean(yearFilter || stateFilter || specialtyFilter || fileYearFilter != null || fileYearFromFilter != null || fileYearToFilter != null);

      let items = [];
      let subjectsIndexItems = [];
      const subjectsIndexDoc = await db.collection('app_metadata').doc('subjects_index').get();
      if (subjectsIndexDoc.exists) {
        const subjectsIndex = subjectsIndexDoc.data()?.subjects || {};
        const indexedSubjects = subjectsIndex[normalizedType] || {};
        subjectsIndexItems = Object.entries(indexedSubjects)
          .map(([subjectName, data]) => ({
            subject: subjectName,
            count: typeof data.count === 'number' ? data.count : Number(data.count) || 0,
            specialties: Array.isArray(data.specialties) ? data.specialties : [],
          }))
          .sort((a, b) => Number(b.count || 0) - Number(a.count || 0));
      }

      const buildSubjectItemsFromFiles = async () => {
        console.log('🧠 /api/subjects falling back to files aggregation (limited sample)');
        try {
          const fallbackSnapshot = await db.collection('files')
            .where('isApproved', '==', true)
            .orderBy('createdAt', 'desc')
            .limit(100)
            .get();
          const subjectMap = new Map();

          fallbackSnapshot.forEach((doc) => {
            const data = doc.data() || {};
            const docType = ((data.type || 'exercise').toString().trim().toLowerCase());
            const subjectName = (data.subject || 'عام').toString().trim();
            if (!subjectName) return;

            const isRequestedType = normalizedType === 'exam'
              ? docType === 'exam'
              : (docType === 'exercise' || docType === '');

            if (!isRequestedType) {
              return;
            }

            if (!matchesFileFilters(data, {
              yearFilter,
              stateFilter,
              specialtyFilter,
              fileYearFilter,
              fileYearFromFilter,
              fileYearToFilter,
            })) {
              return;
            }

            const specialtyValue = normalizeText((data.specialty || '').toString());
            const key = subjectName;
            if (!subjectMap.has(key)) {
              subjectMap.set(key, { count: 0, specialties: new Set(), files: [] });
            }
            const entry = subjectMap.get(key);
            entry.count += 1;
            if (specialtyValue) {
              entry.specialties.add(specialtyValue);
            }
            if (entry.files.length < 50) {
              entry.files.push({ id: doc.id, ...data });
            }
          });

          return Array.from(subjectMap.entries()).map(([subjectName, info]) => ({
            subject: subjectName,
            count: info.count,
            specialties: Array.from(info.specialties).sort(),
            files: info.files,
          }));
        } catch (fallbackError) {
          console.warn('⚠️ Files-based subject fallback failed:', fallbackError?.message || fallbackError);
          return [];
        }
      };

      if (!hasActiveFilters && subjectsIndexItems.length > 0) {
        items = subjectsIndexItems;
      } else {
        let subjectStatsItems = [];
        try {
          const snapshot = await db.collection('subject_stats')
            .where('type', '==', normalizedType)
            .get();
          console.log(`📊 /api/subjects read ${snapshot.size} subject_stats docs for page=${pageNum} limit=${limitNum}`);

          const filters = {
            yearFilter: yearFilter || 'all',
            stateFilter: stateFilter || 'all',
            specialtyFilter: specialtyFilter || 'all',
            fileYearFilter: fileYearFilter != null ? String(fileYearFilter) : 'all',
            fileYearFromFilter,
            fileYearToFilter,
          };

          subjectStatsItems = snapshot.empty
            ? []
            : snapshot.docs
                .map((doc) => {
                  const data = doc.data() || {};
                  const stats = data.stats || {};
                  const { count, specialties } = getStatsForFilters(stats, filters);
                  if (count <= 0) {
                    return null;
                  }
                  return {
                    subject: data.subjectDisplay || data.subject || 'عام',
                    count,
                    specialties,
                  };
                })
                .filter(Boolean);
        } catch (statsError) {
          console.warn('⚠️ subject_stats lookup failed, using files fallback instead:', statsError?.message || statsError);
          subjectStatsItems = [];
        }

        const fallbackItems = await buildSubjectItemsFromFiles();
        const dedupedItems = mergeSubjectItemsBySubject([...subjectStatsItems, ...fallbackItems]);

        items = resolveSubjectItemsForDisplay({
          subjectStatsItems: dedupedItems,
          fallbackItems: dedupedItems,
        });
      }

      const offset = (pageNum - 1) * limitNum;
      const pagedItems = items.slice(offset, offset + limitNum);

      const response = {
        items: pagedItems,
        page: pageNum,
        limit: limitNum,
        hasMore: offset + pagedItems.length < items.length,
      };

      const maxCachedPages = 5;
      const cachedPagesKey = `cached_pages_${queryKeyBase}`;
      const existingPaginationPages = cache.get(cachedPagesKey);
      const activePages = Array.isArray(existingPaginationPages)
        ? existingPaginationPages.map((p) => parseInt(p, 10)).filter((p) => !Number.isNaN(p))
        : [];

      if (!activePages.includes(pageNum)) {
        activePages.push(pageNum);
      }

      while (activePages.length > maxCachedPages) {
        const pageToRemove = activePages.shift();
        if (pageToRemove !== undefined) {
          const expiredCacheKey = `${queryKeyBase}_${pageToRemove}_${limitNum}`;
          const expiredCursorKey = `subject_stats_cursor_${queryKeyBase}_${pageToRemove}_${limitNum}`;
          cache.del(expiredCacheKey);
          cache.del(expiredCursorKey);
        }
      }

      cache.set(cachedPagesKey, activePages);
      cache.set(cacheKey, response, 600);
      res.set('Cache-Control', 'private, max-age=600, stale-while-revalidate=60');
      res.json(response);
    } catch (error) {
      console.error('Error fetching subjects:', error);
      res.status(500).json({ error: 'Failed to fetch subjects.' });
    }
  });

  return router;
};