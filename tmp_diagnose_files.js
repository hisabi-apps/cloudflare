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
    const query = db.collection('files')
      .where('subjectNormalized', '==', normalizedSubject)
      .where('isApproved', '==', true)
      .orderBy('createdAt', 'desc')
      .orderBy('__name__')
      .limit(10);
    const snapshot = await query.get();
    console.log('success subjectNormalized count', snapshot.size);
    snapshot.docs.forEach(doc => console.log(doc.id, doc.data()));
  } catch (err) {
    console.error('ERROR', err && err.code, err && err.message);
    console.error(err);
  }
})();
