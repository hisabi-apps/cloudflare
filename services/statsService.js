const {
  normalizeText,
  normalizeStatsFilterValue,
  normalizeStateValue,
} = require('../utils/normalize');

module.exports = {
  buildSubjectStatsDocId,
  buildSubjectStatsEntries,
  matchesFileFilters,
  getStatsForFilters,
  mergeSubjectItemsBySubject,
  resolveSubjectItemsForDisplay,
  createSubjectStatsService,
};

function buildSubjectStatsDocId({ subject, type, year, state, specialty, fileYear }) {
  const normalized = {
    subject: sanitizeDocIdSegment(subject || 'عام'),
    type: ['exercise', 'exam'].includes((type || 'exercise').toString().trim().toLowerCase())
      ? (type || 'exercise').toString().trim().toLowerCase()
      : 'exercise',
    year: sanitizeDocIdSegment(normalizeStatsFilterValue(year)),
    state: sanitizeDocIdSegment(normalizeStateValue(state)),
    specialty: sanitizeDocIdSegment(normalizeStatsFilterValue(specialty)),
    fileYear: sanitizeDocIdSegment(normalizeStatsFilterValue(fileYear)),
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

function buildSubjectStatsSubjectDocId({ subject, type }) {
  const normalizedSubject = sanitizeDocIdSegment(subject || 'عام');
  const normalizedType = ['exercise', 'exam'].includes((type || 'exercise').toString().trim().toLowerCase())
    ? (type || 'exercise').toString().trim().toLowerCase()
    : 'exercise';

  return [`type_${normalizedType}`, `subject_${normalizedSubject}`].join('|');
}

function buildSubjectStatsComboKey({ year, state, specialty, fileYear }) {
  const normalizedYear = normalizeStatsFilterValue(year);
  const normalizedState = normalizeStateValue(state);
  const normalizedSpecialty = normalizeStatsFilterValue(specialty);
  const normalizedFileYear = typeof fileYear === 'number' || !Number.isNaN(Number(fileYear))
    ? Number(fileYear)
    : normalizeStatsFilterValue(fileYear);

  return [
    `year_${normalizedYear}`,
    `state_${normalizedState}`,
    `specialty_${normalizedSpecialty}`,
    `fileYear_${normalizedFileYear}`,
  ].join('|');
}

function parseSubjectStatsComboKey(key) {
  const parts = key.split('|');
  return {
    year: parts[0]?.replace(/^year_/, '') || 'all',
    state: parts[1]?.replace(/^state_/, '') || 'all',
    specialty: parts[2]?.replace(/^specialty_/, '') || 'all',
    fileYear: parts[3]?.replace(/^fileYear_/, '') || 'all',
  };
}

function sanitizeDocIdSegment(value) {
  return normalizeText(value)
    .replace(/[\/\\]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function isComboKeyMatch(combo, {
  yearFilter,
  stateFilter,
  specialtyFilter,
  fileYearFilter,
  fileYearFromFilter,
  fileYearToFilter,
}) {
  const matchesYear = yearFilter && yearFilter !== 'all'
    ? combo.year === yearFilter
    : true;
  const matchesState = stateFilter && stateFilter !== 'all'
    ? combo.state === stateFilter
    : true;
  const matchesSpecialty = specialtyFilter && specialtyFilter !== 'all'
    ? combo.specialty === specialtyFilter
    : true;

  let matchesFileYear = true;
  if (fileYearFilter != null) {
    matchesFileYear = combo.fileYear === String(fileYearFilter) || combo.fileYear === 'all';
  }
  if (fileYearFromFilter != null) {
    if (combo.fileYear === 'all') {
      matchesFileYear = matchesFileYear && true;
    } else {
      const numeric = Number(combo.fileYear);
      matchesFileYear = matchesFileYear && !Number.isNaN(numeric) && numeric >= fileYearFromFilter;
    }
  }
  if (fileYearToFilter != null) {
    if (combo.fileYear === 'all') {
      matchesFileYear = matchesFileYear && true;
    } else {
      const numeric = Number(combo.fileYear);
      matchesFileYear = matchesFileYear && !Number.isNaN(numeric) && numeric <= fileYearToFilter;
    }
  }

  return matchesYear && matchesState && matchesSpecialty && matchesFileYear;
}

function getCountFromStatsEntry(entry) {
  if (entry == null || typeof entry !== 'object') {
    return 0;
  }

  if (entry.count != null && !Number.isNaN(Number(entry.count))) {
    return Number(entry.count);
  }

  if (entry.shards && typeof entry.shards === 'object') {
    return Object.values(entry.shards).reduce((sum, shard) => sum + (Number(shard?.count) || 0), 0);
  }

  return 0;
}

function getStatsForFilters(stats = {}, filters) {
  const matchingEntries = [];

  if (filters.fileYearFromFilter == null && filters.fileYearToFilter == null) {
    const exactKey = buildSubjectStatsComboKey({
      year: filters.yearFilter || 'all',
      state: filters.stateFilter || 'all',
      specialty: filters.specialtyFilter || 'all',
      fileYear: filters.fileYearFilter != null ? filters.fileYearFilter : 'all',
    });

    const exactMatch = stats[exactKey];
    if (exactMatch) {
      matchingEntries.push(exactMatch);
    }
  } else {
    for (const [key, value] of Object.entries(stats)) {
      const combo = parseSubjectStatsComboKey(key);
      if (isComboKeyMatch(combo, filters)) {
        matchingEntries.push(value);
      }
    }
  }

  const count = matchingEntries.reduce((sum, entry) => sum + getCountFromStatsEntry(entry), 0);
  const specialtiesSet = new Set();
  matchingEntries.forEach((entry) => {
    if (Array.isArray(entry.specialties)) {
      entry.specialties.forEach((specialty) => specialtiesSet.add(specialty));
    }
  });

  return {
    count,
    specialties: Array.from(specialtiesSet).sort(),
  };
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

function mergeSubjectItemsBySubject(items) {
  const merged = [];
  const lookup = new Map();

  for (const item of Array.isArray(items) ? items : []) {
    const subjectName = (item?.subject || '').toString().trim();
    if (!subjectName) continue;

    const key = subjectName.toLowerCase();
    if (!lookup.has(key)) {
      lookup.set(key, merged.length);
      merged.push({
        subject: subjectName,
        count: 0,
        specialties: [],
        files: [],
      });
    }

    const entry = merged[lookup.get(key)];
    const countValue = Number(item?.count ?? 0);
    if (countValue > Number(entry.count ?? 0)) {
      entry.count = countValue;
    }

    const mergedSpecialties = new Set([...(entry.specialties || []), ...(item?.specialties || [])]);
    entry.specialties = Array.from(mergedSpecialties).sort();

    const itemFiles = Array.isArray(item?.files) ? item.files : [];
    if (itemFiles.length > 0) {
      const existingFiles = Array.isArray(entry.files) ? entry.files : [];
      const seenFileIds = new Set(existingFiles.map((file) => (file?.id ?? '').toString()).filter(Boolean));
      for (const file of itemFiles) {
        const fileId = (file?.id ?? '').toString();
        if (fileId && seenFileIds.has(fileId)) {
          continue;
        }
        if (fileId) {
          seenFileIds.add(fileId);
        }
        existingFiles.push(file);
      }
      entry.files = existingFiles;
    }
  }

  return merged;
}

function resolveSubjectItemsForDisplay({ subjectStatsItems, fallbackItems }) {
  const usableStatsItems = Array.isArray(subjectStatsItems)
    ? subjectStatsItems.filter((item) => {
        const countValue = Number(item?.count ?? 0);
        const files = Array.isArray(item?.files) ? item.files : [];
        return countValue > 0 || files.length > 0;
      })
    : [];

  const fallbackCandidates = Array.isArray(fallbackItems) ? fallbackItems : [];
  if (usableStatsItems.length > 0) {
    return mergeSubjectItemsBySubject([...usableStatsItems, ...fallbackCandidates]);
  }

  return mergeSubjectItemsBySubject(fallbackCandidates);
}

function createSubjectStatsService({ admin, db, cache, uploadPrefix = 'exercices', useStatsShards = false, statsShardCount = 10 } = {}) {
  async function rebuildSubjectStatsFromApprovedFiles({ batchSize = 500, writeBatchSize = 400, deleteOldDocs = false } = {}) {
    const subjectDocs = new Map();
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
        const fileData = doc.data() || {};
        const entries = buildSubjectStatsEntries(fileData, 1);
        if (entries.length === 0) {
          return;
        }

        const subjectDocId = buildSubjectStatsSubjectDocId(entries[0]);
        const subjectDoc = subjectDocs.get(subjectDocId) || {
          type: entries[0].type,
          subject: entries[0].subject,
          subjectDisplay: entries[0].subjectDisplay,
          stats: new Map(),
        };

        entries.forEach((entry) => {
          const comboKey = buildSubjectStatsComboKey(entry);
          const current = subjectDoc.stats.get(comboKey) || {
            count: 0,
            specialties: new Set(),
          };

          current.count += entry.delta;
          entry.specialties.forEach((specialty) => current.specialties.add(specialty));
          subjectDoc.stats.set(comboKey, current);
        });

        subjectDocs.set(subjectDocId, subjectDoc);
        processedFiles += 1;
      });

      if (approvedFilesSnapshot.size < batchSize) {
        break;
      }

      lastDocSnapshot = approvedFilesSnapshot.docs[approvedFilesSnapshot.docs.length - 1];
    }

    for (const [docId, subjectDoc] of subjectDocs.entries()) {
      const statsPayload = {};
      subjectDoc.stats.forEach((entry, key) => {
        statsPayload[key] = buildInitialStatsPayloadFromAggregate(entry, key);
      });

      const statsRef = db.collection('subject_stats').doc(docId);
      firestoreBatch.set(statsRef, {
        type: subjectDoc.type,
        subject: subjectDoc.subject,
        subjectDisplay: subjectDoc.subjectDisplay,
        stats: statsPayload,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      writeCount += 1;
      if (writeCount >= writeBatchSize) {
        await firestoreBatch.commit();
        firestoreBatch = db.batch();
        writeCount = 0;
      }
    }

    if (writeCount > 0) {
      await firestoreBatch.commit();
    }

    let deletedOldDocCount = 0;
    if (deleteOldDocs) {
      const oldDocsSnapshot = await db.collection('subject_stats').get();
      let deleteBatch = db.batch();
      let deleteCount = 0;

      for (const doc of oldDocsSnapshot.docs) {
        const docId = doc.id;
        const segments = docId.split('|');
        if (segments.length === 2 && segments[0]?.startsWith('type_') && segments[1]?.startsWith('subject_')) {
          continue;
        }

        deleteBatch.delete(doc.ref);
        deleteCount += 1;
        deletedOldDocCount += 1;
        if (deleteCount >= writeBatchSize) {
          await deleteBatch.commit();
          deleteBatch = db.batch();
          deleteCount = 0;
        }
      }

      if (deleteCount > 0) {
        await deleteBatch.commit();
      }
    }

    if (typeof cache?.flushAll === 'function') {
      cache.flushAll();
    }

    return {
      processedFiles,
      pages: page,
      subjectDocs: subjectDocs.size,
      deletedOldDocCount,
    };
  }

  async function rebuildSubjectsIndexFromSubjectStats({ batchSize = 500 } = {}) {
    const subjectsIndexByType = {
      exercise: {},
      exam: {},
    };

    const exerciseSnapshot = await db.collection('subject_stats').where('type', '==', 'exercise').get();
    const examSnapshot = await db.collection('subject_stats').where('type', '==', 'exam').get();

    const fillIndex = (snapshot) => {
      snapshot.forEach((doc) => {
        const data = doc.data() || {};
        const docType = ((data.type || 'exercise').toString().trim().toLowerCase());
        if (!['exercise', 'exam'].includes(docType)) {
          return;
        }

        const subjectName = data.subjectDisplay || data.subject || 'عام';
        const stats = data.stats || {};
        const totalKey = buildSubjectStatsComboKey({ year: 'all', state: 'all', specialty: 'all', fileYear: 'all' });
        const totalEntry = stats[totalKey] || {};

        subjectsIndexByType[docType][subjectName] = {
          count: getCountFromStatsEntry(totalEntry),
          specialties: Array.isArray(totalEntry.specialties)
            ? Array.from(new Set(totalEntry.specialties)).sort()
            : [],
        };
      });
    };

    fillIndex(exerciseSnapshot);
    fillIndex(examSnapshot);

    const hasIndexEntries = Object.keys(subjectsIndexByType.exercise).length > 0
      || Object.keys(subjectsIndexByType.exam).length > 0;

    if (!hasIndexEntries) {
      console.warn('⚠️ subject_stats index not available; rebuilding subjects_index from approved files.');
      const approvedSubjectMaps = {
        exercise: new Map(),
        exam: new Map(),
      };
      let lastDocSnapshot = null;
      let page = 0;

      while (true) {
        let query = db.collection('files')
          .where('isApproved', '==', true)
          .orderBy(admin.firestore.FieldPath.documentId())
          .limit(batchSize);

        if (lastDocSnapshot) {
          query = query.startAfter(lastDocSnapshot);
        }

        const filesSnapshot = await query.get();
        if (filesSnapshot.empty) {
          break;
        }

        page += 1;
        filesSnapshot.forEach((doc) => {
          const data = doc.data() || {};
          const docType = ((data.type || 'exercise').toString().trim().toLowerCase());
          if (!['exercise', 'exam'].includes(docType)) {
            return;
          }

          const subjectName = (data.subject || 'عام').toString().trim() || 'عام';
          const specialtyValue = normalizeText((data.specialty || '').toString());
          const current = approvedSubjectMaps[docType].get(subjectName) || {
            count: 0,
            specialties: new Set(),
          };

          current.count += 1;
          if (specialtyValue) {
            current.specialties.add(specialtyValue);
          }

          approvedSubjectMaps[docType].set(subjectName, current);
        });

        if (filesSnapshot.size < batchSize) {
          break;
        }

        lastDocSnapshot = filesSnapshot.docs[filesSnapshot.docs.length - 1];
      }

      Object.entries(approvedSubjectMaps).forEach(([typeKey, subjectMap]) => {
        subjectMap.forEach((value, subjectName) => {
          subjectsIndexByType[typeKey][subjectName] = {
            count: value.count,
            specialties: Array.from(value.specialties).sort(),
          };
        });
      });
    }

    await db.collection('app_metadata').doc('subjects_index').set({
      subjects: subjectsIndexByType,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (typeof cache?.flushAll === 'function') {
      cache.flushAll();
    }

    return {
      built: true,
      subjectCount: Object.keys(subjectsIndexByType.exercise).length + Object.keys(subjectsIndexByType.exam).length,
    };
  }

  function buildSubjectIndexEntry(fileRecord, delta = 1) {
    const subjectName = (fileRecord.subject || 'عام').toString().trim() || 'عام';
    const typeValue = ['exercise', 'exam'].includes((fileRecord.type || 'exercise').toString().trim().toLowerCase())
      ? (fileRecord.type || 'exercise').toString().trim().toLowerCase()
      : 'exercise';
    const specialtyValue = normalizeText((fileRecord.specialty || '').toString());
    const countDelta = Number.isNaN(Number(delta)) ? 1 : Number(delta);

    return {
      type: typeValue,
      subject: subjectName,
      delta: countDelta,
      specialties: specialtyValue ? [specialtyValue] : [],
    };
  }

  function updateSubjectsIndex(target, fileRecord, delta = 1) {
    const entry = buildSubjectIndexEntry(fileRecord, delta);
    const indexPayload = {
      subjects: {
        [entry.type]: {
          [entry.subject]: {
            count: admin.firestore.FieldValue.increment(entry.delta),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            ...(entry.specialties.length > 0 && entry.delta > 0
              ? { specialties: admin.firestore.FieldValue.arrayUnion(...entry.specialties) }
              : {}),
          },
        },
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const indexRef = db.collection('app_metadata').doc('subjects_index');
    target.set(indexRef, indexPayload, { merge: true });
  }

  function getCountFromStatsEntry(entry) {
    if (entry == null || typeof entry !== 'object') {
      return 0;
    }

    if (entry.count != null && !Number.isNaN(Number(entry.count))) {
      return Number(entry.count);
    }

    if (entry.shards && typeof entry.shards === 'object') {
      return Object.values(entry.shards).reduce((sum, shard) => sum + (Number(shard?.count) || 0), 0);
    }

    return 0;
  }

  function buildStatsPayloadForEntry(entry) {
    const payload = {};

    if (!useStatsShards || statsShardCount <= 1) {
      payload.count = admin.firestore.FieldValue.increment(entry.delta);
    } else {
      payload.count = admin.firestore.FieldValue.delete();
      const shardIndex = Math.floor(Math.random() * statsShardCount);
      payload.shards = {
        [`shard_${shardIndex}`]: {
          count: admin.firestore.FieldValue.increment(entry.delta),
        },
      };
    }

    if (entry.specialties.length > 0) {
      payload.specialties = admin.firestore.FieldValue.arrayUnion(...entry.specialties);
    }

    return payload;
  }

  function buildInitialStatsPayloadFromAggregate(entry, comboKey) {
    const payload = {};

    if (!useStatsShards || statsShardCount <= 1) {
      payload.count = entry.count;
    } else {
      payload.count = admin.firestore.FieldValue.delete();
      const hash = Array.from(comboKey).reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) | 0, 0);
      const shardIndex = Math.abs(hash) % statsShardCount;
      payload.shards = {
        [`shard_${shardIndex}`]: {
          count: entry.count,
        },
      };
    }

    if (entry.specialties && entry.specialties.length > 0) {
      payload.specialties = Array.from(new Set(entry.specialties)).sort();
    }

    return payload;
  }

  async function updateSubjectStats(fileRecord, delta = 1) {
    try {
      const entries = buildSubjectStatsEntries(fileRecord, delta);
      if (entries.length === 0) {
        return;
      }

      const batch = db.batch();
      const subjectDocId = buildSubjectStatsSubjectDocId(entries[0]);
      const statsRef = db.collection('subject_stats').doc(subjectDocId);
      const updatePayload = {
        type: entries[0].type,
        subject: entries[0].subject,
        subjectDisplay: entries[0].subjectDisplay,
        stats: {},
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      entries.forEach((entry) => {
        const comboKey = buildSubjectStatsComboKey(entry);
        updatePayload.stats[comboKey] = buildStatsPayloadForEntry(entry);
      });

      batch.set(statsRef, updatePayload, { merge: true });
      updateSubjectsIndex(batch, fileRecord, delta);
      await batch.commit();

      if (typeof cache?.flushAll === 'function') {
        cache.flushAll();
      }
      console.log(`✅ Updated subject_stats and subjects_index for subject=${fileRecord.subject || 'عام'} delta=${delta}`);
    } catch (statsError) {
      console.error('⚠️ Failed to update subject_stats:', statsError.message || statsError);
    }
  }

  async function updateSubjectStatsTransaction(fileRecord, delta, transaction) {
    const entries = buildSubjectStatsEntries(fileRecord, delta);
    if (entries.length === 0) {
      return;
    }

    const subjectDocId = buildSubjectStatsSubjectDocId(entries[0]);
    const statsRef = db.collection('subject_stats').doc(subjectDocId);
    const updatePayload = {
      type: entries[0].type,
      subject: entries[0].subject,
      subjectDisplay: entries[0].subjectDisplay,
      stats: {},
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    entries.forEach((entry) => {
      const comboKey = buildSubjectStatsComboKey(entry);
      updatePayload.stats[comboKey] = buildStatsPayloadForEntry(entry);
    });

    transaction.set(statsRef, updatePayload, { merge: true });
    updateSubjectsIndex(transaction, fileRecord, delta);
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
    rebuildSubjectsIndexFromSubjectStats,
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
  getStatsForFilters,
  buildSubjectStatsDocId,
  buildSubjectStatsEntries,
  mergeSubjectItemsBySubject,
  resolveSubjectItemsForDisplay,
};
