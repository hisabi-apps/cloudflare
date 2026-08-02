const path = require('path');
const { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

function createFileService({ s3Client, R2_BUCKET_NAME, R2_UPLOAD_PREFIX }) {
  function getObjectKeyFromRequest(req) {
    const fromNamedParam = req.params.objectKey || '';
    const fromWildcardParam = req.params[0] || '';
    const rawValue = fromNamedParam || fromWildcardParam;
    return decodeURIComponent(rawValue).replace(/^\/+/, '');
  }

  async function resolveExistingObjectKey(requestedKey) {
    const exactKey = requestedKey.replace(/^\/+/, '');
    if (!exactKey) return null;

    try {
      await s3Client.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: exactKey }));
      return exactKey;
    } catch (error) {
      if (!error || error.$metadata?.httpStatusCode !== 404) {
        if (error?.name !== 'NoSuchKey' && error?.name !== 'NotFound') throw error;
      }
    }

    const basename = path.basename(exactKey);
    const listResponse = await s3Client.send(
      new ListObjectsV2Command({ Bucket: R2_BUCKET_NAME, Prefix: `${R2_UPLOAD_PREFIX}/` }),
    );

    const matches = (listResponse.Contents || [])
      .map((item) => item.Key)
      .filter(Boolean)
      .filter((key) => path.basename(key) === basename);

    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];

    const latestMatch = matches
      .map((key) => {
        const entry = (listResponse.Contents || []).find((item) => item.Key === key);
        return { key, lastModified: entry?.LastModified ? new Date(entry.LastModified).getTime() : 0 };
      })
      .sort((a, b) => b.lastModified - a.lastModified)[0];

    return latestMatch?.key || null;
  }

  async function fetchFile(objectKey) {
    const command = new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: objectKey });
    return s3Client.send(command);
  }

  async function deleteFile(objectKey) {
    const command = new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: objectKey });
    return s3Client.send(command);
  }

  async function uploadFile({ objectKey, buffer, contentType }) {
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: objectKey,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
      ACL: 'public-read',
    });
    return s3Client.send(command);
  }

  return {
    getObjectKeyFromRequest,
    resolveExistingObjectKey,
    fetchFile,
    deleteFile,
    uploadFile,
  };
}

module.exports = {
  createFileService,
};
