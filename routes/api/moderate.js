const express = require('express');
const { parseBooleanLike, normalizeDeviceTokens } = require('../../utils/validators');

module.exports = function createModerateRouter({ db, admin, sendMulticastMessage, updateSubjectStatsTransaction, getLocalizedField, cache }) {
  const router = express.Router();

  router.patch('/:id', async (req, res) => {
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

      const moderationComment = comment || commentAr || commentEn || commentFr || '';

      await db.runTransaction(async (transaction) => {
        const fileSnapshot = await transaction.get(docRef);
        if (!fileSnapshot.exists) {
          throw new Error('File not found.');
        }

        const previousFileData = fileSnapshot.data() || {};
        const previousReviewStatus = (previousFileData.reviewStatus || '').toString().trim().toLowerCase();
        const wasApproved = previousFileData.isApproved === true;
        const willBeApproved = approved === true;
        const willBeRejected = approved === false;

        transaction.update(docRef, {
          isApproved: approved,
          reviewStatus: approved ? 'approved' : 'rejected',
          moderationComment,
          pointsDelta: parsedPointsDelta,
          pointsAwarded: approved ? parsedPointsDelta : 0,
          withCorrection: Boolean(withCorrection),
          moderatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        if (userId) {
          const userRef = db.collection('users').doc(userId);
          const moderationUpdate = {
            lastModerationUpdate: admin.firestore.FieldValue.serverTimestamp(),
          };

          if (willBeApproved && !wasApproved) {
            moderationUpdate.approvedFiles = admin.firestore.FieldValue.increment(1);
            if (previousReviewStatus === 'pending') {
              moderationUpdate.pendingFiles = admin.firestore.FieldValue.increment(-1);
            } else if (previousReviewStatus === 'rejected') {
              moderationUpdate.rejectedFiles = admin.firestore.FieldValue.increment(-1);
            }
          }

          if (willBeRejected && wasApproved) {
            moderationUpdate.approvedFiles = admin.firestore.FieldValue.increment(-1);
            moderationUpdate.rejectedFiles = admin.firestore.FieldValue.increment(1);
          }

          if (willBeRejected && previousReviewStatus === 'pending') {
            moderationUpdate.rejectedFiles = admin.firestore.FieldValue.increment(1);
            moderationUpdate.pendingFiles = admin.firestore.FieldValue.increment(-1);
          }

          if (willBeApproved && previousReviewStatus === 'pending') {
            moderationUpdate.approvedFiles = admin.firestore.FieldValue.increment(1);
            moderationUpdate.pendingFiles = admin.firestore.FieldValue.increment(-1);
          }

          transaction.set(userRef, moderationUpdate, { merge: true });

          if (approved && parsedPointsDelta !== 0) {
            transaction.set(
              userRef,
              {
                points: admin.firestore.FieldValue.increment(parsedPointsDelta),
                lastPointsUpdate: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true },
            );

            transaction.set(
              userRef.collection('stats').doc('profile'),
              {
                points: admin.firestore.FieldValue.increment(parsedPointsDelta),
              },
              { merge: true },
            );
          }

          const subjectStatsDelta = willBeApproved && !wasApproved
            ? 1
            : willBeRejected && wasApproved
              ? -1
              : 0;

          if (subjectStatsDelta !== 0) {
            await updateSubjectStatsTransaction(previousFileData, subjectStatsDelta, transaction);
          }
        }
      });

      cache.flushAll();

      if (userId) {
        try {
          const userRef = db.collection('users').doc(userId);
          const userDoc = await userRef.get();
          if (userDoc.exists) {
            const userData = userDoc.data() || {};
            const pointsEarned = approved && !Number.isNaN(parsedPointsDelta) ? parsedPointsDelta : 0;
            const pointsTextAr = approved && pointsEarned > 0 ? ` +${pointsEarned} ⭐` : '';
            const pointsTextEn = approved && pointsEarned > 0 ? ` +${pointsEarned} ⭐` : '';
            const pointsTextFr = approved && pointsEarned > 0 ? ` +${pointsEarned} ⭐` : '';

            const titleAr = approved ? 'ملف مقبول' : 'ملف مرفوض';
            const titleEn = approved ? 'File approved' : 'File rejected';
            const titleFr = approved ? 'Fichier approuvé' : 'Fichier refusé';
            const subjectName = (fileData.subject || '').toString().trim();
            const subjectLabel = subjectName ? ` - ${subjectName}` : '';

            const messageAr = approved
              ? `تم قبول ملفك "\u202A${fileTitle}\u202C"${subjectLabel} ✅\u200F ${pointsTextAr}`
              : `تم رفض ملفك "\u202A${fileTitle}\u202C"${subjectLabel} ❌`;
            const messageEn = approved
              ? `Your file "\u202A${fileTitle}\u202C"${subjectLabel} has been approved ✅ ${pointsTextEn}`
              : `Your file "\u202A${fileTitle}\u202C"${subjectLabel} has been rejected ❌`;
            const messageFr = approved
              ? `Votre fichier "\u202A${fileTitle}\u202C"${subjectLabel} a été approuvé ✅ ${pointsTextFr}`
              : `Votre fichier "\u202A${fileTitle}\u202C"${subjectLabel} a été rejeté ❌`;

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

  return router;
};