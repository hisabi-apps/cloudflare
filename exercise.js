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

    // Create HTML response with JavaScript redirect
    const html = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>فتح التمرين</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        html, body {
            width: 100%;
            height: 100%;
            overflow: hidden;
        }
        
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
        // Try to open the app using custom scheme
        const deepLink = '${deepLink}';
        const exerciseTitle = '${exerciseTitle}';
        
        // Record the attempt time for timeout
        let appOpenedTime = null;
        
        // Create an invisible iframe to try opening the app (more reliable than window.location)
        function tryOpenApp() {
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.src = deepLink;
            document.body.appendChild(iframe);
            
            // Clean up iframe after a short delay
            setTimeout(() => {
                document.body.removeChild(iframe);
            }, 1000);
        }
        
        // Detect if the page visibility changes (indicates app opened)
        function onVisibilityChange() {
            if (document.hidden) {
                appOpenedTime = Date.now();
                // App likely opened, stop checking
                document.removeEventListener('visibilitychange', onVisibilityChange);
            }
        }
        
        // Try to open app immediately (before page even loads)
        tryOpenApp();
        
        // Also listen for visibility changes
        document.addEventListener('visibilitychange', onVisibilityChange);
        
        // Set a timeout to show error if app didn't open
        setTimeout(() => {
            // If app didn't open within 3 seconds, show error
            if (!appOpenedTime) {
                document.querySelector('.spinner').style.display = 'none';
                document.querySelector('p').style.display = 'none';
                document.getElementById('error').style.display = 'block';
                document.removeEventListener('visibilitychange', onVisibilityChange);
            }
        }, 3000);
        
        function tryAgain() {
            document.getElementById('error').style.display = 'none';
            document.querySelector('.spinner').style.display = 'block';
            document.querySelector('p').style.display = 'block';
            appOpenedTime = null;
            
            tryOpenApp();
            document.addEventListener('visibilitychange', onVisibilityChange);
            
            setTimeout(() => {
                if (!appOpenedTime) {
                    document.querySelector('.spinner').style.display = 'none';
                    document.querySelector('p').style.display = 'none';
                    document.getElementById('error').style.display = 'block';
                    document.removeEventListener('visibilitychange', onVisibilityChange);
                }
            }, 3000);
        }
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
