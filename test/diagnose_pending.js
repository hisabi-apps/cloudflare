const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const admin = require('firebase-admin');
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountJson) {
  console.error('No FIREBASE_SERVICE_ACCOUNT');
  process.exit(1);
}
let serviceAccount;
try {
  serviceAccount = JSON.parse(serviceAccountJson);
} catch (err) {
  console.error('Invalid FIREBASE_SERVICE_ACCOUNT JSON', err.message);
  process.exit(1);
}
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id,
});
const db = admin.firestore();
(async () => {
  try {
    const snapshot = await db.collection('files')
      .where('reviewStatus', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .orderBy('__name__')
      .limit(1)
      .get();
    console.log('Snapshot size', snapshot.size);
    snapshot.docs.forEach((doc) => console.log(doc.id, doc.data()));
  } catch (err) {
    console.error('QUERY ERROR', err.code, err.message);
    console.error(JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
  }
})();
