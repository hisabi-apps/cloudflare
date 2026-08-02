const {
  normalizeText,
  normalizeStatsFilterValue,
  normalizeStateValue,
} = require('../utils/normalize');

function buildSubjectStatsDocId({ subject, type, year, state, specialty, fileYear }) {
  const normalized = {
    subject: normalizeText(subject || 'عام'),
    type: ['exercise', 'exam'].includes((type || 'exercise').toString().trim().toLowerCase())
      ? (type || 'exercise').toString().trim().toLowerCase()
      : 'exercise',
    year: normalizeStatsFilterValue(year),
    state: normalizeStateValue(state),
    specialty: normalizeStatsFilterValue(specialty),
    fileYear: normalizeStatsFilterValue(fileYear),
  };

  return [
    `type_${normalized.type}`,
    `subject_${normalized.subject}`,
    `year_${normalized.year}`,
    `state_${normalized.state}`,
    `specialty_${normalized.specialty}`,
    `fileYear_${normalized.fileYear}`,
  ].join('|');
}

function buildSubjectStatsEntries(fileRecord, delta = 1) {
  const subject = fileRecord.subject || 'عام';
  const typeValue = ['exercise', 'exam'].includes((fileRecord.type || 'exercise').toString().trim().toLowerCase())
    ? (fileRecord.type || 'exercise').toString().trim().toLowerCase()
    : 'exercise';
  const yearValue = fileRecord.year || 'all';
  const stateValue = fileRecord.state || 'all';
  const specialtyValue = fileRecord.specialty || 'all';
  const fileYearRaw = fileRecord.fileYear;
  const fileYearValue = typeof fileYearRaw === 'number' || !Number.isNaN(Number(fileYearRaw))
    ? Number(fileYearRaw)
    : 'all';

  const subjectNormalized = normalizeText(subject);
  const yearNormalized = normalizeStatsFilterValue(yearValue);
  const stateNormalized = normalizeStateValue(stateValue);
  const specialtyNormalized = normalizeStatsFilterValue(specialtyValue);
  const countDelta = Number.isNaN(Number(delta)) ? 1 : Number(delta);

  const filterGroups = ['year', 'state', 'specialty', 'fileYear'];
  const filterValues = {
    year: yearNormalized,
    state: stateNormalized,
    specialty: specialtyNormalized,
    fileYear: fileYearValue,
  };

  const entries = [];
  const seenDocIds = new Set();

  for (let mask = 0; mask < (1 << filterGroups.length); mask += 1) {
    const combo = {
      subject: subjectNormalized,
      type: typeValue,
      year: 'all',
      state: 'all',
      specialty: 'all',
      fileYear: 'all',
    };

    filterGroups.forEach((group, index) => {
      if (mask & (1 << index)) {
        combo[group] = filterValues[group] ?? 'all';
      }
    });

    const docId = buildSubjectStatsDocId(combo);
    if (seenDocIds.has(docId)) {
      continue;
    }
    seenDocIds.add(docId);

    entries.push({
      docId,
      subject: subjectNormalized,
      subjectDisplay: subject,
      type: typeValue,
      year: combo.year,
      state: combo.state,
      specialty: combo.specialty,
      fileYear: combo.fileYear,
      specialties: specialtyNormalized !== 'all' && countDelta > 0 ? [specialtyNormalized] : [],
      delta: countDelta,
    });
  }

  return entries;
}

function matchesFileFilters(data, {
  yearFilter,
  stateFilter,
  specialtyFilter,
  fileYearFilter,
  fileYearFromFilter,
  fileYearToFilter,
}) {
  const normalizedYear = normalizeStatsFilterValue(data.year || 'all');
  const normalizedState = normalizeStateValue(data.state || '');
  const normalizedSpecialty = normalizeStatsFilterValue(data.specialty || 'all');
  const fileYearRaw = data.fileYear;
  const fileYearValue = typeof fileYearRaw === 'number' || !Number.isNaN(Number(fileYearRaw))
    ? Number(fileYearRaw)
    : null;

  const matchesYear = yearFilter && yearFilter !== 'all'
    ? normalizedYear === yearFilter
    : true;
  const matchesState = stateFilter && stateFilter !== 'all'
    ? normalizedState === stateFilter
    : true;
  const matchesSpecialty = specialtyFilter && specialtyFilter !== 'all'
    ? normalizedSpecialty === specialtyFilter
    : true;
  const matchesFileYearExact = fileYearFilter != null
    ? (fileYearValue == null ? false : fileYearValue === fileYearFilter)
    : true;
  const matchesFileYearFrom = fileYearFromFilter != null
    ? (fileYearValue == null ? true : fileYearValue >= fileYearFromFilter)
    : true;
  const matchesFileYearTo = fileYearToFilter != null
    ? (fileYearValue == null ? true : fileYearValue <= fileYearToFilter)
    : true;

  return matchesYear && matchesState && matchesSpecialty && matchesFileYearExact && matchesFileYearFrom && matchesFileYearTo;
}

