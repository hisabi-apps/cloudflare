const path = require('path');
require('dotenv').config({
  path: path.resolve(__dirname, '..', '.env'),
});

const express = require('express');
const multer = require('multer');
const NodeCache = require('node-cache');
const axios = require('axios');
const crypto = require('crypto');
const { GoogleAuth } = require('google-auth-library');
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { shouldBlockDuplicateUpload } = require('./duplicate_policy');
const { computeTextFingerprint, isTextLikeFile } = require('./content_fingerprint');
const { buildExerciseFileDocument } = require('./file_doc_builder');
const { findMatchingDuplicateInDocs } = require('./duplicate_lookup');
const { findDuplicateBySignatureStore } = require('./duplicate_signature_store');

function computeFileHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function getOrComputeFileHash(docSnapshot) {
  const data = docSnapshot.data() || {};
  const existingHash = typeof data.fileHash === 'string' ? data.fileHash.trim() : '';
  if (existingHash) {
    return existingHash;
  }

  const objectKey = typeof data.storagePath === 'string' ? data.storagePath.trim() : '';
  if (!objectKey) {
    return '';
  }

  try {
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: objectKey.replace(/^\/+/, ''),
    });
    const response = await s3Client.send(command);
    const body = response.Body;
    if (!body) {
      return '';
    }

    const chunks = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const buffer = Buffer.concat(chunks);
    const hash = computeFileHash(buffer);
    await docSnapshot.ref.set({ fileHash: hash }, { merge: true });
    return hash;
  } catch (error) {
    console.warn(`⚠️ Failed to compute hash for ${objectKey}:`, error.message || error);
    return '';
  }
}

async function findExistingDuplicate(fileHash, currentFileId = '', options = {}) {
  const { fileBuffer, fileName = '', mimeType = '', uploadedByUid = '' } = options;

  try {
    // Fast path: signature store lookup first, then indexed fileHash search,
    // then fallback scan. This keeps the common case efficient.
    const signatureDoc = await db.collection('file_signatures').doc(fileHash).get();
    const signatureMatch = await findDuplicateBySignatureStore({
      fileHash,
      currentFileId,
      getSignatureDoc: async () => signatureDoc,
      getFileDoc: async (docId) => db.collection('files').doc(docId).get(),
    });

    if (signatureMatch) {
      return signatureMatch;
    }
  } catch (error) {
    console.warn('⚠️ Signature-store duplicate lookup failed, falling back to direct scan:', error.message || error);
  }

  try {
    const fastQuery = await db.collection('files')
      .where('fileHash', '==', fileHash)
      .limit(1)
      .get();

    if (!fastQuery.empty) {
      const doc = fastQuery.docs[0];
      if ((currentFileId || '').toString().trim() !== doc.id) {
        return doc;
      }
      console.log('ℹ️ Found fileHash match for currentFileId, continuing to fallback scan');
    }
  } catch (error) {
    console.warn('⚠️ Fast duplicate lookup failed, falling back to limited scan:', error.message || error);
  }

  try {
    const fallbackSnapshot = await db.collection('files').limit(20).get();
    const match = await findMatchingDuplicateInDocs({
      docs: fallbackSnapshot.docs,
      fileHash,
      currentFileId,
      fileBuffer,
      fileName,
      mimeType,
      getOrComputeFileHash: async (doc) => getOrComputeFileHash(doc),
    });
    return match;
  } catch (error) {
    console.warn('⚠️ Fallback duplicate scan failed:', error.message || error);
  }

  return null;
}

function resolveNotificationMetadata(requestBody = {}) {
  const clientData = requestBody?.data && typeof requestBody.data === 'object' ? requestBody.data : {};

  const category =
    typeof clientData.category === 'string' && clientData.category.trim() !== ''
      ? clientData.category.trim()
      : typeof requestBody?.category === 'string' && requestBody.category.trim() !== ''
        ? requestBody.category.trim()
        : 'general';

  const notificationType =
    typeof clientData.notificationType === 'string' && clientData.notificationType.trim() !== ''
      ? clientData.notificationType.trim()
      : typeof requestBody?.notificationType === 'string' && requestBody.notificationType.trim() !== ''
        ? requestBody.notificationType.trim()
        : 'admin_message';

  const parseBooleanLike = (value) => {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalizedValue = value.trim().toLowerCase();
      if (normalizedValue === 'true' || normalizedValue === '1' || normalizedValue === 'yes' || normalizedValue === 'on') {
        return true;
      }

      if (normalizedValue === 'false' || normalizedValue === '0' || normalizedValue === 'no' || normalizedValue === 'off') {
        return false;
      }
    }

    return false;
  };

  const isImportant = parseBooleanLike(clientData.isImportant ?? requestBody?.isImportant);

  return {
    category,
    notificationType,
    isImportant,
  };
}

// -------------------- Firebase Admin SDK --------------------
const admin = require('firebase-admin');


// -------------------- تحقق من وجود مفتاح الخدمة --------------------
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!serviceAccountJson) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT environment variable is not set.');
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(serviceAccountJson);
  console.log('✅ Service account JSON parsed successfully.');
} catch (parseError) {
  console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT JSON:', parseError.message);
  console.error('   Raw value (first 100 chars):', serviceAccountJson.substring(0, 100));
  process.exit(1);
}

let db; // ✅ أعلن المتغير هنا (خارج الـ try)

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
  console.log('✅ Firebase Admin initialized successfully with project ID:', serviceAccount.project_id);
  console.log('🔐 Service account email:', serviceAccount.client_email);
  console.log('📦 Firebase project ID from admin app:', admin.app().options.projectId);
  
  db = admin.firestore(); // ✅ عرّف المتغير هنا (دون const)
} catch (error) {
  console.error('❌ Failed to initialize Firebase Admin:', error.message);
  process.exit(1);
}
// -------------------- المتغيرات البيئية الأساسية --------------------
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
  console.error('❌ Missing Cloudflare R2 environment variables. See .env.example.');
  process.exit(1);
}

const upload = multer({ storage: multer.memoryStorage() });
const app = express();
app.use(express.json());

function normalizeDeviceTokens(userData) {
  const tokens = [];
  
  // Debug: what fields exist
  const availableFields = Object.keys(userData || {});
  console.log(`🔍 Available fields in userData: ${availableFields.join(', ')}`);
  
  if (Array.isArray(userData?.deviceTokens)) {
    console.log(`✅ Found deviceTokens array with ${userData.deviceTokens.length} items`);
    userData.deviceTokens
      .filter((token) => typeof token === 'string' && token.trim() !== '')
      .forEach((token) => tokens.push(token.trim()));
  } else {
    console.log(`❌ deviceTokens is not an array. Type: ${typeof userData?.deviceTokens}, Value: ${userData?.deviceTokens}`);
  }

  const fallbackTokenFields = ['fcmToken', 'messagingToken', 'token'];
  fallbackTokenFields.forEach((fieldName) => {
    const value = userData?.[fieldName];
    if (typeof value === 'string' && value.trim() !== '') {
      console.log(`✅ Found fallback token in field "${fieldName}": ${value.substring(0, 20)}...`);
      tokens.push(value.trim());
    }
  });

  console.log(`📊 Total tokens extracted: ${tokens.length}`);
  return [...new Set(tokens)];
}

async function removeInvalidDeviceToken(userId, token) {
  try {
    await db.collection('users').doc(userId).update({
      deviceTokens: admin.firestore.FieldValue.arrayRemove(token),
    });
    console.log(`🗑️ Removed invalid device token from user ${userId}`);
  } catch (e) {
    console.error(`⚠️ Failed to remove invalid token for user ${userId}:`, e?.message || e);
  }
}

function getLocalizedField(requestBody, field, lang) {
  const languageCode = (lang || 'ar').toString().trim().toLowerCase();
  const fieldKey = `${field}_${languageCode}`;
  const alternateBodyKey = field === 'body' ? `message_${languageCode}` : null;

  const value = requestBody[fieldKey] || (alternateBodyKey ? requestBody[alternateBodyKey] : undefined);
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }

  if (typeof requestBody[field] === 'string' && requestBody[field].trim() !== '') {
    return requestBody[field].trim();
  }

  if (field === 'body' && typeof requestBody.message === 'string' && requestBody.message.trim() !== '') {
    return requestBody.message.trim();
  }

  return '';
}

