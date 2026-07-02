const path = require('path');
require('dotenv').config({
  path: path.resolve(__dirname, '..', '.env'),
});
const express = require('express');
const multer = require('multer');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME,
  R2_PUBLIC_BASE_URL,
  R2_UPLOAD_PREFIX = 'exercices',
  PORT = 10000,
} = process.env;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
  console.error('Missing Cloudflare R2 environment variables. See .env.example.');
  process.exit(1);
}

const upload = multer({ storage: multer.memoryStorage() });
const app = express();

app.use('/.well-known', express.static(path.join(__dirname, '.well-known')));

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

function buildPublicUrl(req, objectKey) {
  const cleanedKey = objectKey.replace(/^\/+/, '');
  if (R2_PUBLIC_BASE_URL && R2_PUBLIC_BASE_URL.trim()) {
    const base = R2_PUBLIC_BASE_URL.trim().replace(/\/+$/, '');
    const encodedKey = cleanedKey
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `${base}/${encodedKey}`;
  }

  const protocol = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('x-forwarded-host') || req.get('host');
  const encodedKey = cleanedKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${protocol}://${host}/files/${encodedKey}`;
}

app.post('/delete', express.json(), async (req, res) => {
  try {
    const objectKey = (req.body.objectKey || '').toString().trim();
    if (!objectKey) {
      return res.status(400).json({ error: 'Missing object key.' });
    }

    const command = new DeleteObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: objectKey.replace(/^\/+/, ''),
    });

    await s3Client.send(command);
    return res.status(200).json({ success: true, objectKey });
  } catch (error) {
    console.error('Delete failed:', error);
    return res.status(500).json({
      error: 'Failed to delete file from Cloudflare R2.',
      details: error.message || String(error),
    });
  }
});

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const subject = req.body.subject || 'عام';
    const title = req.body.title || path.parse(req.file.originalname).name;
    const requestedObjectKey = (req.body.objectKey || '').toString().trim();
    const objectKey = requestedObjectKey
      ? requestedObjectKey.replace(/^\/+/, '')
      : buildObjectKey(subject, title, req.file.originalname);

    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: objectKey,
      Body: req.file.buffer,
      ContentType: req.file.mimetype || 'application/octet-stream',
      ACL: 'public-read',
    });

    await s3Client.send(command);

    const publicUrl = buildPublicUrl(req, objectKey);
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

app.get('/files', (req, res) => {
  return res.status(200).json({
    message: 'File endpoint is ready. Provide an object key after /files/.',
  });
});

app.get('/files/:objectKey(*)', async (req, res) => {
  try {
    const objectKey = getObjectKeyFromRequest(req);
    if (!objectKey) {
      return res.status(400).json({ error: 'Missing object key.' });
    }

    const resolvedKey = await resolveExistingObjectKey(objectKey);
    if (!resolvedKey) {
      return res.status(404).json({
        error: 'File not found.',
        details: 'The specified key does not exist.',
      });
    }

    const encodedKey = resolvedKey
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');

    // Redirect to the file-serving endpoint. This avoids returning the file
    // directly so Android App Links can be triggered for the /open/files/ path.
    return res.redirect(302, `/files/${encodedKey}`);
  } catch (error) {
    console.error('Open file redirect failed:', error);
    return res.status(500).json({
      error: 'Failed to redirect to file.',
      details: error.message || String(error),
    });
  }
});

function getObjectKeyFromRequest(req) {
  const fromNamedParam = req.params.objectKey || '';
  const fromWildcardParam = req.params[0] || '';
  const rawValue = fromNamedParam || fromWildcardParam;
  return decodeURIComponent(rawValue).replace(/^\/+/, '');
}

async function resolveExistingObjectKey(requestedKey) {
  const exactKey = requestedKey.replace(/^\/+/, '');
  if (!exactKey) {
    return null;
  }

  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: exactKey,
      }),
    );
    return exactKey;
  } catch (error) {
    if (!error || error.$metadata?.httpStatusCode !== 404) {
      if (error?.name !== 'NoSuchKey' && error?.name !== 'NotFound') {
        throw error;
      }
    }
  }

  const basename = path.basename(exactKey);
  const listResponse = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: R2_BUCKET_NAME,
      Prefix: `${R2_UPLOAD_PREFIX}/`,
    }),
  );

  const matches = (listResponse.Contents || [])
    .map((item) => item.Key)
    .filter(Boolean)
    .filter((key) => path.basename(key) === basename);

  if (matches.length === 0) {
    return null;
  }

  if (matches.length === 1) {
    return matches[0];
  }

  const latestMatch = matches
    .map((key) => {
      const entry = (listResponse.Contents || []).find((item) => item.Key === key);
      return {
        key,
        lastModified: entry?.LastModified ? new Date(entry.LastModified).getTime() : 0,
      };
    })
    .sort((a, b) => b.lastModified - a.lastModified)[0];

  return latestMatch?.key || null;
}

app.get('/files/:objectKey(*)', async (req, res) => {
  try {
    const objectKey = getObjectKeyFromRequest(req);
    if (!objectKey) {
      return res.status(400).json({ error: 'Missing object key.' });
    }

    const resolvedKey = await resolveExistingObjectKey(objectKey);
    if (!resolvedKey) {
      return res.status(404).json({
        error: 'File not found.',
        details: 'The specified key does not exist.',
      });
    }

    const command = new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: resolvedKey,
    });

    const response = await s3Client.send(command);
    if (!response.Body) {
      return res.status(404).json({ error: 'File not found.' });
    }

    res.status(200);
    res.setHeader('Content-Type', response.ContentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${path.basename(resolvedKey)}"`,
    );

    if (typeof response.Body.transformToByteArray === 'function') {
      const bytes = await response.Body.transformToByteArray();
      return res.end(Buffer.from(bytes));
    }

    if (typeof response.Body.pipe === 'function') {
      return response.Body.pipe(res);
    }

    return res.end(response.Body);
  } catch (error) {
    console.error('File fetch failed:', error);
    return res.status(500).json({
      error: 'Failed to fetch file from Cloudflare R2.',
      details: error.message || String(error),
    });
  }
});

app.get('/files/*', async (req, res) => {
  try {
    const objectKey = getObjectKeyFromRequest(req);
    if (!objectKey) {
      return res.status(400).json({ error: 'Missing object key.' });
    }

    const resolvedKey = await resolveExistingObjectKey(objectKey);
    if (!resolvedKey) {
      return res.status(404).json({
        error: 'File not found.',
        details: 'The specified key does not exist.',
      });
    }

    const command = new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: resolvedKey,
    });

    const response = await s3Client.send(command);
    if (!response.Body) {
      return res.status(404).json({ error: 'File not found.' });
    }

    res.status(200);
    res.setHeader('Content-Type', response.ContentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${path.basename(resolvedKey)}"`,
    );

    if (typeof response.Body.transformToByteArray === 'function') {
      const bytes = await response.Body.transformToByteArray();
      return res.end(Buffer.from(bytes));
    }

    if (typeof response.Body.pipe === 'function') {
      return response.Body.pipe(res);
    }

    return res.end(response.Body);
  } catch (error) {
    console.error('File fetch failed:', error);
    return res.status(500).json({
      error: 'Failed to fetch file from Cloudflare R2.',
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
