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

// Explicitly serve apple-app-site-association without .json extension
app.get('/.well-known/apple-app-site-association', (req, res) => {
  const fs = require('fs');
  const filePath = path.join(__dirname, '.well-known', 'apple-app-site-association.json');
  
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(filePath);
  }
  
  // Fallback: return a basic response
  const fallbackContent = {
    "applinks": {
      "apps": [],
      "details": [
        {
          "appID": "TEAM_ID.com.hisabi.univpro",
          "paths": ["/exercise", "/files/*"]
        }
      ]
    }
  };
  
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.json(fallbackContent);
});

// Serve assetlinks.json for Android
app.get('/.well-known/assetlinks.json', (req, res) => {
  const fs = require('fs');
  const filePath = path.join(__dirname, '.well-known', 'assetlinks.json');
  
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(filePath);
  }
  
  return res.status(404).json({ error: 'assetlinks.json not found' });
});

// Deep link handler for exercises
app.get('/exercise', (req, res) => {
  const exerciseId = req.query.id || '';
  const exerciseTitle = req.query.title || 'تمرين';

  if (!exerciseId) {
    return res.status(400).json({ error: 'Missing exercise ID parameter' });
  }

  // Encode parameters for deep link
  const encodedId = encodeURIComponent(exerciseId);
  const encodedTitle = encodeURIComponent(exerciseTitle);

  // Try custom scheme first (works immediately without verification)
  const customSchemeDeepLink = `hisabiuniv://exercise?id=${encodedId}&title=${encodedTitle}`;
  
  // HTTPS fallback (requires assetlinks.json verification - may take 24-48h)
  const httpsDeepLink = `https://hisabi-univ.onrender.com/exercise?id=${encodedId}&title=${encodedTitle}`;

  // Create HTML response with JavaScript redirect
  const html = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>فتح التمرين</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
            text-align: center;
            background: white;
            padding: 40px;
            border-radius: 10px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
            max-width: 400px;
        }
        h1 {
            color: #333;
            margin: 0 0 10px 0;
            font-size: 24px;
        }
        p {
            color: #666;
            margin: 10px 0;
            font-size: 14px;
        }
        .spinner {
            border: 4px solid #f3f3f3;
            border-top: 4px solid #667eea;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .button {
            background-color: #667eea;
            color: white;
            border: none;
            padding: 12px 30px;
            font-size: 16px;
            border-radius: 5px;
            cursor: pointer;
            margin-top: 20px;
            transition: background-color 0.3s;
        }
        .button:hover {
            background-color: #764ba2;
        }
        .error {
            color: #d32f2f;
            margin-top: 20px;
            display: none;
        }
        .store-links {
            margin-top: 20px;
        }
        .store-links a {
            display: inline-block;
            margin: 10px 5px;
            color: #667eea;
            text-decoration: none;
            font-size: 14px;
        }
        .store-links a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>فتح التمرين</h1>
        <p>جاري فتح التمرين في التطبيق...</p>
        <div class="spinner"></div>
        
        <div class="error" id="error">
            <p><strong>لم نتمكن من فتح التطبيق</strong></p>
            <p style="font-size: 12px;">تأكد من تثبيت تطبيق حسابي على جهازك</p>
            <button class="button" onclick="tryAgain()">حاول مرة أخرى</button>
            <div class="store-links">
                <p style="margin: 15px 0 10px 0; color: #999;">أو قم بتحميل التطبيق:</p>
                <a href="https://play.google.com/store/apps/details?id=com.hisabi.univpro" target="_blank">
                    🔗 متجر Google Play
                </a>
                <br>
                <a href="https://apps.apple.com/app/hisabi/id1234567890" target="_blank">
                    🔗 App Store
                </a>
            </div>
        </div>
    </div>

    <script>
        // Try custom scheme first (hisabiuniv://)
        const customSchemeLink = '${customSchemeDeepLink}';
        const httpsLink = '${httpsDeepLink}';
        const exerciseTitle = '${exerciseTitle}';
        
        // Record the attempt time
        const attemptTime = Date.now();
        
        // Try to open the app with custom scheme using iframe (avoids page reload)
        console.log('Attempting to open app with custom scheme:', customSchemeLink);
        
        let appOpened = false;
        
        // Detect if page visibility changed (app opened)
        document.addEventListener('visibilitychange', function() {
            if (document.hidden) {
                appOpened = true;
                console.log('✓ App opened, page hidden');
            }
        });
        
        // Use iframe to open custom scheme
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = customSchemeLink;
        document.body.appendChild(iframe);
        
        // If app doesn't open, show error after 2.5 seconds
        setTimeout(() => {
            const elapsed = Date.now() - attemptTime;
            console.log('Elapsed:', elapsed + 'ms, App opened:', appOpened);
            
            if (!appOpened) {
                console.log('× App did not open, showing error');
                document.querySelector('.spinner').style.display = 'none';
                document.querySelector('p').style.display = 'none';
                document.getElementById('error').style.display = 'block';
            }
        }, 2500);
        
        function tryAgain() {
            appOpened = false;
            const newIframe = document.createElement('iframe');
            newIframe.style.display = 'none';
            newIframe.src = customSchemeLink;
            document.body.appendChild(newIframe);
            
            // Show spinner again
            document.querySelector('.spinner').style.display = 'block';
            document.querySelector('p').style.display = 'block';
            document.getElementById('error').style.display = 'none';
            
            setTimeout(() => {
                if (!appOpened) {
                    document.querySelector('.spinner').style.display = 'none';
                    document.querySelector('p').style.display = 'none';
                    document.getElementById('error').style.display = 'block';
                    alert('التطبيق غير مثبت على جهازك');
                }
            }, 2500);
        }
    </script>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res.send(html);
});

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