async function persistAdminNotificationToUsers({
  recipientUids,
  requestBody,
  senderUid,
  title,
  body,
  sentBatchId,
  topicName,
  attachmentImageUrl,
  notificationIconUrl,
  attachmentImageName,
  attachmentImageType,
  attachmentImageLinkUrl,
  attachmentFileUrl,
  attachmentFileName,
  attachmentFileType,
  attachmentName,
  attachmentType,
  imageWidth,
  imageHeight,
}) {
  const normalizedUids = [...new Set(
    (recipientUids || [])
      .filter((uid) => typeof uid === 'string' && uid.trim() !== '')
      .map((uid) => uid.trim())
      .filter((uid) => uid !== senderUid),
  )];

  if (normalizedUids.length === 0) {
    return 0;
  }

  const titleText = typeof title === 'string' ? title.trim() : '';
  const bodyText = typeof body === 'string' ? body.trim() : '';
  const { category, notificationType, isImportant } = resolveNotificationMetadata(requestBody);
  const linkUrl = typeof requestBody?.linkUrl === 'string' ? requestBody.linkUrl.trim() : '';
  const inlineLinks = Array.isArray(requestBody?.inlineLinks) ? requestBody.inlineLinks : [];

  const payload = {
    title: titleText,
    message: bodyText,
    title_ar: typeof requestBody?.title_ar === 'string' && requestBody.title_ar.trim() !== '' ? requestBody.title_ar.trim() : titleText,
    title_en: typeof requestBody?.title_en === 'string' && requestBody.title_en.trim() !== '' ? requestBody.title_en.trim() : titleText,
    title_fr: typeof requestBody?.title_fr === 'string' && requestBody.title_fr.trim() !== '' ? requestBody.title_fr.trim() : titleText,
    message_ar: typeof requestBody?.body_ar === 'string' && requestBody.body_ar.trim() !== '' ? requestBody.body_ar.trim() : bodyText,
    message_en: typeof requestBody?.body_en === 'string' && requestBody.body_en.trim() !== '' ? requestBody.body_en.trim() : bodyText,
    message_fr: typeof requestBody?.body_fr === 'string' && requestBody.body_fr.trim() !== '' ? requestBody.body_fr.trim() : bodyText,
    summary_ar: typeof requestBody?.summary_ar === 'string' && requestBody.summary_ar.trim() !== '' ? requestBody.summary_ar.trim() : (typeof requestBody?.summary === 'string' ? requestBody.summary.trim() : ''),
    summary_en: typeof requestBody?.summary_en === 'string' && requestBody.summary_en.trim() !== '' ? requestBody.summary_en.trim() : (typeof requestBody?.summary === 'string' ? requestBody.summary.trim() : ''),
    summary_fr: typeof requestBody?.summary_fr === 'string' && requestBody.summary_fr.trim() !== '' ? requestBody.summary_fr.trim() : (typeof requestBody?.summary === 'string' ? requestBody.summary.trim() : ''),
    secondaryText_ar: typeof requestBody?.secondaryText_ar === 'string' && requestBody.secondaryText_ar.trim() !== '' ? requestBody.secondaryText_ar.trim() : (typeof requestBody?.secondaryText === 'string' ? requestBody.secondaryText.trim() : ''),
    secondaryText_en: typeof requestBody?.secondaryText_en === 'string' && requestBody.secondaryText_en.trim() !== '' ? requestBody.secondaryText_en.trim() : (typeof requestBody?.secondaryText === 'string' ? requestBody.secondaryText.trim() : ''),
    secondaryText_fr: typeof requestBody?.secondaryText_fr === 'string' && requestBody.secondaryText_fr.trim() !== '' ? requestBody.secondaryText_fr.trim() : (typeof requestBody?.secondaryText === 'string' ? requestBody.secondaryText.trim() : ''),
    linkText_ar: typeof requestBody?.linkText_ar === 'string' && requestBody.linkText_ar.trim() !== '' ? requestBody.linkText_ar.trim() : (typeof requestBody?.linkText === 'string' ? requestBody.linkText.trim() : ''),
    linkText_en: typeof requestBody?.linkText_en === 'string' && requestBody.linkText_en.trim() !== '' ? requestBody.linkText_en.trim() : (typeof requestBody?.linkText === 'string' ? requestBody.linkText.trim() : ''),
    linkText_fr: typeof requestBody?.linkText_fr === 'string' && requestBody.linkText_fr.trim() !== '' ? requestBody.linkText_fr.trim() : (typeof requestBody?.linkText === 'string' ? requestBody.linkText.trim() : ''),
    summary: typeof requestBody?.summary === 'string' ? requestBody.summary.trim() : '',
    secondaryText: typeof requestBody?.secondaryText === 'string' ? requestBody.secondaryText.trim() : '',
    linkText: typeof requestBody?.linkText === 'string' ? requestBody.linkText.trim() : '',
    linkUrl: typeof requestBody?.linkUrl === 'string' ? requestBody.linkUrl.trim() : linkUrl,
    inlineLinks,
    elementOrder: typeof requestBody?.elementOrder === 'string' && requestBody.elementOrder.trim() !== '' ? requestBody.elementOrder.trim() : 'text_button_image',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    isRead: false,
    type: notificationType,
    category,
    isImportant,
    createdBy: senderUid || '',
    sentBatchId: sentBatchId || '',
    target: topicName && topicName === 'all_users' ? 'all' : 'custom',
    topicName: topicName || '',
    expiresAt: typeof requestBody?.expiresAt === 'string' && requestBody.expiresAt.trim() !== ''
      ? admin.firestore.Timestamp.fromDate(new Date(requestBody.expiresAt))
      : null,
  };

  if (attachmentImageUrl) {
    payload.attachmentImageUrl = attachmentImageUrl;
    payload.attachmentImageName = attachmentImageName || 'image';
    payload.attachmentImageType = attachmentImageType || 'image';
    payload.attachmentImageLinkUrl = attachmentImageLinkUrl || '';
    payload.attachmentImageWidth = imageWidth || null;
    payload.attachmentImageHeight = imageHeight || null;
  }

  if (typeof requestBody?.attachmentImageLinkUrl === 'string' && requestBody.attachmentImageLinkUrl.trim() !== '') {
    payload.attachmentImageLinkUrl = requestBody.attachmentImageLinkUrl.trim();
  }

  if (notificationIconUrl) {
    payload.notificationIconUrl = notificationIconUrl;
  }

  if (attachmentFileUrl) {
    payload.attachmentFileUrl = attachmentFileUrl;
    payload.attachmentFileName = attachmentFileName || 'file';
    payload.attachmentFileType = attachmentFileType || 'file';
    payload.attachmentName = attachmentName || attachmentFileName || 'file';
    payload.attachmentType = attachmentType || attachmentFileType || 'file';
  }

  const batchLimit = 450;
  let batch = db.batch();
  let writesInBatch = 0;

  for (const uid of normalizedUids) {
    const safeSentBatchId = typeof sentBatchId === 'string' && sentBatchId.trim() !== ''
      ? sentBatchId.trim()
      : `${senderUid || 'admin'}_${Date.now()}`;
    const notificationDocId = `${safeSentBatchId}_${uid}`;
    const notificationRef = db
      .collection('users')
      .doc(uid)
      .collection('notifications')
      .doc(notificationDocId);

    batch.set(notificationRef, { id: notificationDocId, ...payload }, { merge: true });
    writesInBatch += 1;

    if (writesInBatch >= batchLimit) {
      await batch.commit();
      batch = db.batch();
      writesInBatch = 0;
    }
  }

  if (writesInBatch > 0) {
    await batch.commit();
  }

  return normalizedUids.length;
}

async function sendFcmViaHttp(message) {
  const auth = new GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();
  const token = accessToken?.token || accessToken;
  const projectId = serviceAccount.project_id || admin.app().options.projectId || process.env.FIREBASE_PROJECT_ID;

  if (!projectId) {
    throw new Error('Unable to determine Firebase project ID for HTTP FCM request.');
  }

  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  console.log(`🔧 HTTP FCM URL: ${url}`);

  try {
    const response = await axios.post(
      url,
      { message },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    return response.data;
  } catch (httpError) {
    console.error('❌ sendFcmViaHttp error response:', {
      message: httpError?.message,
      status: httpError?.response?.status,
      data: httpError?.response?.data,
    });
    throw httpError;
  }
}

async function sendFcmWithFallback(message, label) {
  try {
    const response = await admin.messaging().send(message);
    return { channel: 'admin', response };
  } catch (adminError) {
    console.error(`⚠️ admin.messaging().send failed for ${label}:`, {
      message: adminError?.message,
      code: adminError?.code,
      details: adminError?.details || adminError?.errorInfo,
    });
    try {
      const httpResponse = await sendFcmViaHttp(message);
      console.log(`✅ HTTP FCM fallback succeeded for ${label}`);
      return { channel: 'http', response: httpResponse };
    } catch (httpError) {
      console.error(`❌ HTTP FCM fallback failed for ${label}:`, {
        message: httpError?.message,
        status: httpError?.response?.status,
        data: httpError?.response?.data,
      });
      throw httpError;
    }
  }
}

function normalizeRecipientData(recipient) {
  if (!recipient || typeof recipient !== 'object') {
    return null;
  }

  const uid = recipient.uid ? String(recipient.uid).trim() : '';
  const language = recipient.language
    ? String(recipient.language).trim().toLowerCase()
    : 'ar';

  const deviceTokens = Array.isArray(recipient.deviceTokens)
    ? recipient.deviceTokens
        .filter((token) => typeof token === 'string' && token.trim() !== '')
        .map((token) => token.trim())
    : [];

  const uniqueDeviceTokens = [...new Set(deviceTokens)];
  if (uniqueDeviceTokens.length === 0) {
    return null;
  }

  return {
    uid,
    language: language || 'ar',
    deviceTokens: uniqueDeviceTokens,
  };
}

async function sendMulticastMessage(message) {
  return admin.messaging().sendMulticast(message);
}

function isAdminUserData(userData, email) {
  if (!userData) {
    return false;
  }

  const normalizedEmail = (email || '').trim().toLowerCase();
  if (
    normalizedEmail.includes('admin') ||
    normalizedEmail.includes('owner') ||
    normalizedEmail.includes('moderator')
  ) {
    return true;
  }

  const roleValue = userData.role;
  if (typeof roleValue === 'string') {
    const normalizedRole = roleValue.trim().toLowerCase();
    if (
      normalizedRole.includes('admin') ||
      normalizedRole.includes('owner') ||
      normalizedRole.includes('moderator')
    ) {
      return true;
    }
  }

  if (typeof userData.isAdmin === 'boolean' && userData.isAdmin) {
    return true;
  }
  if (
    typeof userData.isAdmin === 'string' &&
    userData.isAdmin.trim().toLowerCase() === 'true'
  ) {
    return true;
  }

  return false;
}

async function verifyAdminRequest(req, res) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized request.' });
    return null;
  }

  const idToken = authHeader.split(' ')[1];
  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(idToken);
  } catch (tokenError) {
    console.error('⚠️ Invalid auth token in admin request:', tokenError);
    res.status(401).json({ error: 'Unauthorized request.' });
    return null;
  }

  const currentUid = decodedToken?.uid;
  if (!currentUid) {
    res.status(401).json({ error: 'Unauthorized request.' });
    return null;
  }

  const senderDoc = await db.collection('users').doc(currentUid).get();
  const senderEmail = decodedToken.email || '';
  const senderData = senderDoc.exists ? senderDoc.data() : null;
  if (!senderDoc.exists || !isAdminUserData(senderData, senderEmail)) {
    res.status(403).json({ error: 'Not authorized.' });
    return null;
  }

  return { uid: currentUid, userData: senderData };
}

