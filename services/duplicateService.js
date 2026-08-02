const { findDuplicateBySignatureStore } = require('../duplicate_signature_store');
const { findMatchingDuplicateInDocs } = require('../duplicate_lookup');

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

async function findExistingDuplicate(fileHash, currentFileId = '', options = {}) {
  const { db, s3Client } = options;
  try {
    const signatureDoc = await db.collection('file_signatures').doc(fileHash).get();
    const signatureMatch = await findDuplicateBySignatureStore({
      fileHash,
      currentFileId,
      getSignatureDoc: async () => signatureDoc,
      getFileDoc: async (docId) => db.collection('files').doc(docId).get(),
    });

    if (signatureMatch) {
      return signatureMatch;
    }
  } catch (error) {
    console.warn('⚠️ Signature-store duplicate lookup failed, falling back to direct scan:', error.message || error);
  }

  try {
    const fastQuery = await db.collection('files')
      .where('fileHash', '==', fileHash)
      .limit(1)
      .get();

    if (!fastQuery.empty) {
      const doc = fastQuery.docs[0];
      if ((currentFileId || '').toString().trim() !== doc.id) {
        return doc;
      }
      console.log('ℹ️ Found fileHash match for currentFileId, continuing to fallback scan');
    }
  } catch (error) {
    console.warn('⚠️ Fast duplicate lookup failed, falling back to limited scan:', error.message || error);
  }

  try {
    const fallbackSnapshot = await db.collection('files').limit(20).get();
    const match = await findMatchingDuplicateInDocs({
      docs: fallbackSnapshot.docs,
      fileHash,
      currentFileId,
      fileBuffer: options.fileBuffer,
      fileName: options.fileName,
      mimeType: options.mimeType,
      getOrComputeFileHash: async (doc) => getOrComputeFileHash(doc, options),
    });
    return match;
  } catch (error) {
    console.warn('⚠️ Fallback duplicate scan failed:', error.message || error);
  }

  return null;
}

module.exports = {
  computeFileHash,
  getOrComputeFileHash,
  findExistingDuplicate,
};
