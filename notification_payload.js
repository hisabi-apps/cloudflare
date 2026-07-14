function buildNotificationMessagePayload({
  title,
  body,
  localizedTitleEntries = [],
  localizedBodyEntries = [],
  sanitizedData = {},
  attachmentImageUrl = '',
  notificationIconUrl = '',
}) {
  const localizedTitleData = Object.fromEntries(
    localizedTitleEntries.map(([key, value]) => [`title_${key.split('_').pop()}`, value]),
  );
  const localizedBodyData = Object.fromEntries(
    localizedBodyEntries.map(([key, value]) => [`body_${key.split('_').pop()}`, value]),
  );

  const topLevelNotificationData = {
    ...(attachmentImageUrl ? { attachmentImageUrl } : {}),
    ...(attachmentImageUrl ? { imageUrl: attachmentImageUrl } : {}),
    ...(notificationIconUrl ? { notificationIconUrl } : {}),
  };

  return {
    notification: {
      title: title?.trim() || '',
      body: body?.trim() || '',
    },
    data: {
      title: title?.trim() || '',
      body: body?.trim() || '',
      ...localizedTitleData,
      ...localizedBodyData,
      ...sanitizedData,
      ...topLevelNotificationData,
    },
    android: {
      priority: 'high',
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
}

module.exports = {
  buildNotificationMessagePayload,
};
