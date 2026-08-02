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

    const exactSnapshot = await db.collection('files')
      .where('subject', '==', subject)
      .where('isApproved', '==', true)
      .limit(20)
      .get();
    console.log('exact count', exactSnapshot.size);
    exactSnapshot.docs.forEach(doc => {
      const data = doc.data();
      console.log('exact', doc.id, data.subject, data.subjectNormalized);
    });

    const normSnapshot = await db.collection('files')
      .where('subjectNormalized', '==', normalizedSubject)
      .where('isApproved', '==', true)
      .limit(20)
      .get();
    console.log('normalized count', normSnapshot.size);
    normSnapshot.docs.forEach(doc => {
      const data = doc.data();
      console.log('norm', doc.id, data.subject, data.subjectNormalized);
    });
  } catch (err) {
    console.error('ERROR', err && err.code, err && err.message);
    console.error(err);
  }
})();
