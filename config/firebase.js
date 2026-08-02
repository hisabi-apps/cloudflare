const path = require('path');
const admin = require('firebase-admin');

function initFirebaseAdmin() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJson) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable is not set.');
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch (error) {
    throw new Error(`Failed to parse FIREBASE_SERVICE_ACCOUNT JSON: ${error.message}`);
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
  }

  const db = admin.firestore();
  return { admin, db, serviceAccount };
}

module.exports = {
  initFirebaseAdmin,
};
