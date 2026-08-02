const express = require('express');
const path = require('path');
const multer = require('multer');
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { shouldBlockDuplicateUpload } = require('../../duplicate_policy');
const { computeTextFingerprint, isTextLikeFile } = require('../../content_fingerprint');
const { buildExerciseFileDocument } = require('../../file_doc_builder');
const { findDuplicateBySignatureStore } = require('../../duplicate_signature_store');
const { findMatchingDuplicateInDocs } = require('../../duplicate_lookup');

const upload = multer({ storage: multer.memoryStorage() });

function computeFileHash(buffer) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function getOrComputeFileHash(docSnapshot, { db, R2_BUCKET_NAME, s3Client }) {
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
  const { db, s3Client, fileBuffer, fileName = '', mimeType = '', uploadedByUid = '', R2_BUCKET_NAME } = options;

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
      fileBuffer,
      fileName,
      mimeType,
      getOrComputeFileHash: async (doc) => getOrComputeFileHash(doc, { db, R2_BUCKET_NAME, s3Client }),
    });
    return match;
  } catch (error) {
    console.warn('⚠️ Fallback duplicate scan failed:', error.message || error);
  }

  return null;
}

module.exports = function createUploadRouter({ db, admin, s3Client, R2_BUCKET_NAME, R2_UPLOAD_PREFIX, buildObjectKey, buildPublicUrl, updateSubjectStats, cache }) {
  const router = express.Router();

  router.post('/', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
      }

      const subject = (req.body.subject || '').toString().trim();
      if (!subject) {
        return res.status(400).json({
          error: 'missing_subject',
          message: 'Subject is required.',
        });
      }

      const requestedType = (req.body.type || 'exercise').toString().trim().toLowerCase();
      const safeType = ['exercise', 'exam'].includes(requestedType) ? requestedType : 'exercise';
      const title = (req.body.title || path.parse(req.file.originalname).name).toString().trim();
      const uploadedByUid = (req.body.uploadedByUid || 'anonymous').toString();
      const requestedObjectKey = (req.body.objectKey || '').toString().trim();
      const fileBuffer = req.file.buffer;
      const fileHash = computeFileHash(fileBuffer);
      const skipDuplicateCheck = req.body.skipDuplicateCheck === 'true' || req.body.skipDuplicateCheck === true || req.body.skipDuplicateCheck === '1';
      const skipFileRecord =
        req.body.skipFileRecord === 'true' ||
        req.body.skipFileRecord === true ||
        req.body.skipFileRecord === '1';
      const objectKey = requestedObjectKey
        ? requestedObjectKey.replace(/^\/+/, '')
        : buildObjectKey(subject, title, req.file.originalname);
      const textFingerprint = isTextLikeFile(req.file.originalname, req.file.mimetype)
        ? computeTextFingerprint(fileBuffer.toString('utf8'))
        : '';

      const command = new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: objectKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype || 'application/octet-stream',
        ACL: 'public-read',
      });
      await s3Client.send(command);
      const publicUrl = buildPublicUrl(req, objectKey);

      let docRef = null;
      if (!skipFileRecord) {
        if (!skipDuplicateCheck) {
          try {
            const existingDuplicate = await findExistingDuplicate(fileHash, '', {
              db,
              s3Client,
              R2_BUCKET_NAME,
              fileBuffer: req.file.buffer,
              fileName: req.file.originalname,
              mimeType: req.file.mimetype,
              uploadedByUid,
            });
            if (existingDuplicate) {
              const existing = existingDuplicate.data() || {};
              const shouldBlock = shouldBlockDuplicateUpload({
                existingUploadedByUid: existing.uploadedByUid || '',
                currentUploadedByUid: uploadedByUid,
              });

              if (shouldBlock) {
                return res.status(409).json({
                  error: 'duplicate_file',
                  message: 'هذا الملف موجود مسبقاً بنفس المحتوى من نفس المستخدم.',
                  existingFileId: existingDuplicate.id,
                  existingTitle: existing.title || 'ملف مكرر',
                  duplicateMode: 'same_user_block',
                });
              }

              console.log(`ℹ️ Allowed duplicate upload for ${uploadedByUid} because the existing match belongs to a different uploader.`);
            }
          } catch (duplicateError) {
            console.warn('⚠️ Duplicate check failed; continuing upload.', duplicateError?.message || duplicateError);
          }
        }

        let isAdmin = false;
        let moderationReason = 'user_is_not_admin';
        if (uploadedByUid !== 'anonymous') {
          const userDoc = await db.collection('users').doc(uploadedByUid).get();
          if (userDoc.exists) {
            const userData = userDoc.data() || {};
            const role = (userData.role || '').toString().trim().toLowerCase();
            const canModerate =
              userData.canModerateExercises === true ||
              ['admin', 'moderator', 'owner'].includes(role);
            isAdmin = canModerate === true;
            moderationReason = isAdmin
              ? `user_has_role_${role || 'unknown'}`
              : `user_has_role_${role || 'unknown'}_but_not_moderator`;
          } else {
            moderationReason = 'user_not_found_in_firestore';
          }
        } else {
          moderationReason = 'anonymous_upload';
        }

        const optionalFields = {
          year: req.body.year,
          state: req.body.state,
          specialty: req.body.specialty,
          fileYear: req.body.fileYear,
          system: req.body.system,
          semester: req.body.semester,
        };
        const newFileDoc = buildExerciseFileDocument({
          subject,
          title,
          name: req.file.originalname,
          url: publicUrl,
          storagePath: objectKey,
          uploadedByUid,
          uploadedByEmail: req.body.uploadedByEmail || '',
          isApproved: isAdmin,
          reviewStatus: isAdmin ? 'approved' : 'pending',
          fileHash,
          textFingerprint,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          type: safeType,
          optionalFields,
        });

        console.log(`[upload] file=${title} type=${safeType} subject=${subject} uploadedBy=${uploadedByUid} reviewStatus=${newFileDoc.reviewStatus} isApproved=${newFileDoc.isApproved} reason=${moderationReason} storedType=${newFileDoc.type}`);

        docRef = await db.collection('files').add(newFileDoc);

        if (docRef && fileHash) {
          await db.collection('file_signatures').doc(fileHash).set(
            {
              fileHash,
              relatedFileIds: admin.firestore.FieldValue.arrayUnion(docRef.id),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }

        if (uploadedByUid && uploadedByUid !== 'anonymous') {
          const userRef = db.collection('users').doc(uploadedByUid);
          const pendingDelta = newFileDoc.isApproved ? 0 : 1;
          const approvedDelta = newFileDoc.isApproved ? 1 : 0;
          const rejectedDelta = 0;

          await userRef.set(
            {
              totalUploads: admin.firestore.FieldValue.increment(1),
              approvedFiles: admin.firestore.FieldValue.increment(approvedDelta),
              rejectedFiles: admin.firestore.FieldValue.increment(rejectedDelta),
              pendingFiles: admin.firestore.FieldValue.increment(pendingDelta),
              lastUploadUpdate: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }

        if (docRef && newFileDoc.isApproved) {
          updateSubjectStats(newFileDoc).catch((statsError) => {
            console.error('⚠️ subject_stats update failed during upload:', statsError.message || statsError);
          });
        }
      }

      cache.flushAll();

      return res.status(201).json({
        success: true,
        id: docRef?.id || null,
        url: publicUrl,
        objectKey,
        skippedFileRecord: skipFileRecord,
        type: safeType,
        reviewStatus: skipFileRecord ? null : (docRef ? 'pending' : null),
      });
    } catch (error) {
      console.error('Upload failed:', error);
      return res.status(500).json({
        error: 'Failed to upload file to Cloudflare R2.',
        details: error.message || String(error),
      });
    }
  });

  return router;
};