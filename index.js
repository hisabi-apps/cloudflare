const path = require('path');
require('dotenv').config({
  path: path.resolve(__dirname, '..', '.env'),
});

const express = require('express');
const { createNotificationService } = require('./services/notifications');
const { createFirebaseAdminService } = require('./services/firebase_admin');
const { createSubjectStatsService } = require('./services/statsService');
const { createFileService } = require('./services/fileService');
const { createR2Client } = require('./config/r2');
const { createCache } = require('./config/cache');
const { createDeviceTokenService } = require('./utils/validators');
const createNotificationsRouter = require('./routes/api/notifications');
const createSubjectsRouter = require('./routes/api/subjects');
const createFilesRouter = require('./routes/api/files');
const createPendingRouter = require('./routes/api/pending');
const createModerateRouter = require('./routes/api/moderate');
const createUploadRouter = require('./routes/api/upload');
const createDeleteRouter = require('./routes/api/delete');
const createCheckDuplicatesRouter = require('./routes/api/check-duplicates');
const createAdminRebuildStatsRouter = require('./routes/api/admin/rebuild-stats');
const createAdminSendFcmRouter = require('./routes/api/admin/send-fcm');
const createWellKnownRouter = require('./routes/well-known');
const createFileProxyRouter = require('./routes/files-proxy');

// -------------------- Firebase Admin SDK --------------------
const admin = require('firebase-admin');


// -------------------- ØªØ­Ù‚Ù‚ Ù…Ù† ÙˆØ¬ÙˆØ¯ Ù…ÙØªØ§Ø­ Ø§Ù„Ø®Ø¯Ù…Ø© --------------------
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!serviceAccountJson) {
  console.error('âŒ FIREBASE_SERVICE_ACCOUNT environment variable is not set.');
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(serviceAccountJson);
  console.log('âœ… Service account JSON parsed successfully.');
} catch (parseError) {
  console.error('âŒ Failed to parse FIREBASE_SERVICE_ACCOUNT JSON:', parseError.message);
  console.error('   Raw value (first 100 chars):', serviceAccountJson.substring(0, 100));
  process.exit(1);
}

let db; // âœ… Ø£Ø¹Ù„Ù† Ø§Ù„Ù…ØªØºÙŠØ± Ù‡Ù†Ø§ (Ø®Ø§Ø±Ø¬ Ø§Ù„Ù€ try)

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
  console.log('âœ… Firebase Admin initialized successfully with project ID:', serviceAccount.project_id);
  console.log('ðŸ” Service account email:', serviceAccount.client_email);
  console.log('ðŸ“¦ Firebase project ID from admin app:', admin.app().options.projectId);
  
  db = admin.firestore(); // âœ… Ø¹Ø±Ù‘Ù Ø§Ù„Ù…ØªØºÙŠØ± Ù‡Ù†Ø§ (Ø¯ÙˆÙ† const)
} catch (error) {
  console.error('âŒ Failed to initialize Firebase Admin:', error.message);
  process.exit(1);
}
// -------------------- Ø§Ù„Ù…ØªØºÙŠØ±Ø§Øª Ø§Ù„Ø¨ÙŠØ¦ÙŠØ© Ø§Ù„Ø£Ø³Ø§Ø³ÙŠØ© --------------------
const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME,
  R2_PUBLIC_BASE_URL,
  R2_UPLOAD_PREFIX = 'exercices',
  PORT = 10000,
} = process.env;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
  console.error('âŒ Missing Cloudflare R2 environment variables. See .env.example.');
  process.exit(1);
}

const app = express();
app.use(express.json());

const cache = createCache();
const deviceTokenService = createDeviceTokenService({ admin, db });
const { normalizeDeviceTokens, removeInvalidDeviceToken } = deviceTokenService;

const notificationService = createNotificationService({ admin, db });
const { resolveNotificationMetadata, getLocalizedField, persistAdminNotificationToUsers } = notificationService;

const firebaseAdminService = createFirebaseAdminService({ admin, db, serviceAccount });
const {
  sendFcmViaHttp,
  sendFcmWithFallback,
  normalizeRecipientData,
  sendMulticastMessage,
  isAdminUserData,
  verifyAdminRequest,
} = firebaseAdminService;

const subjectStatsService = createSubjectStatsService({ admin, db, cache, uploadPrefix: R2_UPLOAD_PREFIX });
const {
  rebuildSubjectStatsFromApprovedFiles,
  updateSubjectStats,
  updateSubjectStatsTransaction,
  sanitizeSegment,
  buildObjectKey,
  buildPublicUrl,
} = subjectStatsService;

const r2Client = createR2Client({
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
});
const fileService = createFileService({
  s3Client: r2Client,
  R2_BUCKET_NAME,
  R2_UPLOAD_PREFIX,
});

app.use('/api/notifications', createNotificationsRouter({ admin, db }));
app.use('/api/subjects', createSubjectsRouter({ db, cache }));
app.use('/api/files', createFilesRouter({ db, cache }));
app.use('/api/pending', createPendingRouter({ db, cache }));
app.use('/api/moderate', createModerateRouter({ db, admin, sendMulticastMessage, updateSubjectStatsTransaction, getLocalizedField, cache }));
app.use('/api/admin/rebuild-stats', createAdminRebuildStatsRouter({ verifyAdminRequest, rebuildSubjectStatsFromApprovedFiles, cache }));
app.use('/api/admin/send-fcm-notification', createAdminSendFcmRouter({
  admin,
  db,
  isAdminUserData,
  normalizeRecipientData,
  persistAdminNotificationToUsers,
  resolveNotificationMetadata,
  getLocalizedField,
  sendFcmWithFallback,
  sendMulticastMessage,
  normalizeDeviceTokens,
  removeInvalidDeviceToken,
}));
app.use('/upload', createUploadRouter({ db, admin, s3Client: r2Client, R2_BUCKET_NAME, R2_UPLOAD_PREFIX, buildObjectKey, buildPublicUrl, updateSubjectStats, cache }));
app.use('/delete', createDeleteRouter({ db, s3Client: r2Client, R2_BUCKET_NAME, updateSubjectStats, cache }));
app.use('/check-duplicates', createCheckDuplicatesRouter({ db, s3Client: r2Client, R2_BUCKET_NAME }));
app.use('/files', createFileProxyRouter({ fileService }));
app.use('/', createWellKnownRouter());

// -------------------- ØªØ´ØºÙŠÙ„ Ø§Ù„Ø®Ø§Ø¯Ù… --------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`âœ… Server running on http://localhost:${PORT}`);
    console.log('ðŸ“Œ New API endpoints:');
    console.log('  GET  /api/subjects?year=&state=&specialty=&fileYear=&page=1&limit=20');
    console.log('  GET  /api/files?subject=...&page=1&limit=20');
    console.log('  GET  /api/pending?page=1&limit=20');
    console.log('  PATCH /api/moderate/:id');
  });
}

module.exports = {
  resolveNotificationMetadata,
  app,
};                                                                                                             
