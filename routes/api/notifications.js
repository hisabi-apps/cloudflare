const express = require('express');
const { createDeviceTokenService } = require('../../utils/validators');

module.exports = function createNotificationsRouter({ admin, db }) {
  const router = express.Router();
  const { normalizeDeviceTokens, removeInvalidDeviceToken } = createDeviceTokenService({ admin, db });

  router.post('/mark-opened', async (req, res) => {
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

  return router;
};