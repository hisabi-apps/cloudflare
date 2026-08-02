const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const admin = require('firebase-admin');
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountJson) {
  console.error('No FIREBASE_SERVICE_ACCOUNT');
  process.exit(1);
}
const serviceAccount = JSON.parse(serviceAccountJson);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: serviceAccount.project_id });
const db = admin.firestore();
const normalizeText = (value) => value.toString().trim().replace(/\s+/g, ' ').toLowerCase();
(async () => {
  try {
    const subject = 'Analyse 1';
    const normalizedSubject = normalizeText(subject);
    console.log('normalizedSubject=', normalizedSubject);
    const year = undefined;
    const state = undefined;
    const specialty = undefined;
    const fileYear = undefined;
    const fileYearFrom = undefined;
    const fileYearTo = undefined;
    const limitNum = 10;
    const pageNum = 1;
    const offset = 0;
    const fileYearFilter = null;
    const fileYearFromFilter = null;
    const fileYearToFilter = null;
    const hasFileYearRange = false;
    let query = db.collection('files').where('subjectNormalized', '==', normalizedSubject).where('isApproved', '==', true);
    if (year) query = query.where('year', '==', year);
    if (state) query = query.where('state', '==', state);
    if (fileYearFilter != null) query = query.where('fileYear', '==', fileYearFilter);
    if (fileYearFromFilter != null) query = query.where('fileYear', '>=', fileYearFromFilter);
    if (fileYearToFilter != null) query = query.where('fileYear', '<=', fileYearToFilter);
    if (hasFileYearRange) query = query.orderBy('fileYear');
    query = query.orderBy('createdAt', 'desc').orderBy('__name__');
    const snapshot = await query.limit(limitNum).get();
    console.log('primary snapshot', snapshot.size);
  } catch (err) {
    console.error('PRIMARY ERROR', err.code, err.message);
    console.error(err);
  }
  try {
    const subject = 'Analyse 1';
    let fallbackQuery = db.collection('files').where('subject', '==', subject).where('isApproved', '==', true);
    const year = undefined;
    const state = undefined;
    const fileYearFilter = null;
    const fileYearFromFilter = null;
    const fileYearToFilter = null;
    const hasFileYearRange = false;
    if (year) fallbackQuery = fallbackQuery.where('year', '==', year);
    if (state) fallbackQuery = fallbackQuery.where('state', '==', state);
    if (fileYearFilter != null) fallbackQuery = fallbackQuery.where('fileYear', '==', fileYearFilter);
    if (fileYearFromFilter != null) fallbackQuery = fallbackQuery.where('fileYear', '>=', fileYearFromFilter);
    if (fileYearToFilter != null) fallbackQuery = fallbackQuery.where('fileYear', '<=', fileYearToFilter);
    if (hasFileYearRange) fallbackQuery = fallbackQuery.orderBy('fileYear');
    const fallbackOrdered = fallbackQuery.orderBy('createdAt', 'desc').orderBy('__name__');
    const snapshot = await fallbackOrdered.limit(10).get();
    console.log('fallback snapshot', snapshot.size);
    snapshot.docs.forEach(doc => console.log('file', doc.id, doc.data().subject, doc.data().subjectNormalized));
  } catch (err) {
    console.error('FALLBACK ERROR', err.code, err.message);
    console.error(err);
  }
})();
