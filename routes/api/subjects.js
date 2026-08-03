const express = require('express');
const {
  normalizeText,
  normalizeStatsFilterValue,
  normalizeStateValue,
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

      const quotaFallbackResponse = {
        items: [],
        page: pageNum,
        limit: limitNum,
        hasMore: false,
      };

      const yearFilter = year ? normalizeStatsFilterValue(year) : null;
      const stateFilter = state ? normalizeStateValue(state) : null;
      const specialtyFilter = specialty ? normalizeStatsFilterValue(specialty) : null;
      const isQuotaExhaustedError = (error) => {
        const message = String(error?.message || error || '').toLowerCase();
        return message.includes('resource_exhausted') || message.includes('quota exceeded') || message.includes('quota');
      };
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

      const buildSubjectItemsFromFiles = async () => {
        try {
          if (cache.get(`quota_block_${queryKeyBase}`)) {
            return [];
          }
          const subjectMap = new Map();
          let lastDoc = null;
          let iterations = 0;
          const maxIterations = 4;

          while (iterations < maxIterations) {
            iterations += 1;
            let query = db.collection('files')
              .where('isApproved', '==', true)
              .orderBy('__name__')
              .limit(80);

            if (lastDoc) {
              query = query.startAfter(lastDoc);
            }

            const fallbackSnapshot = await query.get();
            if (fallbackSnapshot.empty) {
              break;
            }

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
              if (entry.files.length < 20) {
                entry.files.push({ id: doc.id, ...data });
              }
            });

            if (fallbackSnapshot.size < 80) {
              break;
            }
            lastDoc = fallbackSnapshot.docs[fallbackSnapshot.docs.length - 1];
          }

          return Array.from(subjectMap.entries()).map(([subjectName, info]) => ({
            subject: subjectName,
            count: info.count,
            specialties: Array.from(info.specialties).sort(),
            files: info.files.slice(0, 20),
          }));
        } catch (fallbackError) {
          if (isQuotaExhaustedError(fallbackError)) {
            cache.set(`quota_block_${queryKeyBase}`, true, 60);
          } else {
            console.warn('⚠️ Files-based subject fallback failed:', fallbackError?.message || fallbackError);
          }
          return [];
        }
      };

      if (hasActiveFilters) {
        items = await buildSubjectItemsFromFiles();
      } else {
        let subjectStatsItems = [];
        try {
          let query = db.collection('subject_stats').limit(40);
          if (yearFilter) query = query.where('year', '==', yearFilter);
          if (stateFilter) query = query.where('state', '==', stateFilter);
          if (specialtyFilter) query = query.where('specialty', '==', specialtyFilter);
          if (fileYearFilter != null) query = query.where('fileYear', '==', fileYearFilter);
          if (fileYearFromFilter != null) query = query.where('fileYear', '>=', fileYearFromFilter);
          if (fileYearToFilter != null) query = query.where('fileYear', '<=', fileYearToFilter);

          const snapshot = await query.get();
          console.log(`📊 /api/subjects read ${snapshot.size} subject_stats docs for page=${pageNum} limit=${limitNum}`);

          subjectStatsItems = snapshot.empty
            ? []
            : snapshot.docs
                .map((doc) => {
                  const data = doc.data() || {};
                  const docType = ((data.type || 'exercise').toString().trim().toLowerCase());
                  if (normalizedType === 'exam' ? docType !== 'exam' : docType !== 'exercise' && docType !== '') {
                    return null;
                  }
                  return {
                    subject: data.subjectDisplay || data.subject || 'عام',
                    count: typeof data.count === 'number' ? data.count : Number(data.count) || 0,
                    specialties: Array.isArray(data.specialties) ? data.specialties : [],
                  };
                })
                .filter(Boolean);
        } catch (statsError) {
          if (isQuotaExhaustedError(statsError)) {
            cache.set(`quota_block_${queryKeyBase}`, true, 60);
            subjectStatsItems = [];
          } else {
            console.warn('⚠️ subject_stats lookup failed, using files fallback instead:', statsError?.message || statsError);
            subjectStatsItems = [];
          }
        }

        if (cache.get(`quota_block_${queryKeyBase}`)) {
          cache.set(cacheKey, quotaFallbackResponse);
          return res.json(quotaFallbackResponse);
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
      cache.set(cacheKey, response);
      res.json(response);
    } catch (error) {
      console.error('Error fetching subjects:', error);
      res.status(500).json({ error: 'Failed to fetch subjects.' });
    }
  });

  return router;
};