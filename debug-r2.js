const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { S3Client, ListObjectsV2Command, HeadObjectCommand } = require('@aws-sdk/client-s3');

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

(async () => {
  const key = 'exercices/www/1782666274772-aaa-1782666274068-aaa-pv-global-ing3-repe-sn_260623_203746-1.pdf';
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
    console.log('HEAD_OK');
    console.log(JSON.stringify({ contentType: head.ContentType, contentLength: head.ContentLength }, null, 2));
  } catch (error) {
    console.log('HEAD_ERROR');
    console.log(error.name + ': ' + error.message);
  }

  try {
    const list = await client.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET_NAME, Prefix: 'exercices/' }));
    console.log('OBJECTS');
    console.log((list.Contents || []).slice(0, 20).map((item) => item.Key).join('\n'));
  } catch (error) {
    console.log('LIST_ERROR');
    console.log(error.name + ': ' + error.message);
  }
})();