app.post('/api/notifications/mark-opened', async (req, res) => {
  try {
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

    const body = req.body || {};
    const notificationId = typeof body.notificationId === 'string' ? body.notificationId.trim() : '';
    const createdBy = typeof body.createdBy === 'string' ? body.createdBy.trim() : '';
    const sentBatchId = typeof body.sentBatchId === 'string' ? body.sentBatchId.trim() : '';

    if (!notificationId || !createdBy || !sentBatchId) {
      return res.status(400).json({ error: 'Missing notification metadata.' });
    }

    const notificationRef = db.collection('users').doc(currentUid).collection('notifications').doc(notificationId);
    const notificationDoc = await notificationRef.get();
    if (!notificationDoc.exists) {
      return res.status(404).json({ error: 'Notification not found.' });
    }

    const notificationData = notificationDoc.data() || {};
    if (notificationData.openedCounted === true) {
      return res.json({ success: true, alreadyCounted: true });
    }

    const adminSentRef = db.collection('users').doc(createdBy).collection('sent_notifications').doc(sentBatchId);
    await db.runTransaction(async (transaction) => {
      transaction.set(
        notificationRef,
        {
          isRead: true,
          openedCounted: true,
        },
        { merge: true },
      );

      transaction.set(
        adminSentRef,
        {
          openedCount: admin.firestore.FieldValue.increment(1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });

    return res.json({ success: true, alreadyCounted: false });
  } catch (error) {
    console.error('Failed to mark notification as opened:', error);
    return res.status(500).json({ error: 'Failed to update open count.' });
  }
});

app.post('/api/admin/rebuild-stats', async (req, res) => {
  try {
    const adminRequest = await verifyAdminRequest(req, res);
    if (!adminRequest) {
      return;
    }

    console.log('🔧 Admin rebuild-stats requested by', adminRequest.uid);

    const approvedFilesSnapshot = await db.collection('files')
      .where('isApproved', '==', true)
      .get();

    const statsMap = new Map();

    const normalizeFileYear = (rawValue) => {
      if (rawValue == null || rawValue === '') {
        return 'all';
      }
      const numeric = Number(rawValue);
      return Number.isNaN(numeric) ? normalizeStatsFilterValue(rawValue) : numeric;
    };

    approvedFilesSnapshot.forEach((doc) => {
      const data = doc.data() || {};
const rawSubject = (data.subject || 'عام').toString();
        const subject = normalizeText(rawSubject);
        const subjectDisplay = rawSubject.trim();
      const yearValue = normalizeStatsFilterValue(data.year || 'all');
      const stateValue = normalizeStatsFilterValue(data.state || 'all');
      const specialtyValue = normalizeStatsFilterValue(data.specialty || 'all');
      const fileYearValue = normalizeFileYear(data.fileYear || 'all');

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
          subject: subject,
          subjectDisplay: subjectDisplay,
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
    });

    console.log(`🔁 Rebuilding subject_stats from ${approvedFilesSnapshot.size} approved files into ${statsMap.size} stats docs`);

    // حذف كل وثائق subject_stats الحالية أولاً ثم إعادة الكتابة.
    let deletedCount = 0;
    while (true) {
      const snapshot = await db.collection('subject_stats').limit(500).get();
      if (snapshot.empty) break;
      const deleteBatch = db.batch();
      snapshot.docs.forEach((existingDoc) => deleteBatch.delete(existingDoc.ref));
      await deleteBatch.commit();
      deletedCount += snapshot.size;
      if (snapshot.size < 500) break;
    }
    console.log(`🧹 Deleted ${deletedCount} existing subject_stats docs before rebuild.`);

    let writeCount = 0;
    let batch = db.batch();
    for (const [docId, value] of statsMap.entries()) {
      const statsRef = db.collection('subject_stats').doc(docId);
      batch.set(statsRef, {
        subject: value.subject,
        subjectDisplay: value.subjectDisplay,
        year: value.year,
        state: value.state,
        specialty: value.specialty,
        fileYear: value.fileYear,
        count: value.count,
        specialties: Array.from(value.specialties).sort(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: false });
      writeCount += 1;

      if (writeCount % 400 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
    await batch.commit();

    cache.flushAll();

    return res.json({ success: true, updated: statsMap.size });
  } catch (error) {
    console.error('Failed to rebuild subject_stats:', error);
    return res.status(500).json({ error: 'Failed to rebuild subject_stats.' });
  }
});

app.post('/api/admin/send-fcm-notification', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized request.' });
    }

    const idToken = authHeader.split(' ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    if (!decodedToken?.uid) {
      return res.status(401).json({ error: 'Unauthorized request.' });
    }

    const senderUid = decodedToken.uid;
    const senderEmail = decodedToken.email || '';
    const senderRef = db.collection('users').doc(senderUid);
    const senderDoc = await senderRef.get();
    if (!senderDoc.exists || !isAdminUserData(senderDoc.data(), senderEmail)) {
      return res.status(403).json({ error: 'Not authorized to send notifications.' });
    }

    const requestBody = req.body || {};
    const { title, body, recipients, recipientsData, topic, data } = requestBody;
    const topicName = typeof topic === 'string' ? topic.trim() : '';
    const attachmentImageUrl = typeof requestBody.attachmentImageUrl === 'string' ? requestBody.attachmentImageUrl.trim() : '';
    const notificationIconUrl = typeof requestBody.notificationIconUrl === 'string' ? requestBody.notificationIconUrl.trim() : '';
    const hasTopicTarget = topicName.length > 0;
    const hasRecipientsData = Array.isArray(recipientsData) && recipientsData.length > 0;
    const hasRecipients = hasRecipientsData || (Array.isArray(recipients) && recipients.length > 0);
    console.log(`📨 Received FCM request: title="${title}", body="${body}", topic="${topicName}", recipients=${Array.isArray(recipients) ? recipients.length : 0}, recipientsData=${hasRecipientsData ? recipientsData.length : 0}`);
    
    if (typeof title !== 'string' || title.trim() === '') {
      return res.status(400).json({ error: 'Notification title is required.' });
    }
    if (typeof body !== 'string' || body.trim() === '') {
      return res.status(400).json({ error: 'Notification body is required.' });
    }
    if (!hasTopicTarget && !hasRecipients) {
      return res.status(400).json({ error: 'Recipients are required unless topic is provided.' });
    }

    const normalizedRecipientsData = hasRecipientsData
      ? recipientsData
          .map(normalizeRecipientData)
          .filter((recipient) => recipient !== null)
      : [];

    const uniqueRecipientUids = hasTopicTarget
      ? []
      : hasRecipientsData
          ? [
              ...new Set(
                normalizedRecipientsData
                  .map((recipient) => recipient.uid)
                  .filter((uid) => uid.length > 0),
              ),
            ]
          : [
              ...new Set(
                recipients
                  .map((recipient) => String(recipient).trim())
                  .filter((recipient) => recipient.length > 0),
              ),
            ];

    const recipientsToPersist = hasTopicTarget && topicName === 'all_users'
      ? (await db.collection('users').get()).docs
          .map((doc) => doc.id)
          .filter((uid) => uid !== senderUid)
      : uniqueRecipientUids;

    if (recipientsToPersist.length > 0) {
      await persistAdminNotificationToUsers({
        recipientUids: recipientsToPersist,
        requestBody,
        senderUid,
        title,
        body,
        sentBatchId: requestBody.sentBatchId || '',
        topicName,
        attachmentImageUrl,
        notificationIconUrl,
        attachmentImageName: requestBody.attachmentImageName || '',
        attachmentImageType: requestBody.attachmentImageType || '',
        attachmentImageLinkUrl: requestBody.attachmentImageLinkUrl || '',
        attachmentFileUrl: requestBody.attachmentFileUrl || '',
        attachmentFileName: requestBody.attachmentFileName || '',
        attachmentFileType: requestBody.attachmentFileType || '',
        attachmentName: requestBody.attachmentName || '',
        attachmentType: requestBody.attachmentType || '',
        imageWidth: requestBody.attachmentImageWidth,
        imageHeight: requestBody.attachmentImageHeight,
      });
    }

    let totalTokens = 0;
    let totalSuccess = 0;
    const details = [];

    const clientData = data || {};
    const localizedTitleEntries = Object.entries(requestBody || {}).filter(([key]) => key === 'title_ar' || key === 'title_en' || key === 'title_fr');
    const localizedBodyEntries = Object.entries(requestBody || {}).filter(([key]) => key === 'body_ar' || key === 'body_en' || key === 'body_fr');
    const { category, notificationType, isImportant } = resolveNotificationMetadata(requestBody);

    const defaultData = {
      notificationType,
      category,
      isImportant,
      target: clientData.target || 'all',
      sentBatchId: clientData.sentBatchId || '',
      topicName: clientData.topicName || '',
    };

    const finalData = {
      ...defaultData,
      ...clientData,
      ...(attachmentImageUrl ? { attachmentImageUrl } : {}),
      ...(attachmentImageUrl ? { imageUrl: attachmentImageUrl } : {}),
      ...(notificationIconUrl ? { notificationIconUrl } : {}),
    };

    const topLevelNotificationData = {
      ...(attachmentImageUrl ? { attachmentImageUrl } : {}),
      ...(attachmentImageUrl ? { imageUrl: attachmentImageUrl } : {}),
      ...(notificationIconUrl ? { notificationIconUrl } : {}),
    };
    const sanitizedData = Object.fromEntries(
      Object.entries(finalData).map(([key, value]) => [
        String(key),
        value == null ? '' : String(value),
      ]),
    );

    const localizedTitleData = Object.fromEntries(
      localizedTitleEntries.map(([key, value]) => [`title_${key.split('_').pop()}`, value])
    );
    const localizedBodyData = Object.fromEntries(
      localizedBodyEntries.map(([key, value]) => [`body_${key.split('_').pop()}`, value])
    );

    const messagePayload = {
      notification: {
        title: title.trim(),
        body: body.trim(),
        ...(attachmentImageUrl ? { image: attachmentImageUrl } : {}),
      },
      data: {
        title: title.trim(),
        body: body.trim(),
        ...localizedTitleData,
        ...localizedBodyData,
        ...sanitizedData,
        ...topLevelNotificationData,
      },
      android: {
        priority: 'high',
        notification: {
          ...(attachmentImageUrl ? { image: attachmentImageUrl } : {}),
          channelId: 'high_importance_channel',
        },
      },
      apns: {
        headers: {
          'apns-priority': '10',
        },
        payload: {
          aps: {
            contentAvailable: true,
            sound: 'default',
          },
        },
      },
    };

    // 📸 Debug: Log the Android notification with image URL
    if (attachmentImageUrl) {
      console.log(`📸 Android notification with image: ${attachmentImageUrl}`);
    }

    if (hasTopicTarget) {
      try {
        const topicMessage = {
          ...messagePayload,
          topic: topicName,
        };

        console.log(`📤 Sending topic message to '${topicName}'`);
        console.log(`📋 Payload: ${JSON.stringify(topicMessage)}`);

        const fallbackResult = await sendFcmWithFallback(topicMessage, `topic:${topicName}`);
        totalSuccess += 1;
        details.push({
          topic: topicName,
          success: true,
          messageId: fallbackResult.response,
          channel: fallbackResult.channel,
        });
        console.log(`✅ Topic FCM sent to '${topicName}' via ${fallbackResult.channel}: ${fallbackResult.response}`);
      } catch (sendError) {
        console.error(
          `❌ Failed to send topic FCM to '${topicName}':`,
          sendError?.message || sendError,
        );
        details.push({ topic: topicName, status: 'send_error', error: String(sendError) });
      }
    } else if (hasRecipientsData) {
      for (const recipientData of normalizedRecipientsData) {
        const recipientUid = recipientData.uid || '';
        const deviceTokens = recipientData.deviceTokens || [];
        const userLang = recipientData.language || 'ar';

        console.log(`📱 Recipient ${recipientUid || 'unknown'} has ${deviceTokens.length} tokens`);

        if (deviceTokens.length === 0) {
          details.push({ recipientUid, status: 'no_tokens' });
          continue;
        }

        const localizedTitle =
          getLocalizedField(requestBody, 'title', userLang) || messagePayload.notification.title;
        const localizedBody =
          getLocalizedField(requestBody, 'body', userLang) || messagePayload.notification.body;

        const personalizedMessage = {
          ...messagePayload,
          notification: {
            ...messagePayload.notification,
            title: localizedTitle,
            body: localizedBody,
          },
          data: {
            ...messagePayload.data,
            title: localizedTitle,
            body: localizedBody,
          },
        };

        const chunkSize = 500;
        for (let i = 0; i < deviceTokens.length; i += chunkSize) {
          const chunkTokens = deviceTokens.slice(i, i + chunkSize);
          const multicastMessage = {
            ...personalizedMessage,
            tokens: chunkTokens,
          };

          try {
            console.log(`📤 Sending multicast FCM to ${chunkTokens.length} tokens for ${recipientUid || 'unknown recipient'}`);
            const multicastResponse = await sendMulticastMessage(multicastMessage);
            totalTokens += chunkTokens.length;
            totalSuccess += multicastResponse.successCount;

            for (let index = 0; index < multicastResponse.responses.length; index += 1) {
              const resp = multicastResponse.responses[index];
              const token = chunkTokens[index];
              if (resp.success) {
                details.push({
                  recipientUid,
                  token,
                  success: true,
                  messageId: resp.messageId,
                });
              } else {
                const errorMessage = String(resp.error?.message || resp.error || 'unknown error');
                details.push({
                  recipientUid,
                  token,
                  status: 'send_error',
                  error: errorMessage,
                });

                if (
                  errorMessage.includes('Requested entity was not found') ||
                  errorMessage.includes('not a valid FCM registration token') ||
                  errorMessage.includes('registration token is not a valid FCM registration token')
                ) {
                  if (recipientUid) {
                    await removeInvalidDeviceToken(recipientUid, token);
                  }
                }
              }
            }
          } catch (sendError) {
            const errorMessage = String(sendError?.message || sendError);
            console.error(
              `❌ Failed to send multicast admin FCM for ${recipientUid || 'unknown recipient'}:`,
              errorMessage,
            );
            details.push({
              recipientUid,
              status: 'send_error',
              error: errorMessage,
            });
          }
        }
      }
    } else {
      for (const recipientUid of uniqueRecipientUids) {
        const userRef = db.collection('users').doc(recipientUid);
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
          details.push({ recipientUid, status: 'missing_user' });
          continue;
        }

        const userData = userDoc.data() || {};
        const deviceTokens = normalizeDeviceTokens(userData);

        console.log(`📱 User ${recipientUid} has ${deviceTokens.length} tokens`);

        if (deviceTokens.length === 0) {
          details.push({ recipientUid, status: 'no_tokens' });
          continue;
        }

        try {
          let userSuccessCount = 0;
          let userFailureCount = 0;

          for (const token of deviceTokens) {
            const userLang = String(userData.language || userData.languageCode || 'ar').trim().toLowerCase();
            const localizedTitle = getLocalizedField(requestBody, 'title', userLang) || messagePayload.notification.title;
            const localizedBody = getLocalizedField(requestBody, 'body', userLang) || messagePayload.notification.body;

            const singleMessage = {
              ...messagePayload,
              token,
              notification: {
                ...messagePayload.notification,
                title: localizedTitle,
                body: localizedBody,
              },
            };

            try {
              console.log(`📤 Sending FCM to token for ${recipientUid} (lang=${userLang})`);
              const fallbackResult = await sendFcmWithFallback(singleMessage, `user:${recipientUid}`);
              totalTokens += 1;
              totalSuccess += 1;
              userSuccessCount += 1;
              details.push({
                recipientUid,
                token,
                success: true,
                messageId: fallbackResult.response,
                channel: fallbackResult.channel,
              });
              console.log(`✅ FCM sent to ${recipientUid} token via ${fallbackResult.channel}: ${fallbackResult.response}`);
            } catch (sendError) {
              userFailureCount += 1;
              const errorMessage = String(sendError?.message || sendError);
              console.error(
                `❌ Failed to send admin FCM for user ${recipientUid} token:`,
                errorMessage,
              );
              details.push({
                recipientUid,
                token,
                status: 'send_error',
                error: errorMessage,
              });

              if (
                errorMessage.includes('Requested entity was not found') ||
                errorMessage.includes('not a valid FCM registration token') ||
                errorMessage.includes('registration token is not a valid FCM registration token')
              ) {
                await removeInvalidDeviceToken(recipientUid, token);
              }
            }
          }

          console.log(`📊 User ${recipientUid} result: ${userSuccessCount} succeeded, ${userFailureCount} failed`);
        } catch (sendError) {
          console.error(
            `❌ Failed to send admin FCM for user ${recipientUid}:`,
            sendError?.message || sendError,
          );
          details.push({ recipientUid, status: 'send_error', error: String(sendError) });
        }
      }
    }

    const persistedCount = recipientsToPersist.length;

    console.log(`✅ Admin FCM completed: totalTokens=${totalTokens}, totalSuccess=${totalSuccess}, persistedCount=${persistedCount}`);
    return res.json({
      success: true,
      recipients: uniqueRecipientUids.length,
      topic: topicName,
      sentCount: persistedCount,
      totalTokens,
      totalSuccess,
      details,
    });
  } catch (error) {
    console.error('Admin FCM send failed:', error);
    return res.status(500).json({ error: 'Failed to send admin FCM notification.' });
  }
});

// -------------------- نظام التخزين المؤقت (Cache) --------------------
const cache = new NodeCache({ stdTTL: 120, checkperiod: 130, maxKeys: 500 });

// -------------------- نقاط .well-known و Deep Link (دون تغيير) --------------------
app.use('/.well-known', express.static(path.join(__dirname, '.well-known')));

app.get('/.well-known/apple-app-site-association', (req, res) => {
  const fs = require('fs');
  const filePath = path.join(__dirname, '.well-known', 'apple-app-site-association.json');
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(filePath);
  }
  const fallbackContent = {
    applinks: {
      apps: [],
      details: [{ appID: 'TEAM_ID.com.hisabi.univpro', paths: ['/exercise', '/files/*'] }],
    },
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.json(fallbackContent);
});

app.get('/.well-known/assetlinks.json', (req, res) => {
  const fs = require('fs');
  const filePath = path.join(__dirname, '.well-known', 'assetlinks.json');
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(filePath);
  }
  return res.status(404).json({ error: 'assetlinks.json not found' });
});

app.get('/exercise', (req, res) => {
  const exerciseId = req.query.id || '';
  const exerciseTitle = req.query.title || 'تمرين';
  if (!exerciseId) {
    return res.status(400).json({ error: 'Missing exercise ID parameter' });
  }
  const encodedId = encodeURIComponent(exerciseId);
  const encodedTitle = encodeURIComponent(exerciseTitle);
  const customSchemeDeepLink = `hisabiuniv://exercise?id=${encodedId}&title=${encodedTitle}`;
  const googlePlayUrl = `https://play.google.com/store/apps/details?id=com.hisabi.univpro&referrer=${encodeURIComponent(`exercise_id=${exerciseId}&title=${exerciseTitle}`)}`;
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>تحميل التطبيق</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100%; height: 100%; overflow: hidden; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        .background { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: url('https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=1200&q=80') no-repeat center center / cover; filter: blur(10px) brightness(0.7); z-index: 0; }
        .overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.3); z-index: 1; }
        .container { position: relative; z-index: 2; display: flex; justify-content: center; align-items: center; width: 100%; height: 100%; padding: 20px; }
        .card { background: rgba(255, 255, 255, 0.95); border-radius: 20px; padding: 40px 30px; max-width: 400px; width: 100%; text-align: center; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4); backdrop-filter: blur(4px); transition: transform 0.3s ease; }
        .card:hover { transform: translateY(-4px); }
        .card h1 { font-size: 26px; color: #1a1a2e; margin-bottom: 10px; font-weight: 700; }
        .card p { font-size: 16px; color: #4a4a5a; margin: 10px 0 25px 0; line-height: 1.6; }
        .card .exercise-title { font-weight: 600; color: #16213e; background: #f0f2f7; padding: 6px 14px; border-radius: 30px; display: inline-block; margin-bottom: 20px; font-size: 15px; }
        .download-btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; background: #3c6ef0; color: white; padding: 14px 32px; border: none; border-radius: 50px; font-size: 18px; font-weight: 600; cursor: pointer; text-decoration: none; transition: background 0.3s, box-shadow 0.3s; box-shadow: 0 6px 14px rgba(60, 110, 240, 0.35); width: 100%; max-width: 280px; }
        .download-btn:hover { background: #2952d0; box-shadow: 0 8px 20px rgba(60, 110, 240, 0.5); }
        .download-btn svg { width: 24px; height: 24px; fill: currentColor; flex-shrink: 0; }
        .footer { margin-top: 25px; font-size: 13px; color: #888; }
        @media (max-width: 480px) { .card { padding: 28px 20px; } .card h1 { font-size: 22px; } .download-btn { font-size: 16px; padding: 12px 24px; } }
    </style>
</head>
<body>
    <div class="background"></div>
    <div class="overlay"></div>
    <div class="container">
        <div class="card">
            <h1>📚 التمرين في التطبيق</h1>
            <p>لفتح هذا التمرين، يرجى تثبيت تطبيق <strong>حسابي</strong> من متجر Google Play.</p>
            <div class="exercise-title">📌 ${exerciseTitle}</div>
            <a href="${googlePlayUrl}" target="_blank" class="download-btn">
                <svg viewBox="0 0 24 24" width="24" height="24"><path d="M3 21l11-9-11-9v18zM14 12l11-9-11-9v18z"/></svg>
                تحميل من Google Play
            </a>
            <div class="footer">سيتم فتح التمرين تلقائياً بعد التثبيت</div>
        </div>
    </div>
    <script>
        const deepLink = '${customSchemeDeepLink}';
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = deepLink;
        document.body.appendChild(iframe);
        setTimeout(() => { document.body.removeChild(iframe); }, 1000);
    </script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res.send(html);
});

// -------------------- دوال R2 (دون تغيير) --------------------
const r2Endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const s3Client = new S3Client({
  region: 'auto',
  endpoint: r2Endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

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
  return `${R2_UPLOAD_PREFIX}/${safeSubject}/${timestamp}-${safeTitle}-${safeName}`;
}

function buildPublicUrl(req, objectKey) {
  const cleanedKey = objectKey.replace(/^\/+/, '');
  
  // 🎯 الأولوية: استخدم رابط الخادم العام (متاح للجميع بما فيهم FCM)
  // هذا ضروري لـ FCM والصور التي تظهر في شريط الحالة
  // الروابط المباشرة من R2 محمية ولا يستطيع FCM الوصول إليها
  const protocol = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('x-forwarded-host') || req.get('host');
  const encodedKey = cleanedKey.split('/').map(encodeURIComponent).join('/');
  const publicServerUrl = `${protocol}://${host}/files/${encodedKey}`;
  console.log(`✅ Using public server URL (FCM-compatible): ${publicServerUrl}`);
  return publicServerUrl;
}

// -------------------- نقطة الحذف (تحديث subject_stats إذا كان الملف معتمدًا) --------------------
app.post('/delete', express.json(), async (req, res) => {
  const objectKey = (req.body.objectKey || '').toString().trim();
  if (!objectKey) {
    return res.status(400).json({ error: 'Missing object key.' });
  }

  const cleanedKey = objectKey.replace(/^\/+/, '');
  try {
    const command = new DeleteObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: cleanedKey,
    });
    await s3Client.send(command);
  } catch (error) {
    console.error('Delete failed:', error);
    return res.status(500).json({
      error: 'Failed to delete file from Cloudflare R2.',
      details: error.message || String(error),
    });
  }

  try {
    const fileQuery = await db.collection('files')
      .where('storagePath', '==', cleanedKey)
      .limit(1)
      .get();

    if (!fileQuery.empty) {
      const fileDoc = fileQuery.docs[0];
      const fileData = fileDoc.data() || {};
      if (fileData.isApproved === true) {
        try {
          await updateSubjectStats(fileData, -1);
          console.log(`✅ subject_stats decremented for deleted approved file: ${cleanedKey}`);
        } catch (statsError) {
          console.error('⚠️ Failed to decrement subject_stats during delete:', statsError);
        }
      } else {
        console.log(`ℹ️ Deleted file was not approved, skipping subject_stats decrement: ${cleanedKey}`);
      }
    } else {
      console.log(`⚠️ No Firestore file document found for deleted storagePath: ${cleanedKey}`);
    }
  } catch (error) {
    console.error('⚠️ Failed to lookup Firestore file for subject_stats update after delete:', error);
  }

  cache.flushAll();
  return res.status(200).json({ success: true, objectKey });
});

app.post('/check-duplicates', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const fileHash = computeFileHash(req.file.buffer);
    const matches = [];

    try {
      const signatureMatch = await findDuplicateBySignatureStore({
        fileHash,
        currentFileId: (req.body.currentFileId || '').toString().trim(),
        getSignatureDoc: async () => db.collection('file_signatures').doc(fileHash).get(),
        getFileDoc: async (docId) => db.collection('files').doc(docId).get(),
      });

      if (signatureMatch) {
        const data = signatureMatch.data() || {};
        matches.push({
          id: signatureMatch.id,
          title: data.title || '',
          subject: data.subject || '',
          name: data.name || '',
          uploadedByUid: data.uploadedByUid || '',
          reviewStatus: data.reviewStatus || '',
          fileHash: data.fileHash || fileHash,
        });
      }
    } catch (error) {
      console.warn('⚠️ Duplicate preview lookup failed:', error.message || error);
    }

    return res.status(200).json(matches);
  } catch (error) {
    console.error('Duplicate check failed:', error);
    return res.status(500).json({
      error: 'Failed to check duplicates.',
      details: error.message || String(error),
    });
  }
});

