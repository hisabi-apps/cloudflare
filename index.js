const path = require('path');
require('dotenv').config({
  path: path.resolve(__dirname, '..', '.env'),
});

const express = require('express');
const multer = require('multer');
const NodeCache = require('node-cache');
const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');

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
  const category = typeof requestBody?.category === 'string' && requestBody.category.trim() !== ''
    ? requestBody.category.trim()
    : 'general';
  const isImportant = Boolean(requestBody?.isImportant);
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
    secondaryText_ar: typeof requestBody?.secondaryText_ar === 'string' && requestBody.secondaryText_ar.trim() !== '' ? requestBody.secondaryText_ar.trim() : '',
    secondaryText_en: typeof requestBody?.secondaryText_en === 'string' && requestBody.secondaryText_en.trim() !== '' ? requestBody.secondaryText_en.trim() : '',
    secondaryText_fr: typeof requestBody?.secondaryText_fr === 'string' && requestBody.secondaryText_fr.trim() !== '' ? requestBody.secondaryText_fr.trim() : '',
    linkText_ar: typeof requestBody?.linkText_ar === 'string' && requestBody.linkText_ar.trim() !== '' ? requestBody.linkText_ar.trim() : '',
    linkText_en: typeof requestBody?.linkText_en === 'string' && requestBody.linkText_en.trim() !== '' ? requestBody.linkText_en.trim() : '',
    linkText_fr: typeof requestBody?.linkText_fr === 'string' && requestBody.linkText_fr.trim() !== '' ? requestBody.linkText_fr.trim() : '',
    summary: typeof requestBody?.summary === 'string' ? requestBody.summary.trim() : '',
    secondaryText: typeof requestBody?.secondaryText === 'string' ? requestBody.secondaryText.trim() : '',
    linkText: typeof requestBody?.linkText === 'string' ? requestBody.linkText.trim() : '',
    linkUrl,
    inlineLinks,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    isRead: false,
    type: 'admin_message',
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

    const defaultData = {
      notificationType: clientData.notificationType || 'admin_message',
      category: clientData.category || 'general',
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

    console.log(`✅ Admin FCM completed: totalTokens=${totalTokens}, totalSuccess=${totalSuccess}`);
    return res.json({
      success: true,
      recipients: uniqueRecipientUids.length,
      topic: topicName,
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
const cache = new NodeCache({ stdTTL: 120, checkperiod: 130 });

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

// -------------------- نقطة الحذف (دون تغيير مع إضافة مسح الكاش) --------------------
app.post('/delete', express.json(), async (req, res) => {
  try {
    const objectKey = (req.body.objectKey || '').toString().trim();
    if (!objectKey) {
      return res.status(400).json({ error: 'Missing object key.' });
    }
    const command = new DeleteObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: objectKey.replace(/^\/+/, ''),
    });
    await s3Client.send(command);
    cache.flushAll();
    return res.status(200).json({ success: true, objectKey });
  } catch (error) {
    console.error('Delete failed:', error);
    return res.status(500).json({
      error: 'Failed to delete file from Cloudflare R2.',
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
    const skipFileRecord =
      req.body.skipFileRecord === 'true' ||
      req.body.skipFileRecord === true ||
      req.body.skipFileRecord === '1';
    const objectKey = requestedObjectKey
      ? requestedObjectKey.replace(/^\/+/, '')
      : buildObjectKey(subject, title, req.file.originalname);

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
      const newFileDoc = {
        subject: subject.trim(),
        title: title.trim(),
        name: req.file.originalname,
        url: publicUrl,
        storagePath: objectKey,
        storageType: 'cloudflare-r2',
        isApproved: isAdmin,
        reviewStatus: isAdmin ? 'approved' : 'pending',
        uploadedByUid,
        uploadedByEmail: req.body.uploadedByEmail || '',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // إضافة الحقول الاختيارية
      const optionalFields = ['year', 'state', 'specialty', 'fileYear', 'system', 'semester'];
      for (const field of optionalFields) {
        if (req.body[field]) {
          const trimmedValue = req.body[field].trim();
          newFileDoc[field] = trimmedValue;
          if (field === 'specialty') {
            newFileDoc.specialtyNormalized = normalizeText(trimmedValue);
          }
        }
      }

      docRef = await db.collection('files').add(newFileDoc);
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

// 1. جلب قائمة المواد مع عدد الملفات (مع الفلاتر والـ Cache)
app.get('/api/subjects', async (req, res) => {
  try {
    const { year, state, specialty, fileYear, fileYearFrom, fileYearTo } = req.query;
    const cacheKey = `subjects_${year || 'all'}_${state || 'all'}_${specialty || 'all'}_${fileYear || fileYearFrom || 'all'}_${fileYearTo || 'all'}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    let query = db.collection('files').where('isApproved', '==', true);
    if (year) query = query.where('year', '==', year);
    if (state) query = query.where('state', '==', state);
    if (fileYear) query = query.where('fileYear', '==', fileYear);
    if (fileYearFrom) query = query.where('fileYear', '>=', fileYearFrom);
    if (fileYearTo) query = query.where('fileYear', '<=', fileYearTo);

    const snapshot = await query.get();
    const normalizedSpecialty = specialty ? normalizeText(specialty) : null;
    const subjectMap = new Map();
    snapshot.forEach(doc => {
      const data = doc.data();
      const specialtyValue = (data.specialty || '').toString();
      if (normalizedSpecialty && normalizeText(specialtyValue) !== normalizedSpecialty) {
        return;
      }

      const subject = data.subject || 'عام';
      const specialty = specialtyValue.trim();
      if (!subjectMap.has(subject)) {
        subjectMap.set(subject, { count: 0, specialties: new Set() });
      }

      const subjectEntry = subjectMap.get(subject);
      subjectEntry.count += 1;
      if (specialty) {
        subjectEntry.specialties.add(specialty);
      }
    });

    const result = Array.from(subjectMap.entries()).map(([subject, info]) => ({
      subject,
      count: info.count,
      specialties: Array.from(info.specialties).sort(),
    }));

    cache.set(cacheKey, result);
    res.json(result);
  } catch (error) {
    console.error('Error fetching subjects:', error);
    res.status(500).json({ error: 'Failed to fetch subjects.' });
  }
});

// 2. جلب ملفات مادة معينة (مع Pagination والـ Cache)
app.get('/api/files', async (req, res) => {
  try {
    const { subject, year, state, specialty, fileYear, fileYearFrom, fileYearTo, page = 1, limit = 20 } = req.query;
    if (!subject) {
      return res.status(400).json({ error: 'Subject is required.' });
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    const cacheKey = `files_${subject}_${year || 'all'}_${state || 'all'}_${specialty || 'all'}_${fileYear || fileYearFrom || 'all'}_${fileYearTo || 'all'}_${pageNum}_${limitNum}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    let query = db.collection('files')
      .where('subject', '==', subject)
      .where('isApproved', '==', true);

    if (year) query = query.where('year', '==', year);
    if (state) query = query.where('state', '==', state);
    if (fileYear) query = query.where('fileYear', '==', fileYear);
    const hasFileYearRange = fileYearFrom || fileYearTo;
    if (fileYearFrom) query = query.where('fileYear', '>=', fileYearFrom);
    if (fileYearTo) query = query.where('fileYear', '<=', fileYearTo);

    if (hasFileYearRange) {
      query = query.orderBy('fileYear');
    }

    // الترتيب حسب الأحدث ثم Pagination باستخدام offset
    const snapshot = await query
      .orderBy('createdAt', 'desc')
      .offset(offset)
      .limit(limitNum)
      .get();

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

    cache.set(cacheKey, files);
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
    const { approved, comment, pointsDelta } = req.body;

    if (typeof approved !== 'boolean') {
      return res.status(400).json({ error: 'Approved status is required (boolean).' });
    }

    const docRef = db.collection('files').doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'File not found.' });
    }

    const fileData = doc.data();
    const userId = fileData?.uploadedByUid; // ✅ استخدام uploadedByUid (المفتاح الصحيح)
    const fileTitle = fileData?.title || 'ملف';

    console.log(`📝 Moderating file ${id}: approved=${approved}, userId=${userId}`);

    const updateData = {
      isApproved: approved,
      reviewStatus: approved ? 'approved' : 'rejected',
      moderationComment: comment || '',
      moderatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await docRef.update(updateData);
    cache.flushAll();

    // تحديث نقاط المستخدم عند قبول الملف
    if (approved && typeof pointsDelta === 'number' && pointsDelta != 0 && userId) {
      try {
        const userRef = db.collection('users').doc(userId);
        await userRef.set(
          {
            points: admin.firestore.FieldValue.increment(pointsDelta),
            lastPointsUpdate: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        const userStatsRef = userRef.collection('stats').doc('profile');
        await userStatsRef.set(
          {
            points: admin.firestore.FieldValue.increment(pointsDelta),
          },
          { merge: true },
        );
        console.log(`✅ Added ${pointsDelta} points for user ${userId}`);
      } catch (pointsError) {
        console.error(`⚠️ Failed to update points for user ${userId}:`, pointsError.message);
      }
    }

    // إرسال إشعار للمستخدم عند الموافقة أو الرفض
    if (userId) {
      try {
        console.log(`🔔 Getting user document for ${userId}`);
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        
        if (userDoc.exists) {
          const userData = userDoc.data() || {};
          console.log(`👤 User found: ${userId}, has deviceTokens: ${!!userData.deviceTokens}`);
          const pointsEarned = approved && typeof pointsDelta === 'number' ? pointsDelta : 0;
          const pointsText = approved && pointsEarned > 0 ? ` +${pointsEarned} نقطة${pointsEarned == 1 ? '' : 'ات'}` : '';
          const notificationMessage = approved
            ? `تم قبول ملفك "${fileTitle}" ✅${pointsText}`
            : `تم رفض ملفك "${fileTitle}" ❌`;
          
          const notificationData = {
            type: 'file_moderation',
            title: approved ? 'ملف مقبول' : 'ملف مرفوض',
            message: notificationMessage,
            secondaryText: comment || '',
            fileId: id,
            fileTitle: fileTitle,
            approved: approved,
            pointsDelta: pointsEarned,
            comment: comment || '',
            // Use `createdAt` and `isRead` to match the Flutter client expectations
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            // keep legacy timestamp too for compatibility
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            isRead: false,
          };

          // حفظ الإشعار في Firestore
          const notificationsRef = db.collection('users').doc(userId).collection('notifications');
          const notifDocRef = notificationsRef.doc();
          await notifDocRef.set({
            id: notifDocRef.id,
            ...notificationData,
          });
          console.log(`✅ Notification saved in Firestore: ${notifDocRef.id}`);

          // محاولة إرسال FCM notification إذا كان هناك device token
          const deviceTokens = normalizeDeviceTokens(userData);
          console.log(`📱 Device tokens count: ${deviceTokens.length}`);
          
          if (Array.isArray(deviceTokens) && deviceTokens.length > 0) {
            const messages = deviceTokens.map(token => ({
              token,
              notification: {
                title: approved ? 'ملف مقبول' : 'ملف مرفوض',
                body: notificationMessage,
              },
              data: {
                fileId: id,
                approved: approved.toString(),
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
            }));

            const fcmResults = await Promise.allSettled(
              messages.map(msg =>
                admin.messaging().send(msg)
              )
            );

            fcmResults.forEach((result, index) => {
              if (result.status === 'fulfilled') {
                console.log(`✅ FCM sent for token ${index + 1}/${messages.length}`);
              } else {
                console.log(`❌ FCM failed for token ${index + 1}: ${result.reason?.message}`);
              }
            });
          } else {
            console.log('⚠️ No device tokens found for user');
          }
        } else {
          console.log(`❌ User document not found: ${userId}`);
        }
      } catch (notifError) {
        console.error('❌ Failed to send notification:', notifError.message);
        // لا نوقف العملية إذا فشل الإشعار
      }
    } else {
      console.log('❌ No userId found in file data');
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
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log('📌 New API endpoints:');
  console.log('  GET  /api/subjects?year=&state=&specialty=&fileYear=');
  console.log('  GET  /api/files?subject=...&page=1&limit=20');
  console.log('  PATCH /api/moderate/:id');
});
// -------------------- جلب الملفات المعلقة للمراجعة --------------------
app.get('/api/pending', async (req, res) => {
  try {
    // نهمل الكاش تمامًا لجلب البيانات الطازجة مباشرة من Firestore
    const snapshot = await db.collection('files')
      .where('reviewStatus', '==', 'pending')
      .get();

    const pendingFiles = [];
    snapshot.forEach(doc => {
      pendingFiles.push({
        id: doc.id,
        ...doc.data(),
      });
    });

    pendingFiles.sort((a, b) => {
      const aCreated = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const bCreated = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return bCreated - aCreated;
    });

    res.json(pendingFiles);
  } catch (error) {
    console.error('Error fetching pending files:', error);
    res.status(500).json({ error: 'Failed to fetch pending files.' });
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
    if (subject !== undefined) updateData.subject = subject.trim();
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