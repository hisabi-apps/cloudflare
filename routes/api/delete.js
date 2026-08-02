const express = require('express');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');

module.exports = function createDeleteRouter({ db, s3Client, R2_BUCKET_NAME, updateSubjectStats, cache }) {
  const router = express.Router();

  router.post('/', express.json(), async (req, res) => {
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

  return router;
};