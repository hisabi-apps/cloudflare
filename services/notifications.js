const { parseBooleanLike, resolveNotificationMetadata } = require('../utils/validators');

function createNotificationService({ admin, db }) {
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

  return {
    resolveNotificationMetadata,
    getLocalizedField,
    persistAdminNotificationToUsers,
  };
}

module.exports = {
  createNotificationService,
  parseBooleanLike,
};
