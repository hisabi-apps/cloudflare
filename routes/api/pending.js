const express = require('express');

module.exports = function createPendingRouter({ db, cache }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const pageNum = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
      const limitNum = Math.min(Math.max(parseInt(req.query.limit || '20', 10) || 20, 1), 50);
      const requestedType = (req.query.type || '').toString().trim().toLowerCase();
      const normalizedType = ['exercise', 'exam'].includes(requestedType) ? requestedType : null;
      const cacheKey = `pending_page_${pageNum}_${limitNum}_${normalizedType || 'all'}`;
      const cursorCacheKey = `pending_cursor_page_${pageNum}_${limitNum}_${normalizedType || 'all'}`;
      const prevCursorCacheKey = pageNum > 1 ? `pending_cursor_page_${pageNum - 1}_${limitNum}_${normalizedType || 'all'}` : null;
      const cached = cache.get(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      let query = db.collection('files')
        .where('reviewStatus', '==', 'pending')
        .orderBy('createdAt', 'desc')
        .orderBy('__name__');

      if (normalizedType) {
        query = db.collection('files')
          .where('reviewStatus', '==', 'pending')
          .orderBy('createdAt', 'desc')
          .orderBy('__name__');
      }

      if (pageNum > 1 && prevCursorCacheKey) {
        const previousPageCursor = cache.get(prevCursorCacheKey);
        if (previousPageCursor) {
          query = query.startAfterDocument(previousPageCursor);
        } else {
          query = query.offset((pageNum - 1) * limitNum);
        }
      }

      const snapshot = await query.limit(limitNum).get();
      console.log(`📌 /api/pending read ${snapshot.size} pending docs for page=${pageNum} limit=${limitNum}`);

      const allFiles = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      const files = normalizedType
        ? allFiles.filter((file) => {
            const fileType = (file?.type || '').toString().trim().toLowerCase();
            if (!fileType) {
              return true;
            }
            return fileType === normalizedType;
          })
        : allFiles;

      if (normalizedType) {
        console.log(`[pending] type=${normalizedType} returned=${files.length} files; sampleTypes=${files.slice(0, 5).map((file) => file.type || 'missing').join(', ')}`);
      } else {
        console.log(`[pending] all-types returned=${files.length} files; sampleTypes=${files.slice(0, 5).map((file) => file.type || 'missing').join(', ')}`);
      }
      if (snapshot.docs.length > 0) {
        cache.set(cursorCacheKey, snapshot.docs[snapshot.docs.length - 1]);
      }

      const maxCachedPages = 5;
      const cachedPagesKey = 'pending_cached_pages';
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
          const expiredCacheKey = `pending_page_${pageToRemove}_${limitNum}`;
          const expiredCursorKey = `pending_cursor_page_${pageToRemove}_${limitNum}`;
          cache.del(expiredCacheKey);
          cache.del(expiredCursorKey);
        }
      }

      cache.set(cachedPagesKey, activePages);

      const response = {
        files,
        page: pageNum,
        limit: limitNum,
        hasMore: snapshot.size === limitNum,
        debugType: normalizedType || 'all',
      };

      cache.set(cacheKey, response);
      res.json(response);
    } catch (error) {
      console.error('Error fetching pending files:', error);
      res.status(500).json({ error: 'Failed to fetch pending files.', details: error.message });
    }
  });

  return router;
};