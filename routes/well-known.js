const express = require('express');
const path = require('path');
const fs = require('fs');

module.exports = function createWellKnownRouter() {
  const router = express.Router();

  router.get('/.well-known/apple-app-site-association', (req, res) => {
    const filePath = path.join(__dirname, '..', '.well-known', 'apple-app-site-association.json');
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(filePath);
    }

    const fallbackContent = {
      applinks: {
        apps: [],
        details: [{ appID: 'TEAM_ID.com.hisabi.univpro', paths: ['/exercise', '/files/*'] }],
      },
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.json(fallbackContent);
  });

  router.get('/.well-known/assetlinks.json', (req, res) => {
    const filePath = path.join(__dirname, '..', '.well-known', 'assetlinks.json');
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(filePath);
    }
    return res.status(404).json({ error: 'assetlinks.json not found' });
  });

  router.get('/exercise', (req, res) => {
    const exerciseId = req.query.id || '';
    const exerciseTitle = req.query.title || 'تمرين';
    if (!exerciseId) {
      return res.status(400).json({ error: 'Missing exercise ID parameter' });
    }
    const encodedId = encodeURIComponent(exerciseId);
    const encodedTitle = encodeURIComponent(exerciseTitle);
    const customSchemeDeepLink = `hisabiuniv://exercise?id=${encodedId}&title=${encodeURIComponent(exerciseTitle)}`;
    const googlePlayUrl = `https://play.google.com/store/apps/details?id=com.hisabi.univpro&referrer=${encodeURIComponent(`exercise_id=${exerciseId}&title=${exerciseTitle}`)}`;
    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>تحميل التطبيق</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100%; height: 100%; overflow: hidden; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        .background { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: url('https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=1200&q=80') no-repeat center center / cover; filter: blur(10px) brightness(0.7); z-index: 0; }
        .overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.3); z-index: 1; }
        .container { position: relative; z-index: 2; display: flex; justify-content: center; align-items: center; width: 100%; height: 100%; padding: 20px; }
        .card { background: rgba(255, 255, 255, 0.95); border-radius: 20px; padding: 40px 30px; max-width: 400px; width: 100%; text-align: center; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4); backdrop-filter: blur(4px); transition: transform 0.3s ease; }
        .card:hover { transform: translateY(-4px); }
        .card h1 { font-size: 26px; color: #1a1a2e; margin-bottom: 10px; font-weight: 700; }
        .card p { font-size: 16px; color: #4a4a5a; margin: 10px 0 25px 0; line-height: 1.6; }
        .card .exercise-title { font-weight: 600; color: #16213e; background: #f0f2f7; padding: 6px 14px; border-radius: 30px; display: inline-block; margin-bottom: 20px; font-size: 15px; }
        .download-btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; background: #3c6ef0; color: white; padding: 14px 32px; border: none; border-radius: 50px; font-size: 18px; font-weight: 600; cursor: pointer; text-decoration: none; transition: background 0.3s, box-shadow 0.3s; box-shadow: 0 6px 14px rgba(60, 110, 240, 0.35); width: 100%; max-width: 280px; }
        .download-btn:hover { background: #2952d0; box-shadow: 0 8px 20px rgba(60, 110, 240, 0.5); }
        .download-btn svg { width: 24px; height: 24px; fill: currentColor; flex-shrink: 0; }
        .footer { margin-top: 25px; font-size: 13px; color: #888; }
        @media (max-width: 480px) { .card { padding: 28px 20px; } .card h1 { font-size: 22px; } .download-btn { font-size: 16px; padding: 12px 24px; } }
    </style>
</head>
<body>
    <div class="background"></div>
    <div class="overlay"></div>
    <div class="container">
        <div class="card">
            <h1>📚 التمرين في التطبيق</h1>
            <p>لفتح هذا التمرين، يرجى تثبيت تطبيق <strong>حسابي</strong> من متجر Google Play.</p>
            <div class="exercise-title">📌 ${exerciseTitle}</div>
            <a href="${googlePlayUrl}" target="_blank" class="download-btn">
                <svg viewBox="0 0 24 24" width="24" height="24"><path d="M3 21l11-9-11-9v18zM14 12l11-9-11-9v18z"/></svg>
                تحميل من Google Play
            </a>
            <div class="footer">سيتم فتح التمرين تلقائياً بعد التثبيت</div>
        </div>
    </div>
    <script>
        const deepLink = '${customSchemeDeepLink}';
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = deepLink;
        document.body.appendChild(iframe);
        setTimeout(() => { document.body.removeChild(iframe); }, 1000);
    </script>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.send(html);
  });

  router.get('/', (req, res) => {
    res.json({ message: 'Cloudflare R2 upload backend is running.' });
  });

  return router;
};