function createSubjectStatsService({ admin, db, cache, uploadPrefix = 'exercices' }) {
  async function rebuildSubjectStatsFromApprovedFiles({ batchSize = 500, writeBatchSize = 400 } = {}) {
    let processedFiles = 0;
    let page = 0;
    let lastDocSnapshot = null;
    let writeCount = 0;
    let firestoreBatch = db.batch();

    while (true) {
      let query = db
        .collection('files')
        .where('isApproved', '==', true)
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(batchSize);

      if (lastDocSnapshot) {
        query = query.startAfter(lastDocSnapshot);
      }

      const approvedFilesSnapshot = await query.get();
      if (approvedFilesSnapshot.empty) {
        break;
      }

      page += 1;
      approvedFilesSnapshot.forEach((doc) => {
        const entries = buildSubjectStatsEntries(doc.data() || {}, 1);

        entries.forEach((entry) => {
          const statsRef = db.collection('subject_stats').doc(entry.docId);
          const updatePayload = {
            type: entry.type,
            subject: entry.subject,
            subjectDisplay: entry.subjectDisplay,
            year: entry.year,
            state: entry.state,
            specialty: entry.specialty,
            fileYear: entry.fileYear,
            count: admin.firestore.FieldValue.increment(entry.delta),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };

          if (entry.specialties.length > 0) {
            updatePayload.specialties = admin.firestore.FieldValue.arrayUnion(...entry.specialties);
          }

          firestoreBatch.set(statsRef, updatePayload, { merge: true });
          writeCount += 1;
        });

        processedFiles += 1;
      });

      if (writeCount >= writeBatchSize) {
        await firestoreBatch.commit();
        firestoreBatch = db.batch();
        writeCount = 0;
      }

      if (approvedFilesSnapshot.size < batchSize) {
        break;
      }

      lastDocSnapshot = approvedFilesSnapshot.docs[approvedFilesSnapshot.docs.length - 1];
    }

    if (writeCount > 0) {
      await firestoreBatch.commit();
    }

    if (typeof cache?.flushAll === 'function') {
      cache.flushAll();
    }

    return {
      processedFiles,
      pages: page,
    };
  }

  async function updateSubjectStats(fileRecord, delta = 1) {
    try {
      const entries = buildSubjectStatsEntries(fileRecord, delta);
      const batch = db.batch();

      entries.forEach((entry) => {
        const statsRef = db.collection('subject_stats').doc(entry.docId);
        const updatePayload = {
          subject: entry.subject,
          subjectDisplay: entry.subjectDisplay,
          year: entry.year,
          state: entry.state,
          specialty: entry.specialty,
          fileYear: entry.fileYear,
          count: admin.firestore.FieldValue.increment(entry.delta),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        if (entry.specialties.length > 0) {
          updatePayload.specialties = admin.firestore.FieldValue.arrayUnion(...entry.specialties);
        }

        batch.set(statsRef, updatePayload, { merge: true });
      });

      await batch.commit();
      if (typeof cache?.flushAll === 'function') {
        cache.flushAll();
      }
      console.log(`✅ Updated subject_stats for ${entries.length} combinations for subject=${fileRecord.subject || 'عام'} delta=${delta}`);
    } catch (statsError) {
      console.error('⚠️ Failed to update subject_stats:', statsError.message || statsError);
    }
  }

  async function updateSubjectStatsTransaction(fileRecord, delta, transaction) {
    const entries = buildSubjectStatsEntries(fileRecord, delta);

    entries.forEach((entry) => {
      const statsRef = db.collection('subject_stats').doc(entry.docId);
      const updatePayload = {
        type: entry.type,
        subject: entry.subject,
        subjectDisplay: entry.subjectDisplay,
        year: entry.year,
        state: entry.state,
        specialty: entry.specialty,
        fileYear: entry.fileYear,
        count: admin.firestore.FieldValue.increment(entry.delta),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (entry.specialties.length > 0) {
        updatePayload.specialties = admin.firestore.FieldValue.arrayUnion(...entry.specialties);
      }

      transaction.set(statsRef, updatePayload, { merge: true });
    });
  }

  function sanitizeSegment(value) {
    return value
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/(^-|-$)/g, '') || 'file';
  }

  function buildObjectKey(subject, title, originalName) {
    const timestamp = Date.now();
    const safeSubject = sanitizeSegment(subject || 'عام');
    const safeTitle = sanitizeSegment(title || 'file');
    const safeName = sanitizeSegment(originalName || 'upload');
    return `${uploadPrefix}/${safeSubject}/${timestamp}-${safeTitle}-${safeName}`;
  }

  function buildPublicUrl(req, objectKey) {
    const cleanedKey = objectKey.replace(/^\/+/, '');
    const protocol = req.get('x-forwarded-proto') || req.protocol;
    const host = req.get('x-forwarded-host') || req.get('host');
    const encodedKey = cleanedKey.split('/').map(encodeURIComponent).join('/');
    return `${protocol}://${host}/files/${encodedKey}`;
  }

  return {
    rebuildSubjectStatsFromApprovedFiles,
    updateSubjectStats,
    updateSubjectStatsTransaction,
    sanitizeSegment,
    buildObjectKey,
    buildPublicUrl,
  };
}

module.exports = {
  createSubjectStatsService,
  normalizeText,
  normalizeStatsFilterValue,
  normalizeStateValue,
  matchesFileFilters,
  buildSubjectStatsDocId,
  buildSubjectStatsEntries,
};
