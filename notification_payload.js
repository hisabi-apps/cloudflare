function buildLocalizedFcmPayload({
  title,
  body,
  data = {},
  attachmentImageUrl = '',
  notificationIconUrl = '',
}) {
  const defaultData = {
    notificationType: data.notificationType || 'admin_message',
    category: data.category || 'general',
    target: data.target || 'all',
    sentBatchId: data.sentBatchId || '',
    topicName: data.topicName || '',
  };

  const finalData = {
    ...defaultData,
    ...data,
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
    Object.entries(data)
      .filter(([key]) => key === 'title_ar' || key === 'title_en' || key === 'title_fr')
      .map(([key, value]) => [`title_${key.split('_').pop()}`, value]),
  );
  const localizedBodyData = Object.fromEntries(
    Object.entries(data)
      .filter(([key]) => key === 'body_ar' || key === 'body_en' || key === 'body_fr')
      .map(([key, value]) => [`body_${key.split('_').pop()}`, value]),
  );

  return {
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
        title_loc_key: 'notification_title',
        title_loc_args: [],
        body_loc_key: 'notification_body',
        body_loc_args: [body.trim()],
        ...(attachmentImageUrl ? { image: attachmentImageUrl } : {}),
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
          alert: {
            'title-loc-key': 'notification_title',
            'title-loc-args': [],
            'loc-key': 'notification_body',
            'loc-args': [body.trim()],
          },
        },
      },
    },
  };
}

module.exports = {
  buildLocalizedFcmPayload,
};
