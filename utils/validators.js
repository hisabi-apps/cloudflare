function parseBooleanLike(value) {
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

  const isImportant = parseBooleanLike(clientData.isImportant ?? requestBody?.isImportant);

  return {
    category,
    notificationType,
    isImportant,
  };
}

function normalizeDeviceTokens(userData) {
  const tokens = [];
  if (Array.isArray(userData?.deviceTokens)) {
    userData.deviceTokens
      .filter((token) => typeof token === 'string' && token.trim() !== '')
      .forEach((token) => tokens.push(token.trim()));
  }

  const fallbackTokenFields = ['fcmToken', 'messagingToken', 'token'];
  fallbackTokenFields.forEach((fieldName) => {
    const value = userData?.[fieldName];
    if (typeof value === 'string' && value.trim() !== '') {
      tokens.push(value.trim());
    }
  });

  return [...new Set(tokens)];
}

function createDeviceTokenService({ admin, db }) {
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

  return {
    normalizeDeviceTokens,
    removeInvalidDeviceToken,
  };
}

module.exports = {
  parseBooleanLike,
  normalizeDeviceTokens,
  createDeviceTokenService,
  resolveNotificationMetadata,
};