// -------------------- نقطة الرفع (معدلة: إضافة وثيقة جديدة في "files") --------------------
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const subject = req.body.subject || 'عام';
    const title = req.body.title || path.parse(req.file.originalname).name;
    const uploadedByUid = (req.body.uploadedByUid || 'anonymous').toString();
    const requestedObjectKey = (req.body.objectKey || '').toString().trim();
    const fileBuffer = req.file.buffer;
    const fileHash = computeFileHash(fileBuffer);
    const skipDuplicateCheck = req.body.skipDuplicateCheck === 'true' || req.body.skipDuplicateCheck === true || req.body.skipDuplicateCheck === '1';
    const skipFileRecord =
      req.body.skipFileRecord === 'true' ||
      req.body.skipFileRecord === true ||
      req.body.skipFileRecord === '1';
    const objectKey = requestedObjectKey
      ? requestedObjectKey.replace(/^\/+/, '')
      : buildObjectKey(subject, title, req.file.originalname);
    const textFingerprint = isTextLikeFile(req.file.originalname, req.file.mimetype)
      ? computeTextFingerprint(fileBuffer.toString('utf8'))
      : '';

    // 1. رفع الملف إلى R2
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: objectKey,
      Body: req.file.buffer,
      ContentType: req.file.mimetype || 'application/octet-stream',
      ACL: 'public-read',
    });
    await s3Client.send(command);
    const publicUrl = buildPublicUrl(req, objectKey);

    let docRef = null;
    if (!skipFileRecord) {
      if (!skipDuplicateCheck) {
        try {
          const existingDuplicate = await findExistingDuplicate(fileHash, '', {
            fileBuffer: req.file.buffer,
            fileName: req.file.originalname,
            mimeType: req.file.mimetype,
            uploadedByUid,
          });
          if (existingDuplicate) {
            const existing = existingDuplicate.data() || {};
            const shouldBlock = shouldBlockDuplicateUpload({
              existingUploadedByUid: existing.uploadedByUid || '',
              currentUploadedByUid: uploadedByUid,
            });

            if (shouldBlock) {
              return res.status(409).json({
                error: 'duplicate_file',
                message: 'هذا الملف موجود مسبقاً بنفس المحتوى من نفس المستخدم.',
                existingFileId: existingDuplicate.id,
                existingTitle: existing.title || 'ملف مكرر',
                duplicateMode: 'same_user_block',
              });
            }

            console.log(`ℹ️ Allowed duplicate upload for ${uploadedByUid} because the existing match belongs to a different uploader.`);
          }
        } catch (duplicateError) {
          console.warn('⚠️ Duplicate check failed; continuing upload.', duplicateError?.message || duplicateError);
        }
      }

      // 2. التحقق من صلاحية الرفع للأدمن
      let isAdmin = false;
      if (uploadedByUid !== 'anonymous') {
        const userDoc = await db.collection('users').doc(uploadedByUid).get();
        if (userDoc.exists) {
          const userData = userDoc.data() || {};
          const canModerate =
            userData.canModerateExercises === true ||
            ['admin', 'moderator', 'owner'].includes(
              (userData.role || '').toString().trim().toLowerCase(),
            );
          isAdmin = canModerate === true;
        }
      }

      // 3. إضافة وثيقة جديدة في مجموعة "files"
      const optionalFields = {
        year: req.body.year,
        state: req.body.state,
        specialty: req.body.specialty,
        fileYear: req.body.fileYear,
        system: req.body.system,
        semester: req.body.semester,
      };
      const newFileDoc = buildExerciseFileDocument({
        subject,
        title,
        name: req.file.originalname,
        url: publicUrl,
        storagePath: objectKey,
        uploadedByUid,
        uploadedByEmail: req.body.uploadedByEmail || '',
        isApproved: isAdmin,
        reviewStatus: isAdmin ? 'approved' : 'pending',
        fileHash,
        textFingerprint,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        optionalFields,
      });

      docRef = await db.collection('files').add(newFileDoc);

      if (docRef && fileHash) {
        await db.collection('file_signatures').doc(fileHash).set(
          {
            fileHash,
            relatedFileIds: FieldValue.arrayUnion(docRef.id),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }

      if (docRef && newFileDoc.isApproved) {
        updateSubjectStats(newFileDoc).catch((statsError) => {
          console.error('⚠️ subject_stats update failed during upload:', statsError.message || statsError);
        });
      }
    }

    // 4. مسح الكاش
    cache.flushAll();

    return res.status(201).json({
      success: true,
      id: docRef?.id || null,
      url: publicUrl,
      objectKey,
      skippedFileRecord: skipFileRecord,
    });
  } catch (error) {
    console.error('Upload failed:', error);
    return res.status(500).json({
      error: 'Failed to upload file to Cloudflare R2.',
      details: error.message || String(error),
    });
  }
});

