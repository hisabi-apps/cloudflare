const express = require('express');

module.exports = function createAdminSendFcmRouter({ admin, db, isAdminUserData, normalizeRecipientData, persistAdminNotificationToUsers, resolveNotificationMetadata, getLocalizedField, sendFcmWithFallback, sendMulticastMessage, normalizeDeviceTokens, removeInvalidDeviceToken }) {
  const router = express.Router();

  router.post('/', async (req, res) => {
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
      const title = requestBody.title;
      const body = requestBody.body;
      const recipients = requestBody.recipients;
      const recipientsData = requestBody.recipientsData;
      const topic = typeof requestBody.topic === 'string' ? requestBody.topic.trim() : '';
      const attachmentImageUrl = typeof requestBody.attachmentImageUrl === 'string' ? requestBody.attachmentImageUrl.trim() : '';
      const notificationIconUrl = typeof requestBody.notificationIconUrl === 'string' ? requestBody.notificationIconUrl.trim() : '';
      const hasTopicTarget = topic.length > 0;
      const hasRecipientsData = Array.isArray(recipientsData) && recipientsData.length > 0;
      const hasRecipients = hasRecipientsData || (Array.isArray(recipients) && recipients.length > 0);

      console.log(`📨 Received FCM request: title="${title}", body="${body}", topic="${topic}", recipients=${Array.isArray(recipients) ? recipients.length : 0}, recipientsData=${hasRecipientsData ? recipientsData.length : 0}`);

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

      const recipientsToPersist = hasTopicTarget && topic === 'all_users'
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
          topicName: topic,
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

      const clientData = requestBody.data || {};
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
        localizedTitleEntries.map(([key, value]) => [`title_${key.split('_').pop()}`, value]),
      );
      const localizedBodyData = Object.fromEntries(
        localizedBodyEntries.map(([key, value]) => [`body_${key.split('_').pop()}`, value]),
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

      if (attachmentImageUrl) {
        console.log(`📸 Android notification with image: ${attachmentImageUrl}`);
      }

      if (hasTopicTarget) {
        try {
          const topicMessage = {
            ...messagePayload,
            topic,
          };

          console.log(`📤 Sending topic message to '${topic}'`);
          console.log(`📋 Payload: ${JSON.stringify(topicMessage)}`);

          const fallbackResult = await sendFcmWithFallback(topicMessage, `topic:${topic}`);
          totalSuccess += 1;
          details.push({
            topic,
            success: true,
            messageId: fallbackResult.response,
            channel: fallbackResult.channel,
          });
          console.log(`✅ Topic FCM sent to '${topic}' via ${fallbackResult.channel}: ${fallbackResult.response}`);
        } catch (sendError) {
          console.error(`❌ Failed to send topic FCM to '${topic}':`, sendError?.message || sendError);
          details.push({ topic, status: 'send_error', error: String(sendError) });
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
              console.error(`❌ Failed to send multicast admin FCM for ${recipientUid || 'unknown recipient'}:`, errorMessage);
              details.push({ recipientUid, status: 'send_error', error: errorMessage });
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
                console.error(`❌ Failed to send admin FCM for user ${recipientUid} token:`, errorMessage);
                details.push({ recipientUid, token, status: 'send_error', error: errorMessage });

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
            console.error(`❌ Failed to send admin FCM for user ${recipientUid}:`, sendError?.message || sendError);
            details.push({ recipientUid, status: 'send_error', error: String(sendError) });
          }
        }
      }

      const persistedCount = recipientsToPersist.length;
      console.log(`✅ Admin FCM completed: totalTokens=${totalTokens}, totalSuccess=${totalSuccess}, persistedCount=${persistedCount}`);
      return res.json({
        success: true,
        recipients: uniqueRecipientUids.length,
        topic,
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

  return router;
};