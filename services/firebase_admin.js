const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');

function createFirebaseAdminService({ admin, db, serviceAccount, axiosClient = axios }) {
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
      const response = await axiosClient.post(
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
      if (res && typeof res.status === 'function') {
        res.status(401).json({ error: 'Unauthorized request.' });
      }
      return null;
    }

    const idToken = authHeader.split(' ')[1];
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch (tokenError) {
      console.error('⚠️ Invalid auth token in admin request:', tokenError);
      if (res && typeof res.status === 'function') {
        res.status(401).json({ error: 'Unauthorized request.' });
      }
      return null;
    }

    const currentUid = decodedToken?.uid;
    if (!currentUid) {
      if (res && typeof res.status === 'function') {
        res.status(401).json({ error: 'Unauthorized request.' });
      }
      return null;
    }

    const senderDoc = await db.collection('users').doc(currentUid).get();
    const senderEmail = decodedToken.email || '';
    const senderData = senderDoc.exists ? senderDoc.data() : null;
    if (!senderDoc.exists || !isAdminUserData(senderData, senderEmail)) {
      if (res && typeof res.status === 'function') {
        res.status(403).json({ error: 'Not authorized.' });
      }
      return null;
    }

    return { uid: currentUid, userData: senderData, authorized: true, senderUid: currentUid, senderEmail };
  }

  return {
    sendFcmViaHttp,
    sendFcmWithFallback,
    normalizeRecipientData,
    sendMulticastMessage,
    isAdminUserData,
    verifyAdminRequest,
  };
}

module.exports = {
  createFirebaseAdminService,
};