// =================================================================
//  🚀 نقاط النهاية الجديدة (API) 
// =================================================================

// Firestore composite index recommendation for subject_stats:
// Collection: subject_stats
// Fields: year ASC, state ASC, specialty ASC, fileYear ASC, subject ASC, __name__ ASC
// This supports /api/subjects queries that filter by year, state, specialty, fileYear,
// and paginate ordered by subject.

// 1. جلب قائمة المواد مع عدد الملفات (مع الفلاتر والـ Cache)
app.get('/api/subjects', async (req, res) => {
  try {
    const { year, state, specialty, fileYear, fileYearFrom, fileYearTo, page = 1, limit = 10 } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
    const queryKeyBase = `subject_stats_${year || 'all'}_${state || 'all'}_${specialty || 'all'}_${fileYear || fileYearFrom || 'all'}_${fileYearTo || 'all'}`;
    const cacheKey = `${queryKeyBase}_${pageNum}_${limitNum}`;
    const cursorCacheKey = `subject_stats_cursor_${queryKeyBase}_${pageNum}_${limitNum}`;
    const prevCursorCacheKey = pageNum > 1 ? `subject_stats_cursor_${queryKeyBase}_${pageNum - 1}_${limitNum}` : null;

    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    let query = db.collection('subject_stats');
      const yearFilter = year ? normalizeStatsFilterValue(year) : null;
    const stateFilter = state ? normalizeStatsFilterValue(state) : null;
    const specialtyFilter = specialty ? normalizeStatsFilterValue(specialty) : null;
    const fileYearFilter = fileYear != null && fileYear !== '' && !Number.isNaN(Number(fileYear))
      ? Number(fileYear)
      : null;
    const fileYearFromFilter = fileYearFrom != null && fileYearFrom !== '' && !Number.isNaN(Number(fileYearFrom))
      ? Number(fileYearFrom)
      : null;
    const fileYearToFilter = fileYearTo != null && fileYearTo !== '' && !Number.isNaN(Number(fileYearTo))
      ? Number(fileYearTo)
      : null;

    if (yearFilter) query = query.where('year', '==', yearFilter);
    if (stateFilter) query = query.where('state', '==', stateFilter);
    if (specialtyFilter) query = query.where('specialty', '==', specialtyFilter);
    if (fileYearFilter != null) query = query.where('fileYear', '==', fileYearFilter);
    if (fileYearFromFilter != null) query = query.where('fileYear', '>=', fileYearFromFilter);
    if (fileYearToFilter != null) query = query.where('fileYear', '<=', fileYearToFilter);

    query = query.orderBy('subject').orderBy('__name__');
    if (pageNum > 1 && prevCursorCacheKey) {
      const previousPageCursor = cache.get(prevCursorCacheKey);
      if (previousPageCursor) {
        query = query.startAfterDocument(previousPageCursor);
      } else {
        query = query.offset((pageNum - 1) * limitNum);
      }
    }

    const snapshot = await query.limit(limitNum).get();
    console.log(`📊 /api/subjects read ${snapshot.size} subject_stats docs for page=${pageNum} limit=${limitNum}`);

    let items = snapshot.docs.map(doc => {
      const data = doc.data() || {};
      return {
        subject: data.subjectDisplay || data.subject || 'عام',
        count: typeof data.count === 'number' ? data.count : Number(data.count) || 0,
        specialties: Array.isArray(data.specialties) ? data.specialties : [],
      };
    });

    if (snapshot.empty && pageNum === 1) {
      console.log('⚠️ subject_stats is empty; falling back to files aggregation for /api/subjects');
      const fallbackQuery = db.collection('files').where('isApproved', '==', true);
      if (yearFilter) fallbackQuery = fallbackQuery.where('year', '==', yearFilter);
      if (stateFilter) fallbackQuery = fallbackQuery.where('state', '==', stateFilter);
      if (fileYearFilter != null) fallbackQuery = fallbackQuery.where('fileYear', '==', fileYearFilter);
      if (fileYearFromFilter != null) fallbackQuery = fallbackQuery.where('fileYear', '>=', fileYearFromFilter);
      if (fileYearToFilter != null) fallbackQuery = fallbackQuery.where('fileYear', '<=', fileYearToFilter);
      const fallbackSnapshot = await fallbackQuery.get();
      const subjectMap = new Map();
      const normalizedSpecialtyFilter = specialtyFilter;
      fallbackSnapshot.forEach(doc => {
        const data = doc.data() || {};
        const specialtyValue = normalizeText((data.specialty || '').toString());
        if (normalizedSpecialtyFilter && specialtyValue !== normalizedSpecialtyFilter) {
          return;
        }
        const subjectName = data.subject || 'عام';
        const key = subjectName;
        if (!subjectMap.has(key)) {
          subjectMap.set(key, { count: 0, specialties: new Set() });
        }
        const entry = subjectMap.get(key);
        entry.count += 1;
        if (specialtyValue) {
          entry.specialties.add(specialtyValue);
        }
      });
      items = Array.from(subjectMap.entries()).map(([subjectName, info]) => ({
        subject: subjectName,
        count: info.count,
        specialties: Array.from(info.specialties).sort(),
      }));
    }

    if (snapshot.docs.length > 0) {
      cache.set(cursorCacheKey, snapshot.docs[snapshot.docs.length - 1]);
    }

    const response = {
      items,
      page: pageNum,
      limit: limitNum,
      hasMore: snapshot.size === limitNum,
    };

    const maxCachedPages = 5;
    const cachedPagesKey = `cached_pages_${queryKeyBase}`;
    const existingPaginationPages = cache.get(cachedPagesKey);
    const activePages = Array.isArray(existingPaginationPages)
      ? existingPaginationPages.map((p) => parseInt(p, 10)).filter((p) => !Number.isNaN(p))
      : [];

    if (!activePages.includes(pageNum)) {
      activePages.push(pageNum);
    }

    while (activePages.length > maxCachedPages) {
      const pageToRemove = activePages.shift();
      if (pageToRemove !== undefined) {
        const expiredCacheKey = `${queryKeyBase}_${pageToRemove}_${limitNum}`;
        const expiredCursorKey = `subject_stats_cursor_${queryKeyBase}_${pageToRemove}_${limitNum}`;
        cache.del(expiredCacheKey);
        cache.del(expiredCursorKey);
      }
    }

    cache.set(cachedPagesKey, activePages);
    cache.set(cacheKey, response);
    res.json(response);
  } catch (error) {
    console.error('Error fetching subjects:', error);
    res.status(500).json({ error: 'Failed to fetch subjects.' });
  }
});

