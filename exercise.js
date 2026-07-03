/**
 * Exercise Deep Link Handler
 * Handles https://hisabi-univ.onrender.com/exercise?id=...&title=...
 * Redirects to app using custom scheme or app store
 */

export default {
  async fetch(request) {
    const url = new URL(request.url);
    
    // Extract query parameters
    const exerciseId = url.searchParams.get('id');
    const exerciseTitle = url.searchParams.get('title');

    // Validate parameters
    if (!exerciseId || !exerciseTitle) {
      return new Response('Missing parameters: id and title are required', {
        status: 400,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // Encode parameters for deep link
    const encodedId = encodeURIComponent(exerciseId);
    const encodedTitle = encodeURIComponent(exerciseTitle);

    // Custom scheme deep link
    const deepLink = `hisabiuniv://exercise?id=${encodedId}&title=${encodedTitle}`;

    // Create a simple landing page with a single button that opens the app on Google Play
    const googlePlayUrl = 'https://play.google.com/store/apps/details?id=com.hisabi.univpro';
    const html = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>فتح التمرين</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100%; height: 100%; overflow: hidden; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
            text-align: center;
            background: white;
            padding: 32px 24px;
            border-radius: 14px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
            max-width: 360px;
            width: 90%;
        }
        h1 { color: #333; font-size: 22px; margin-bottom: 12px; }
        p { color: #666; font-size: 14px; line-height: 1.7; margin-bottom: 18px; }
        .button {
            display: inline-block;
            background-color: #667eea;
            color: white;
            border: none;
            padding: 12px 24px;
            font-size: 16px;
            border-radius: 8px;
            cursor: pointer;
            text-decoration: none;
        }
        .button:hover { background-color: #5a6fd8; }
    </style>
</head>
<body>
    <div class="container">
        <h1>فتح التمرين</h1>
        <p>إذا كان التطبيق مثبتًا، فسيتم فتحه مباشرة. وإذا لم يكن مثبتًا، اضغط على الزر أدناه.</p>
        <a class="button" href="${googlePlayUrl}" target="_blank">فتح التطبيق على Google Play</a>
    </div>

    <script>
        const deepLink = '${deepLink}';
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = deepLink;
        document.body.appendChild(iframe);
        setTimeout(() => {
            document.body.removeChild(iframe);
        }, 1000);
    </script>
</body>
</html>
    `;

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  },
};
