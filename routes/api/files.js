const express = require('express');
const admin = require('firebase-admin');
const {
  normalizeText,
  normalizeStatsFilterValue,
  normalizeStateValue,
  matchesFileFilters,
} = require('../../services/statsService');

module.exports = function createFilesRouter({ db, cache, admin }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const { subject, year, state, specialty, fileYear, fileYearFrom, fileYearTo, type, page = 1, limit = 10 } = req.query;
      if (!subject) {
        return res.status(400).json({ error: 'Subject is required.' });
      }

      const pageNum = Math.max(parseInt(page, 10) || 1, 1);
      const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
      const offset = (pageNum - 1) * limitNum;

      const normalizedType = ['exercise', 'exam'].includes((type || 'exercise').toString().trim().toLowerCase())
        ? (type || 'exercise').toString().trim().toLowerCase()
        : 'exercise';

      const fileYearFilter = fileYear != null && fileYear !== '' && !Number.isNaN(Number(fileYear))
        ? Number(fileYear)
        : null;
      const fileYearFromFilter = fileYearFrom != null && fileYearFrom !== '' && !Number.isNaN(Number(fileYearFrom))
        ? Number(fileYearFrom)
        : null;
      const fileYearToFilter = fileYearTo != null && fileYearTo !== '' && !Number.isNaN(Number(fileYearTo))
        ? Number(fileYearTo)
        : null;

      const normalizedSubject = normalizeText(subject);
      const yearFilter = year ? normalizeStatsFilterValue(year) : null;
      const stateFilter = state ? normalizeStateValue(state) : null;
      const specialtyFilter = specialty ? normalizeStatsFilterValue(specialty) : null;

      let query = db.collection('files')
        .where('subjectNormalized', '==', normalizedSubject)
        .where('isApproved', '==', true)
        .orderBy('createdAt', 'desc')
        .orderBy('__name__');

      let snapshot = await query.limit(200).get();
      if (snapshot.empty) {
        let fallbackQuery = db.collection('files')
          .where('subject', '==', subject)
          .where('isApproved', '==', true)
          .orderBy('createdAt', 'desc')
          .orderBy('__name__')
          .limit(200);
        snapshot = await fallbackQuery.get();
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

      const pagedFiles = files.slice(offset, offset + limitNum);

      res.json({
        items: pagedFiles,
        page: pageNum,
        limit: limitNum,
        hasMore: offset + pagedFiles.length < files.length,
      });
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
      const doc = await docRef.get();
      if (!doc.exists) {
        return res.status(404).json({ error: 'File not found.' });
      }

      await docRef.update({
        likes: admin.firestore.FieldValue.increment(1),
      });
      if (cache && typeof cache.flushAll === 'function') {
        cache.flushAll();
      }

      const updatedDoc = await docRef.get();
      const updatedLikes = updatedDoc.data()?.likes ?? 0;

      return res.json({ success: true, id, likes: updatedLikes, likedBy: currentUid });
    } catch (error) {
      console.error('Like update failed:', error);
      return res.status(500).json({ error: 'Failed to update like count.' });
    }
  });

  return router;
};