// 2. جلب ملفات مادة معينة (مع Pagination والـ Cache)
// Firestore composite index recommendation: subject ASC, isApproved ASC, createdAt DESC, __name__ ASC
app.get('/api/files', async (req, res) => {
  try {
    const { subject, year, state, specialty, fileYear, fileYearFrom, fileYearTo, page = 1, limit = 10 } = req.query;
    if (!subject) {
      return res.status(400).json({ error: 'Subject is required.' });
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    const queryKeyBase = `files_${subject}_${year || 'all'}_${state || 'all'}_${specialty || 'all'}_${fileYear || fileYearFrom || 'all'}_${fileYearTo || 'all'}`;
    const cacheKey = `${queryKeyBase}_${pageNum}_${limitNum}`;
    const cursorCacheKey = `cursor_${queryKeyBase}_${pageNum}_${limitNum}`;
    const prevCursorCacheKey = pageNum > 1 ? `cursor_${queryKeyBase}_${pageNum - 1}_${limitNum}` : null;

    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

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
    let query = db.collection('files')
      .where('subjectNormalized', '==', normalizedSubject)
      .where('isApproved', '==', true);

    if (year) query = query.where('year', '==', year);
    if (state) query = query.where('state', '==', state);
    if (fileYearFilter != null) query = query.where('fileYear', '==', fileYearFilter);
    const hasFileYearRange = fileYearFromFilter != null || fileYearToFilter != null;
    if (fileYearFromFilter != null) query = query.where('fileYear', '>=', fileYearFromFilter);
    if (fileYearToFilter != null) query = query.where('fileYear', '<=', fileYearToFilter);

    if (hasFileYearRange) {
      query = query.orderBy('fileYear');
    }

    // ترتيب ثابت مع مفتاح فريد ثانوي لتجنب الترتيب غير المحدد عند القيم المتساوية.
    query = query.orderBy('createdAt', 'desc').orderBy('__name__');

    // نستخدم startAfterDocument لمصادفة التمرير عبر الصفحات بدون offset المكلف.
    if (pageNum > 1 && prevCursorCacheKey) {
      const previousPageCursor = cache.get(prevCursorCacheKey);
      if (previousPageCursor) {
        query = query.startAfterDocument(previousPageCursor);
      } else {
        // إذا لم يكن هناك cursor محفوظ للصفحة السابقة، نستخدم fallback إلى offset.
        query = query.offset(offset);
      }
    }

    const snapshot = await query.limit(limitNum).get();

    const normalizedSpecialty = specialty ? normalizeText(specialty) : null;
    const files = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      const specialtyValue = (data.specialty || '').toString();
      if (normalizedSpecialty && normalizeText(specialtyValue) !== normalizedSpecialty) {
        return;
      }
      files.push({ id: doc.id, ...data });
    });

    // حافظ على آخر وثيقة في كل صفحة داخل الكاش لكي يستخدمها الطلب التالي كـ startAfterDocument.
    if (snapshot.docs.length > 0) {
      const lastDoc = snapshot.docs[snapshot.docs.length - 1];
      cache.set(cursorCacheKey, lastDoc);
    }

    cache.set(cacheKey, files);

    // حصر عدد صفحات الكاش لكل استعلام لتجنّب تخزين ذاكرة غير ضروري.
    const maxCachedPages = 5;
    const cachedPagesKey = `cached_pages_${queryKeyBase}`;
    const existingPaginationPages = cache.get(cachedPagesKey);
    const activePages = Array.isArray(existingPaginationPages)
      ? existingPaginationPages.map((p) => parseInt(p, 10)).filter((p) => !Number.isNaN(p))
      : [];

    if (!activePages.includes(pageNum)) {
      activePages.push(pageNum);
    }

    while (activePages.length > maxCachedPages) {
      const pageToRemove = activePages.shift();
      if (pageToRemove !== undefined) {
        const expiredCacheKey = `${queryKeyBase}_${pageToRemove}_${limitNum}`;
        const expiredCursorKey = `cursor_${queryKeyBase}_${pageToRemove}_${limitNum}`;
        cache.del(expiredCacheKey);
        cache.del(expiredCursorKey);
      }
    }

    cache.set(cachedPagesKey, activePages);
    res.json(files);
  } catch (error) {
    console.error('Error fetching files:', error);
    res.status(500).json({ error: 'Failed to fetch files.' });
  }
});

