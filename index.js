const path = require('path');
require('dotenv').config({
  path: path.resolve(__dirname, '..', '.env'),
});
const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME,
  R2_PUBLIC_BASE_URL,
  R2_UPLOAD_PREFIX = 'exercises',
  PORT = 3000,
} = process.env;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
  console.error('Missing Cloudflare R2 environment variables. See .env.example.');
  process.exit(1);
}

const upload = multer({ storage: multer.memoryStorage() });
const app = express();

const r2Endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const s3Client = new S3Client({
  region: 'auto',
  endpoint: r2Endpoint,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

function sanitizeSegment(value) {
  return value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '') || 'file';
}

function buildObjectKey(subject, title, originalName) {
  const timestamp = Date.now();
  const safeSubject = sanitizeSegment(subject || 'عام');
  const safeTitle = sanitizeSegment(title || 'file');
  const safeName = sanitizeSegment(originalName || 'upload');
  return `${R2_UPLOAD_PREFIX}/${safeSubject}/${timestamp}-${safeTitle}-${safeName}`;
}

function buildPublicUrl(objectKey) {
  if (R2_PUBLIC_BASE_URL && R2_PUBLIC_BASE_URL.trim().length > 0) {
    const base = R2_PUBLIC_BASE_URL.trim().replace(/\/+$/g, '');
    const key = objectKey.replace(/^\/+/, '');
    return `${base}/${key}`;
  }

  const bucketUrl = `${r2Endpoint}/${R2_BUCKET_NAME}`;
  const key = objectKey.replace(/^\/+/, '');
  return `${bucketUrl}/${key}`;
}

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const subject = req.body.subject || 'عام';
    const title = req.body.title || path.parse(req.file.originalname).name;
    const objectKey = buildObjectKey(subject, title, req.file.originalname);

    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: objectKey,
      Body: req.file.buffer,
      ContentType: req.file.mimetype || 'application/octet-stream',
    });

    await s3Client.send(command);

    const publicUrl = buildPublicUrl(objectKey);
    return res.status(201).json({
      url: publicUrl,
      objectKey,
    });
  } catch (error) {
    console.error('Upload failed:', error);
    return res.status(500).json({
      error: 'Failed to upload file to Cloudflare R2.',
      details: error.message || String(error),
    });
  }
});

app.get('/', (req, res) => {
  res.json({ message: 'Cloudflare R2 upload backend is running.' });
});

app.listen(PORT, () => {
  console.log(`Cloudflare R2 backend listening on http://localhost:${PORT}`);
});
