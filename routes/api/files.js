const express = require('express');
const admin = require('firebase-admin');
const {
  normalizeText,
  normalizeStatsFilterValue,
  normalizeStateValue,
  matchesFileFilters,
} = require('../../services/statsService');
const { sanitizeCommentText } = require('../../utils/validators');

module.exports = function createFilesRouter({ db, cache, admin }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const { subject, year, state, specialty, fileYear, fileYearFrom, fileYearTo, type, page = 1, limit = 10, cursor } = req.query;
      if (!subject) {
        return res.status(400).json({ error: 'Subject is required.' });
      }

      const pageNum = Math.max(parseInt(page, 10) || 1, 1);
      const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
      const cursorParts = cursor ? cursor.toString().split('|') : [];
      const cursorCreatedAt = cursorParts.length === 2
        ? admin.firestore.Timestamp.fromMillis(Number(cursorParts[0]))
        : null;
      const cursorDocId = cursorParts.length === 2 ? cursorParts[1] : null;
      const queryLimit = Math.min(limitNum * 3, 50);

      const normalizedType = ['exercise', 'exam'].includes((type || 'exercise').toString().trim().toLowerCase())
        ? (type || 'exercise').toString().trim().toLowerCase()
        : 'exercise';

      const normalizedSubject = normalizeText(subject);
      const cacheKey = `files_${normalizedType}_${normalizedSubject}_${year || 'all'}_${state || 'all'}_${specialty || 'all'}_${fileYear || 'all'}_${fileYearFrom || 'all'}_${fileYearTo || 'all'}_${limitNum}_${cursor || 'first'}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const fileYearFilter = fileYear != null && fileYear !== '' && !Number.isNaN(Number(fileYear))
        ? Number(fileYear)
        : null;
      const fileYearFromFilter = fileYearFrom != null && fileYearFrom !== '' && !Number.isNaN(Number(fileYearFrom))
        ? Number(fileYearFrom)
        : null;
      const fileYearToFilter = fileYearTo != null && fileYearTo !== '' && !Number.isNaN(Number(fileYearTo))
        ? Number(fileYearTo)
        : null;

      const yearFilter = year ? normalizeStatsFilterValue(year) : null;
      const stateFilter = state ? normalizeStateValue(state) : null;
      const specialtyFilter = specialty ? normalizeStatsFilterValue(specialty) : null;

      let query = db.collection('files')
        .where('subjectNormalized', '==', normalizedSubject)
        .where('isApproved', '==', true)
        .orderBy('createdAt', 'desc')
        .orderBy('__name__');

      if (cursorCreatedAt != null && cursorDocId) {
        query = query.startAfter(cursorCreatedAt, cursorDocId);
      }

      let snapshot = await query.limit(queryLimit).get();
      if (snapshot.empty) {
        let fallbackQuery = db.collection('files')
          .where('subject', '==', subject)
          .where('isApproved', '==', true)
          .orderBy('createdAt', 'desc')
          .orderBy('__name__');

        if (cursorCreatedAt != null && cursorDocId) {
          fallbackQuery = fallbackQuery.startAfter(cursorCreatedAt, cursorDocId);
        }

        snapshot = await fallbackQuery.limit(queryLimit).get();
        if (!snapshot.empty) {
          console.log(`📌 /api/files fallback to subject exact match for subject=${subject}`);
        }
      }

      const normalizedSpecialty = specialty ? normalizeText(specialty) : null;
      const files = [];
      snapshot.forEach((doc) => {
        const data = doc.data() || {};
        const docType = ((data.type || 'exercise').toString().trim().toLowerCase());

        if (normalizedType === 'exam' ? docType !== 'exam' : docType !== 'exercise' && docType !== '') {
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
        const specialtyValue = (data.specialty || '').toString();
        if (normalizedSpecialty && normalizeText(specialtyValue) !== normalizedSpecialty) {
          return;
        }
        files.push({ id: doc.id, ...data });
      });

      const pagedFiles = files.slice(0, limitNum);
      const nextCursor = files.length >= limitNum && snapshot.docs[snapshot.docs.length - 1]
        ? `${snapshot.docs[snapshot.docs.length - 1].data().createdAt.toMillis()}|${snapshot.docs[snapshot.docs.length - 1].id}`
        : null;

      const response = {
        items: pagedFiles,
        page: pageNum,
        limit: limitNum,
        hasMore: files.length === limitNum,
        cursor: nextCursor,
      };

      cache.set(cacheKey, response, 600);
      res.set('Cache-Control', 'private, max-age=600, stale-while-revalidate=60');
      res.json(response);
    } catch (error) {
      console.error('Error fetching files:', error);
      res.status(500).json({ error: 'Failed to fetch files.', details: error.message || String(error) });
    }
  });

  router.patch('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { title, subject, year, state, specialty, fileYear } = req.body;

      const docRef = db.collection('files').doc(id);
      const doc = await docRef.get();
      if (!doc.exists) {
        return res.status(404).json({ error: 'File not found.' });
      }

      const updateData = {};
      if (title !== undefined) updateData.title = title.trim();
      if (subject !== undefined) {
        const trimmedSubject = subject.trim();
        updateData.subject = trimmedSubject;
        updateData.subjectNormalized = normalizeText(trimmedSubject);
      }
      if (year !== undefined) updateData.year = year.trim();
      if (state !== undefined) updateData.state = state.trim();
      if (specialty !== undefined) {
        const trimmedSpecialty = specialty.trim();
        updateData.specialty = trimmedSpecialty;
        updateData.specialtyNormalized = normalizeText(trimmedSpecialty);
      }
      if (fileYear !== undefined) updateData.fileYear = fileYear.trim();

      await docRef.update(updateData);
      cache.flushAll();

      res.json({ success: true, id });
    } catch (error) {
      console.error('Update metadata failed:', error);
      res.status(500).json({ error: 'Failed to update metadata.' });
    }
  });

  router.post('/:id/like', async (req, res) => {
    try {
      if (!admin || !admin.auth || !admin.firestore) {
        return res.status(500).json({ error: 'Firebase Admin is not configured.' });
      }

      const authHeader = req.headers.authorization || '';
      if (!authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized request.' });
      }

      const idToken = authHeader.split(' ')[1];
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const currentUid = decodedToken?.uid;
      if (!currentUid) {
        return res.status(401).json({ error: 'Unauthorized request.' });
      }

      const { id } = req.params;
      const docRef = db.collection('files').doc(id);

      const result = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(docRef);
        if (!snapshot.exists) {
          throw new Error('FILE_NOT_FOUND');
        }

        const data = snapshot.data() || {};
        const likedBy = Array.isArray(data.likedBy) ? data.likedBy : [];
        const alreadyLiked = likedBy.includes(currentUid);
        const nextLiked = !alreadyLiked;

        transaction.update(docRef, {
          likes: admin.firestore.FieldValue.increment(nextLiked ? 1 : -1),
          likedBy: nextLiked
            ? admin.firestore.FieldValue.arrayUnion(currentUid)
            : admin.firestore.FieldValue.arrayRemove(currentUid),
        });

        const currentLikes = Number(data.likes) || 0;
        const finalLikes = Math.max(currentLikes + (nextLiked ? 1 : -1), 0);

        return {
          success: true,
          id,
          likes: finalLikes,
          liked: nextLiked,
          likedBy: currentUid,
        };
      });

      if (cache && typeof cache.flushAll === 'function') {
        cache.flushAll();
      }

      return res.json(result);
    } catch (error) {
      if (error && error.message === 'FILE_NOT_FOUND') {
        return res.status(404).json({ error: 'File not found.' });
      }

      console.error('Like update failed:', error);
      return res.status(500).json({ error: 'Failed to update like count.' });
    }
  });

  router.get('/:id/comments', async (req, res) => {
    try {
      const { id } = req.params;
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
      const docRef = db.collection('files').doc(id);
      const doc = await docRef.get();
      if (!doc.exists) {
        return res.status(404).json({ error: 'File not found.' });
      }

      const snapshot = await docRef
        .collection('comments')
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      const items = snapshot.docs.map((commentDoc) => {
        const data = commentDoc.data() || {};
        return {
          id: commentDoc.id,
          ...data,
          createdAt: data.createdAt && data.createdAt.toMillis
            ? data.createdAt.toMillis()
            : null,
        };
      });

      res.json({ items, count: items.length });
    } catch (error) {
      console.error('Fetch comments failed:', error);
      res.status(500).json({ error: 'Failed to fetch comments.' });
    }
  });

  router.post('/:id/comments', async (req, res) => {
    try {
      if (!admin || !admin.auth || !admin.firestore) {
        return res.status(500).json({ error: 'Firebase Admin is not configured.' });
      }

      const authHeader = req.headers.authorization || '';
      if (!authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized request.' });
      }

      const idToken = authHeader.split(' ')[1];
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const currentUid = decodedToken?.uid;
      if (!currentUid) {
        return res.status(401).json({ error: 'Unauthorized request.' });
      }

      const { id } = req.params;
      const { text } = req.body || {};
      const commentText = sanitizeCommentText(typeof text === 'string' ? text : '');
      if (!commentText) {
        return res.status(400).json({ error: 'Comment text is required and cannot contain external links.' });
      }

      const docRef = db.collection('files').doc(id);
      const fileDoc = await docRef.get();
      if (!fileDoc.exists) {
        return res.status(404).json({ error: 'File not found.' });
      }

      const commentsRef = docRef.collection('comments').doc();
      const commentData = {
        text: commentText,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdByUid: currentUid,
        createdByDisplayName: decodedToken.name || 'مستخدم',
        createdByPhotoUrl: decodedToken.picture || '',
      };

      await commentsRef.set(commentData);
      await docRef.set({ commentsCount: admin.firestore.FieldValue.increment(1) }, { merge: true });

      return res.json({ success: true, id: commentsRef.id, ...commentData });
    } catch (error) {
      console.error('Add comment failed:', error);
      return res.status(500).json({ error: 'Failed to add comment.' });
    }
  });

  router.delete('/:id/comments/:commentId', async (req, res) => {
    try {
      if (!admin || !admin.auth || !admin.firestore) {
        return res.status(500).json({ error: 'Firebase Admin is not configured.' });
      }

      const authHeader = req.headers.authorization || '';
      if (!authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized request.' });
      }

      const idToken = authHeader.split(' ')[1];
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const currentUid = decodedToken?.uid;
      if (!currentUid) {
        return res.status(401).json({ error: 'Unauthorized request.' });
      }

      const { id, commentId } = req.params;
      const docRef = db.collection('files').doc(id);
      const commentRef = docRef.collection('comments').doc(commentId);

      await db.runTransaction(async (transaction) => {
        const [fileSnapshot, commentSnapshot] = await Promise.all([
          transaction.get(docRef),
          transaction.get(commentRef),
        ]);

        if (!fileSnapshot.exists) {
          throw new Error('FILE_NOT_FOUND');
        }
        if (!commentSnapshot.exists) {
          throw new Error('COMMENT_NOT_FOUND');
        }

        const commentData = commentSnapshot.data() || {};
        if (commentData.createdByUid !== currentUid) {
          throw new Error('FORBIDDEN');
        }

        transaction.delete(commentRef);
        transaction.update(docRef, {
          commentsCount: admin.firestore.FieldValue.increment(-1),
        });
      });

      if (cache && typeof cache.flushAll === 'function') {
        cache.flushAll();
      }

      return res.json({ success: true, id: commentId });
    } catch (error) {
      if (error && error.message === 'FILE_NOT_FOUND') {
        return res.status(404).json({ error: 'File not found.' });
      }
      if (error && error.message === 'COMMENT_NOT_FOUND') {
        return res.status(404).json({ error: 'Comment not found.' });
      }
      if (error && error.message === 'FORBIDDEN') {
        return res.status(403).json({ error: 'You are not allowed to delete this comment.' });
      }

      console.error('Delete comment failed:', error);
      return res.status(500).json({ error: 'Failed to delete comment.' });
    }
  });

  return router;
};