// 3. تحديث حالة ملف (مراجعة)
app.patch('/api/moderate/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      approved: approvedRaw,
      comment,
      commentAr,
      commentEn,
      commentFr,
      secondaryText_ar,
      secondaryText_en,
      secondaryText_fr,
      pointsDelta,
      withCorrection,
    } = req.body || {};

    const parseBooleanLike = (value) => {
      if (typeof value === 'boolean') {
        return value;
      }
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
        if (['false', '0', 'no', 'off'].includes(normalized)) return false;
      }
      if (typeof value === 'number') {
        return value === 1;
      }
      return null;
    };

    const approved = parseBooleanLike(approvedRaw);
    if (approved === null) {
      return res.status(400).json({ error: 'Approved status is required and must be boolean-like.' });
    }

    const docRef = db.collection('files').doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'File not found.' });
    }

    const fileData = doc.data() || {};
    const userId = fileData.uploadedByUid ? String(fileData.uploadedByUid).trim() : '';
    const fileTitle = fileData.title || 'ملف';
    const parsedPointsDelta = pointsDelta == null ? 0 : Number(pointsDelta);

    const moderationComment =
      comment || commentAr || commentEn || commentFr || '';

    await db.runTransaction(async (transaction) => {
      const fileSnapshot = await transaction.get(docRef);
      if (!fileSnapshot.exists) {
        throw new Error('File not found.');
      }

      transaction.update(docRef, {
        isApproved: approved,
        reviewStatus: approved ? 'approved' : 'rejected',
        moderationComment,
        pointsDelta: parsedPointsDelta,
        pointsAwarded: approved ? parsedPointsDelta : 0,
        withCorrection: Boolean(withCorrection),
        moderatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      if (approved && userId && parsedPointsDelta !== 0) {
        const userRef = db.collection('users').doc(userId);
        const userStatsRef = userRef.collection('stats').doc('profile');

        transaction.set(
          userRef,
          {
            points: admin.firestore.FieldValue.increment(parsedPointsDelta),
            lastPointsUpdate: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        transaction.set(
          userStatsRef,
          {
            points: admin.firestore.FieldValue.increment(parsedPointsDelta),
          },
          { merge: true },
        );
      }

      if (approved) {
        await updateSubjectStatsTransaction(fileSnapshot.data() || fileData, 1, transaction);
      }
    });

    cache.flushAll();

    // الإشعارات و FCM تتم خارج المعاملة لتجنب فشل المعاملة بسبب مشكلات التسليم.
    if (userId) {
      try {
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        if (userDoc.exists) {
          const userData = userDoc.data() || {};
          const pointsEarned = approved && !Number.isNaN(parsedPointsDelta) ? parsedPointsDelta : 0;
          const pointsTextAr = approved && pointsEarned > 0 ? ` +${pointsEarned} ${pointsEarned === 1 ? 'نقطة' : 'نقط'}` : '';
          const pointsTextEn = approved && pointsEarned > 0 ? ` +${pointsEarned} point${pointsEarned === 1 ? '' : 's'}` : '';
          const pointsTextFr = approved && pointsEarned > 0 ? ` +${pointsEarned} point${pointsEarned === 1 ? '' : 's'}` : '';

          const titleAr = approved ? 'ملف مقبول' : 'ملف مرفوض';
          const titleEn = approved ? 'File approved' : 'File rejected';
          const titleFr = approved ? 'Fichier approuvé' : 'Fichier refusé';

          const messageAr = approved
            ? `تم قبول ملفك "\u202A${fileTitle}\u202C" ✅\u200F ${pointsTextAr}`
            : `تم رفض ملفك "\u202A${fileTitle}\u202C" ❌`;
          const messageEn = approved
            ? `Your file "\u202A${fileTitle}\u202C" has been approved ✅ ${pointsTextEn}`
            : `Your file "\u202A${fileTitle}\u202C" has been rejected ❌`;
          const messageFr = approved
            ? `Votre fichier "\u202A${fileTitle}\u202C" a été approuvé ✅ ${pointsTextFr}`
            : `Votre fichier "\u202A${fileTitle}\u202C" a été rejeté ❌`;

          const resolvedSecondaryAr = (typeof secondaryText_ar === 'string' && secondaryText_ar.trim() !== '')
            ? secondaryText_ar.trim()
            : (typeof commentAr === 'string' && commentAr.trim() !== '') ? commentAr.trim() : (comment || '');
          const resolvedSecondaryEn = (typeof secondaryText_en === 'string' && secondaryText_en.trim() !== '')
            ? secondaryText_en.trim()
            : (typeof commentEn === 'string' && commentEn.trim() !== '') ? commentEn.trim() : (comment || '');
          const resolvedSecondaryFr = (typeof secondaryText_fr === 'string' && secondaryText_fr.trim() !== '')
            ? secondaryText_fr.trim()
            : (typeof commentFr === 'string' && commentFr.trim() !== '') ? commentFr.trim() : (comment || '');

          const notificationData = {
            type: 'file_moderation',
            title: titleAr,
            title_ar: titleAr,
            title_en: titleEn,
            title_fr: titleFr,
            message: messageAr,
            message_ar: messageAr,
            message_en: messageEn,
            message_fr: messageFr,
            secondaryText: comment || resolvedSecondaryAr || resolvedSecondaryEn || resolvedSecondaryFr || '',
            secondaryText_ar: resolvedSecondaryAr || '',
            secondaryText_en: resolvedSecondaryEn || '',
            secondaryText_fr: resolvedSecondaryFr || '',
            fileId: id,
            fileTitle,
            approved,
            pointsDelta: pointsEarned,
            comment: comment || resolvedSecondaryAr || resolvedSecondaryEn || resolvedSecondaryFr || '',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            isRead: false,
          };

          const batch = db.batch();
          const notificationsRef = userRef.collection('notifications');
          const notifDocRef = notificationsRef.doc();
          batch.set(notifDocRef, { id: notifDocRef.id, ...notificationData });
          await batch.commit();
          console.log(`✅ Notification batch committed, docId=${notifDocRef.id}`);

          const deviceTokens = normalizeDeviceTokens(userData);
          if (Array.isArray(deviceTokens) && deviceTokens.length > 0) {
            const userLang = String(userData.language || userData.languageCode || 'ar').trim().toLowerCase();
            const effectiveLang = ['ar', 'en', 'fr'].includes(userLang) ? userLang : 'ar';
            const pushTitle = effectiveLang === 'ar' ? titleAr : effectiveLang === 'fr' ? titleFr : titleEn;
            const pushBody = effectiveLang === 'ar' ? messageAr : effectiveLang === 'fr' ? messageFr : messageEn;

            const multicastMessage = {
              tokens: deviceTokens,
              notification: {
                title: pushTitle,
                body: pushBody,
              },
              data: {
                fileId: id,
                approved: String(approved),
                title_ar: titleAr,
                title_en: titleEn,
                title_fr: titleFr,
                message_ar: messageAr,
                message_en: messageEn,
                message_fr: messageFr,
              },
              android: {
                priority: 'high',
                notification: {
                  channelId: 'high_importance_channel',
                  sound: 'default',
                  defaultSound: true,
                },
              },
              apns: {
                headers: {
                  'apns-priority': '10',
                },
                payload: {
                  aps: {
                    contentAvailable: true,
                    sound: 'default',
                  },
                },
              },
            };

            try {
              const multicastResponse = await sendMulticastMessage(multicastMessage);
              console.log(`✅ sendMulticast result: success=${multicastResponse.successCount} failure=${multicastResponse.failureCount}`);
              if (multicastResponse.failureCount > 0) {
                multicastResponse.responses.forEach((resp, index) => {
                  if (!resp.success) {
                    console.warn(`❌ FCM failure for token ${index}:`, resp.error?.message || resp.error);
                  }
                });
              }
            } catch (multicastError) {
              console.error('❌ sendMulticast failed:', multicastError?.message || multicastError);
            }
          } else {
            console.log('⚠️ No device tokens found for user');
          }
        } else {
          console.log(`❌ User document not found: ${userId}`);
        }
      } catch (notifError) {
        console.error('❌ Notification handling failed:', notifError?.message || notifError);
      }
    }

    res.json({ success: true, id, approved });
  } catch (error) {
    console.error('Moderation failed:', error);
    res.status(500).json({ error: 'Failed to moderate file.' });
  }
});



// =================================================================
//  نقاط عرض الملفات (دون تغيير)
// =================================================================

app.get('/files', (req, res) => {
  return res.status(200).json({
    message: 'File endpoint is ready. Provide an object key after /files/.',
  });
});

function getObjectKeyFromRequest(req) {
  const fromNamedParam = req.params.objectKey || '';
  const fromWildcardParam = req.params[0] || '';
  const rawValue = fromNamedParam || fromWildcardParam;
  return decodeURIComponent(rawValue).replace(/^\/+/, '');
}

async function resolveExistingObjectKey(requestedKey) {
  const exactKey = requestedKey.replace(/^\/+/, '');
  if (!exactKey) return null;
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: exactKey }));
    return exactKey;
  } catch (error) {
    if (!error || error.$metadata?.httpStatusCode !== 404) {
      if (error?.name !== 'NoSuchKey' && error?.name !== 'NotFound') throw error;
    }
  }
  const basename = path.basename(exactKey);
  const listResponse = await s3Client.send(
    new ListObjectsV2Command({ Bucket: R2_BUCKET_NAME, Prefix: `${R2_UPLOAD_PREFIX}/` })
  );
  const matches = (listResponse.Contents || [])
    .map(item => item.Key)
    .filter(Boolean)
    .filter(key => path.basename(key) === basename);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  const latestMatch = matches
    .map(key => {
      const entry = (listResponse.Contents || []).find(item => item.Key === key);
      return { key, lastModified: entry?.LastModified ? new Date(entry.LastModified).getTime() : 0 };
    })
    .sort((a, b) => b.lastModified - a.lastModified)[0];
  return latestMatch?.key || null;
}

