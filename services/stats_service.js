function normalizeText(value) {
  return value
    .toString()
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeStatsFilterValue(value) {
  const raw = value == null ? '' : value.toString().trim();
  return raw.length > 0 ? normalizeText(raw) : 'all';
}

function buildSubjectStatsDocId({ subject, year, state, specialty, fileYear }) {
  const normalized = {
    subject: normalizeText(subject || 'عام'),
    year: normalizeStatsFilterValue(year),
    state: normalizeStatsFilterValue(state),
    specialty: normalizeStatsFilterValue(specialty),
    fileYear: normalizeStatsFilterValue(fileYear),
  };

  return [
    `subject_${normalized.subject}`,
    `year_${normalized.year}`,
    `state_${normalized.state}`,
    `specialty_${normalized.specialty}`,
    `fileYear_${normalized.fileYear}`,
  ].join('|');
}

function normalizeStateValue(value) {
  const raw = value == null ? '' : value.toString().trim();
  if (!raw) return '';

  const normalized = normalizeText(raw).replace(/['’]/g, '').replace(/[-]/g, ' ');
  const aliases = {
    'alger': 'alger',
    'algerie': 'alger',
    'algérie': 'alger',
    'الجزائر': 'alger',
    'adrar': 'adrar',
    'أدرار': 'adrar',
    'chlef': 'chlef',
    'الشلف': 'chlef',
    'laghouat': 'laghouat',
    'الأغواط': 'laghouat',
    'oum el bouaghi': 'oum-el-bouaghi',
    'أم البواقي': 'oum-el-bouaghi',
    'batna': 'batna',
    'باتنة': 'batna',
    'bejaia': 'bejaia',
    'béjaia': 'bejaia',
    'béjaïa': 'bejaia',
    'بجاية': 'bejaia',
    'biskra': 'biskra',
    'بسكرة': 'biskra',
    'bechar': 'bechar',
    'بشار': 'bechar',
    'blida': 'blida',
    'البليدة': 'blida',
    'bouira': 'bouira',
    'البويرة': 'bouira',
    'tamanrasset': 'tamanrasset',
    'تمنراست': 'tamanrasset',
    'tebessa': 'tebessa',
    'تبسة': 'tebessa',
    'tlemcen': 'tlemcen',
    'تلمسان': 'tlemcen',
    'tiaret': 'tiaret',
    'تيارت': 'tiaret',
    'tizi ouzou': 'tizi-ouzou',
    'تيزي وزو': 'tizi-ouzou',
    'djelfa': 'djelfa',
    'الجلفة': 'djelfa',
    'jijel': 'jijel',
    'جيجل': 'jijel',
    'setif': 'setif',
    'سطيف': 'setif',
    'saida': 'saida',
    'سعيدة': 'saida',
    'skikda': 'skikda',
    'سكيكدة': 'skikda',
    'sidi bel abbes': 'sidi-bel-abbes',
    'سيدي بلعباس': 'sidi-bel-abbes',
    'annaba': 'annaba',
    'عنابة': 'annaba',
    'guelma': 'guelma',
    'قالمة': 'guelma',
    'constantine': 'constantine',
    'قسنطينة': 'constantine',
    'medea': 'medea',
    'المدية': 'medea',
    'mostaganem': 'mostaganem',
    'مستغانم': 'mostaganem',
    'msila': 'msila',
    'المسيلة': 'msila',
    'mascara': 'mascara',
    'معسكر': 'mascara',
    'ouargla': 'ouargla',
    'ورقلة': 'ouargla',
    'oran': 'oran',
    'وهران': 'oran',
    'el bayadh': 'el-bayadh',
    'البيض': 'el-bayadh',
    'illizi': 'illizi',
    'إليزي': 'illizi',
    'bordj bou arreridj': 'bordj-bou-arreridj',
    'برج بوعريريج': 'bordj-bou-arreridj',
    'boumerdes': 'boumerdes',
    'بومرداس': 'boumerdes',
    'el tarf': 'el-tarf',
    'الطارف': 'el-tarf',
    'tindouf': 'tindouf',
    'تندوف': 'tindouf',
    'tissemsilt': 'tissemsilt',
    'تيسمسيلت': 'tissemsilt',
    'el oued': 'el-oued',
    'الوادي': 'el-oued',
    'khenchela': 'khenchela',
    'خنشلة': 'khenchela',
    'souk ahras': 'souk-ahras',
    'سوق أهراس': 'souk-ahras',
    'tipaza': 'tipaza',
    'تيبازة': 'tipaza',
    'mila': 'mila',
    'ميلة': 'mila',
    'ain defla': 'ain-defla',
    'عين الدفلى': 'ain-defla',
    'naama': 'naama',
    'النعامة': 'naama',
    'ain temouchent': 'ain-temouchent',
    'عين تموشنت': 'ain-temouchent',
    'ghardaia': 'ghardaia',
    'غرداية': 'ghardaia',
    'relizane': 'relizane',
    'غليزان': 'relizane',
    'timimoun': 'timimoun',
    'تيميمون': 'timimoun',
    'bordj badji mokhtar': 'bordj-badji-mokhtar',
    'برج باجي مختار': 'bordj-badji-mokhtar',
    'ouled djellal': 'ouled-djellal',
    'أولاد جلال': 'ouled-djellal',
    'beni abbes': 'beni-abbes',
    'بني عباس': 'beni-abbes',
    'in salah': 'in-salah',
    'عين صالح': 'in-salah',
    'in guezzam': 'in-guezzam',
    'عين قزام': 'in-guezzam',
    'touggourt': 'touggourt',
    'تقرت': 'touggourt',
    'djanet': 'djanet',
    'جانت': 'djanet',
    'el mghair': 'el-mghair',
    'المغير': 'el-mghair',
    'el meniaa': 'el-meniaa',
    'المنيعة': 'el-meniaa',
    'aflou': 'aflou',
    'آفلو': 'aflou',
    'barika': 'barika',
    'بريكة': 'barika',
    'el kantara': 'el-kantara',
    'القنطرة': 'el-kantara',
    'bir el ater': 'bir-el-ater',
    'بير العاتر': 'bir-el-ater',
    'el aricha': 'el-aricha',
    'العريشة': 'el-aricha',
    'ksar chellala': 'ksar-chellala',
    'قصر الشلالة': 'ksar-chellala',
    'ain oussara': 'ain-oussara',
    'عين وسارة': 'ain-oussara',
    'messaad': 'messaad',
    'مسعد': 'messaad',
    'ksar el boukhari': 'ksar-el-boukhari',
    'قصر البخاري': 'ksar-el-boukhari',
    'bou saada': 'bou-saada',
    'بوسعادة': 'bou-saada',
    'el abiodh sidi cheikh': 'el-abiodh-sidi-cheikh',
    'الأبيض سيدي الشيخ': 'el-abiodh-sidi-cheikh',
  };

  return aliases[normalized] || normalized;
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
  async function rebuildSubjectStatsFromApprovedFiles({ batchSize = 500 } = {}) {
    const statsMap = new Map();
    let processedFiles = 0;
    let page = 0;
    let lastDocSnapshot = null;

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
        const data = doc.data() || {};
        const rawSubject = (data.subject || 'عام').toString();
        const subject = normalizeText(rawSubject);
        const subjectDisplay = rawSubject.trim();
        const yearValue = normalizeStatsFilterValue(data.year || 'all');
        const stateValue = normalizeStatsFilterValue(data.state || 'all');
        const specialtyValue = normalizeStatsFilterValue(data.specialty || 'all');
        const fileYearValue = (() => {
          if (data.fileYear == null || data.fileYear === '') {
            return 'all';
          }
          const numeric = Number(data.fileYear);
          return Number.isNaN(numeric) ? normalizeStatsFilterValue(data.fileYear) : numeric;
        })();

        const filterGroups = ['year', 'state', 'specialty', 'fileYear'];
        const filterValues = {
          year: yearValue,
          state: stateValue,
          specialty: specialtyValue,
          fileYear: fileYearValue,
        };

        for (let mask = 0; mask < (1 << filterGroups.length); mask += 1) {
          const combo = {
            subject,
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
          const existing = statsMap.get(docId) || {
            subject,
            subjectDisplay,
            year: combo.year,
            state: combo.state,
            specialty: combo.specialty,
            fileYear: combo.fileYear,
            count: 0,
            specialties: new Set(),
          };

          existing.count += 1;
          if (specialtyValue !== 'all') {
            existing.specialties.add(specialtyValue);
          }
          statsMap.set(docId, existing);
        }

        processedFiles += 1;
      });

      if (approvedFilesSnapshot.size < batchSize) {
        break;
      }

      lastDocSnapshot = approvedFilesSnapshot.docs[approvedFilesSnapshot.docs.length - 1];
    }

    let writeCount = 0;
    let firestoreBatch = db.batch();
    for (const [docId, value] of statsMap.entries()) {
      const statsRef = db.collection('subject_stats').doc(docId);
      firestoreBatch.set(
        statsRef,
        {
          subject: value.subject,
          subjectDisplay: value.subjectDisplay,
          year: value.year,
          state: value.state,
          specialty: value.specialty,
          fileYear: value.fileYear,
          count: value.count,
          specialties: Array.from(value.specialties).sort(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      writeCount += 1;

      if (writeCount % 400 === 0) {
        await firestoreBatch.commit();
        firestoreBatch = db.batch();
      }
    }

    if (writeCount % 400 !== 0) {
      await firestoreBatch.commit();
    }

    return {
      processedFiles,
      statsDocs: statsMap.size,
      pages: page,
    };
  }

  async function updateSubjectStats(fileRecord, delta = 1) {
    try {
      const subject = fileRecord.subject || 'عام';
      const yearValue = fileRecord.year || 'all';
      const stateValue = fileRecord.state || 'all';
      const specialtyValue = fileRecord.specialty || 'all';
      const fileYearRaw = fileRecord.fileYear;
      const fileYearValue = typeof fileYearRaw === 'number' || !Number.isNaN(Number(fileYearRaw))
        ? Number(fileYearRaw)
        : 'all';

      const subjectNormalized = normalizeText(subject);
      const yearNormalized = normalizeStatsFilterValue(yearValue);
      const stateNormalized = normalizeStatsFilterValue(stateValue);
      const specialtyNormalized = normalizeStatsFilterValue(specialtyValue);
      const countDelta = Number.isNaN(Number(delta)) ? 1 : Number(delta);

      const filterGroups = ['year', 'state', 'specialty', 'fileYear'];
      const filterValues = {
        year: yearNormalized,
        state: stateNormalized,
        specialty: specialtyNormalized,
        fileYear: fileYearValue,
      };

      const batch = db.batch();
      const seenDocIds = new Set();

      for (let mask = 0; mask < (1 << filterGroups.length); mask++) {
        const combo = {
          subject: subjectNormalized,
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

        const statsRef = db.collection('subject_stats').doc(docId);
        const updatePayload = {
          subject: subjectNormalized,
          subjectDisplay: subject,
          year: combo.year,
          state: combo.state,
          specialty: combo.specialty,
          fileYear: combo.fileYear,
          count: admin.firestore.FieldValue.increment(countDelta),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        if (specialtyNormalized !== 'all' && countDelta > 0) {
          updatePayload.specialties = admin.firestore.FieldValue.arrayUnion(specialtyNormalized);
        }

        batch.set(statsRef, updatePayload, { merge: true });
      }

      await batch.commit();
      cache.flushAll();
      console.log(`✅ Updated subject_stats for ${seenDocIds.size} combinations for subject=${subject} delta=${countDelta}`);
    } catch (statsError) {
      console.error('⚠️ Failed to update subject_stats:', statsError.message || statsError);
    }
  }

  async function updateSubjectStatsTransaction(fileRecord, delta, transaction) {
    const subject = fileRecord.subject || 'عام';
    const yearValue = fileRecord.year || 'all';
    const stateValue = fileRecord.state || 'all';
    const specialtyValue = fileRecord.specialty || 'all';
    const fileYearRaw = fileRecord.fileYear;
    const fileYearValue = typeof fileYearRaw === 'number' || !Number.isNaN(Number(fileYearRaw))
      ? Number(fileYearRaw)
      : 'all';

    const subjectNormalized = normalizeText(subject);
    const yearNormalized = normalizeStatsFilterValue(yearValue);
    const stateNormalized = normalizeStatsFilterValue(stateValue);
    const specialtyNormalized = normalizeStatsFilterValue(specialtyValue);
    const countDelta = Number.isNaN(Number(delta)) ? 1 : Number(delta);

    const filterGroups = ['year', 'state', 'specialty', 'fileYear'];
    const filterValues = {
      year: yearNormalized,
      state: stateNormalized,
      specialty: specialtyNormalized,
      fileYear: fileYearValue,
    };

    const seenDocIds = new Set();
    for (let mask = 0; mask < (1 << filterGroups.length); mask++) {
      const combo = {
        subject: subjectNormalized,
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

      const statsRef = db.collection('subject_stats').doc(docId);
      const updatePayload = {
        subject: subjectNormalized,
        subjectDisplay: subject,
        year: combo.year,
        state: combo.state,
        specialty: combo.specialty,
        fileYear: combo.fileYear,
        count: admin.firestore.FieldValue.increment(countDelta),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (specialtyNormalized !== 'all' && countDelta > 0) {
        updatePayload.specialties = admin.firestore.FieldValue.arrayUnion(specialtyNormalized);
      }

      transaction.set(statsRef, updatePayload, { merge: true });
    }
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
    const cleanedKey = objectKey.replace(/^\/+/,'');
    const protocol = req.get('x-forwarded-proto') || req.protocol;
    const host = req.get('x-forwarded-host') || req.get('host');
    const encodedKey = cleanedKey.split('/').map(encodeURIComponent).join('/');
    const publicServerUrl = `${protocol}://${host}/files/${encodedKey}`;
    console.log(`✅ Using public server URL (FCM-compatible): ${publicServerUrl}`);
    return publicServerUrl;
  }

  return {
    normalizeText,
    normalizeStatsFilterValue,
    buildSubjectStatsDocId,
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
};
