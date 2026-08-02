const express = require('express');
const multer = require('multer');
const { findDuplicateBySignatureStore } = require('../../duplicate_signature_store');
const { findMatchingDuplicateInDocs } = require('../../duplicate_lookup');

const upload = multer({ storage: multer.memoryStorage() });

function computeFileHash(buffer) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function getOrComputeFileHash(docSnapshot, { db, R2_BUCKET_NAME, s3Client }) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const data = docSnapshot.data() || {};
  const existingHash = typeof data.fileHash === 'string' ? data.fileHash.trim() : '';
  if (existingHash) {
    return existingHash;
  }

  const objectKey = typeof data.storagePath === 'string' ? data.storagePath.trim() : '';
  if (!objectKey) {
    return '';
  }

  try {
    const command = new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: objectKey.replace(/^\/+/, '') });
    const response = await s3Client.send(command);
    const body = response.Body;
    if (!body) {
      return '';
    }

    const chunks = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const buffer = Buffer.concat(chunks);
    const hash = computeFileHash(buffer);
    await docSnapshot.ref.set({ fileHash: hash }, { merge: true });
    return hash;
  } catch (error) {
    console.warn(`⚠️ Failed to compute hash for ${objectKey}:`, error.message || error);
    return '';
  }
}

module.exports = function createCheckDuplicatesRouter({ db, s3Client, R2_BUCKET_NAME }) {
  const router = express.Router();

  router.post('/', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
      }

      const fileHash = computeFileHash(req.file.buffer);
      const matches = [];

      try {
        const signatureMatch = await findDuplicateBySignatureStore({
          fileHash,
          currentFileId: (req.body.currentFileId || '').toString().trim(),
          getSignatureDoc: async () => db.collection('file_signatures').doc(fileHash).get(),
          getFileDoc: async (docId) => db.collection('files').doc(docId).get(),
        });

        if (signatureMatch) {
          const data = signatureMatch.data() || {};
          matches.push({
            id: signatureMatch.id,
            title: data.title || '',
            subject: data.subject || '',
            name: data.name || '',
            uploadedByUid: data.uploadedByUid || '',
            reviewStatus: data.reviewStatus || '',
            fileHash: data.fileHash || fileHash,
          });
        }
      } catch (error) {
        console.warn('⚠️ Duplicate preview lookup failed:', error.message || error);
      }

      return res.status(200).json(matches);
    } catch (error) {
      console.error('Duplicate check failed:', error);
      return res.status(500).json({
        error: 'Failed to check duplicates.',
        details: error.message || String(error),
      });
    }
  });

  return router;
};