app.get('/files/:objectKey(*)', async (req, res) => {
  try {
    const objectKey = getObjectKeyFromRequest(req);
    if (!objectKey) return res.status(400).json({ error: 'Missing object key.' });
    const resolvedKey = await resolveExistingObjectKey(objectKey);
    if (!resolvedKey) return res.status(404).json({ error: 'File not found.' });
    const command = new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: resolvedKey });
    const response = await s3Client.send(command);
    if (!response.Body) return res.status(404).json({ error: 'File not found.' });
    res.status(200);
    res.setHeader('Content-Type', response.ContentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(resolvedKey)}"`);
    if (typeof response.Body.transformToByteArray === 'function') {
      const bytes = await response.Body.transformToByteArray();
      return res.end(Buffer.from(bytes));
    }
    if (typeof response.Body.pipe === 'function') {
      return response.Body.pipe(res);
    }
    return res.end(response.Body);
  } catch (error) {
    console.error('File fetch failed:', error);
    return res.status(500).json({ error: 'Failed to fetch file from Cloudflare R2.', details: error.message });
  }
});

app.get('/files/*', async (req, res) => {
  try {
    const objectKey = getObjectKeyFromRequest(req);
    if (!objectKey) return res.status(400).json({ error: 'Missing object key.' });
    const resolvedKey = await resolveExistingObjectKey(objectKey);
    if (!resolvedKey) return res.status(404).json({ error: 'File not found.' });
    const command = new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: resolvedKey });
    const response = await s3Client.send(command);
    if (!response.Body) return res.status(404).json({ error: 'File not found.' });
    res.status(200);
    res.setHeader('Content-Type', response.ContentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(resolvedKey)}"`);
    if (typeof response.Body.transformToByteArray === 'function') {
      const bytes = await response.Body.transformToByteArray();
      return res.end(Buffer.from(bytes));
    }
    if (typeof response.Body.pipe === 'function') {
      return response.Body.pipe(res);
    }
    return res.end(response.Body);
  } catch (error) {
    console.error('File fetch failed:', error);
    return res.status(500).json({ error: 'Failed to fetch file from Cloudflare R2.', details: error.message });
  }
});

// -------------------- الصفحة الرئيسية --------------------
app.get('/', (req, res) => {
  res.json({ message: 'Cloudflare R2 upload backend is running.' });
});

// -------------------- تشغيل الخادم --------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log('📌 New API endpoints:');
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
// -------------------- جلب الملفات المعلقة للمراجعة --------------------
// Firestore composite index recommendation: reviewStatus ASC, createdAt DESC, __name__ ASC
// Required Firestore index URL:
// https://console.firebase.google.com/v1/r/project/hisabi-univ/firestore/indexes?create_composite=Cklwcm9qZWN0cy9oaXNhYmktdW5pdi9kYXRhYmFzZXMvKGRlZmF1bHQpL2NvbGxlY3Rpb25Hcm91cHMvZmlsZXMvaW5kZXhlcy9fEAEaEAoMcmV2aWV3U3RhdHVzEAEaDQoJY3JlYXRlZEF0EAIaDAoIX19uYW1lX18QAQ
app.get('/api/pending', async (req, res) => {
  try {
    const pageNum = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(req.query.limit || '20', 10) || 20, 1), 50);
    const queryKeyBase = 'pending';
    const cacheKey = `pending_page_${pageNum}_${limitNum}`;
    const cursorCacheKey = `pending_cursor_page_${pageNum}_${limitNum}`;
    const prevCursorCacheKey = pageNum > 1 ? `pending_cursor_page_${pageNum - 1}_${limitNum}` : null;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    let query = db.collection('files')
      .where('reviewStatus', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .orderBy('__name__');

    if (pageNum > 1 && prevCursorCacheKey) {
      const previousPageCursor = cache.get(prevCursorCacheKey);
      if (previousPageCursor) {
        query = query.startAfterDocument(previousPageCursor);
      } else {
        query = query.offset((pageNum - 1) * limitNum);
      }
    }

    const snapshot = await query.limit(limitNum).get();
    console.log(`📌 /api/pending read ${snapshot.size} pending docs for page=${pageNum} limit=${limitNum}`);

    const files = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if (snapshot.docs.length > 0) {
      cache.set(cursorCacheKey, snapshot.docs[snapshot.docs.length - 1]);
    }

    const maxCachedPages = 5;
    const cachedPagesKey = 'pending_cached_pages';
    const existingPaginationPages = cache.get(cachedPagesKey);
    const activePages = Array.isArray(existingPaginationPages)
      ? existingPaginationPages.map((p) => parseInt(p, 10)).filter((p) => !Number.isNaN(p))
      : [];

    if (!activePages.includes(pageNum)) {
      activePages.push(pageNum);
    }

    while (activePages.length > maxCachedPages) {
      const pageToRemove = activePages.shift();
      if (pageToRemove !== undefined) {
        const expiredCacheKey = `pending_page_${pageToRemove}_${limitNum}`;
        const expiredCursorKey = `pending_cursor_page_${pageToRemove}_${limitNum}`;
        cache.del(expiredCacheKey);
        cache.del(expiredCursorKey);
      }
    }

    cache.set(cachedPagesKey, activePages);

    const response = {
      files,
      page: pageNum,
      limit: limitNum,
      hasMore: snapshot.size === limitNum,
    };

    cache.set(cacheKey, response);
    res.json(response);
  } catch (error) {
    console.error('Error fetching pending files:', error);
    res.status(500).json({ error: 'Failed to fetch pending files.', details: error.message });
  }
});

// -------------------- تحديث بيانات ملف (Metadata) --------------------
app.patch('/api/files/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, subject, year, state, specialty, fileYear } = req.body;

    // 1. التحقق من وجود الملف
    const docRef = db.collection('files').doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'File not found.' });
    }

    // 2. بناء كائن التحديث (نضيف فقط الحقول المرسلة)
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

    // 3. تنفيذ التحديث في Firestore
    await docRef.update(updateData);

    // 4. مسح الكاش (لأن البيانات تغيرت)
    cache.flushAll();

    res.json({ success: true, id });
  } catch (error) {
    console.error('Update metadata failed:', error);
    res.status(500).json({ error: 'Failed to update metadata.' });
  }
});                                                                                                             