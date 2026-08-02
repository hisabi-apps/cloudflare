const { S3Client } = require('@aws-sdk/client-s3');

function createR2Client({ R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY }) {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error('Missing Cloudflare R2 environment variables.');
  }

  const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  return new S3Client({
    region: 'auto',
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
}

module.exports = {
  createR2Client,
};
