/**
 * Exercise Deep Link Handler
 * Tries to open the app first, then shows beautiful fallback UI
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

    // Create HTML response with beautiful UI
    const html = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>تحميل التطبيق</title>
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
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }

        /* Full-screen blurred background */
        .background {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: url('https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=1200&q=80') no-repeat center center / cover;
            filter: blur(10px) brightness(0.7);
            z-index: 0;
        }

        /* Dark overlay for better text contrast */
        .overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.3);
            z-index: 1;
        }

        /* Centered card */
        .container {
            position: relative;
            z-index: 2;
            display: flex;
            justify-content: center;
            align-items: center;
            width: 100%;
            height: 100%;
            padding: 20px;
        }

        .card {
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            padding: 40px 30px;
            max-width: 400px;
            width: 100%;
            text-align: center;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(4px);
            transition: transform 0.3s ease;
        }

        .card:hover {
            transform: translateY(-4px);
        }

        .card h1 {
            font-size: 26px;
            color: #1a1a2e;
            margin-bottom: 10px;
            font-weight: 700;
        }

        .card p {
            font-size: 16px;
            color: #4a4a5a;
            margin: 10px 0 25px 0;
            line-height: 1.6;
        }

        .card .exercise-title {
            font-weight: 600;
            color: #16213e;
            background: #f0f2f7;
            padding: 6px 14px;
            border-radius: 30px;
            display: inline-block;
            margin-bottom: 20px;
            font-size: 15px;
        }

        /* Spinner for app opening attempt */
        .spinner-wrapper {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 15px;
        }

        .spinner {
            border: 4px solid #f0f2f7;
            border-top: 4px solid #3c6ef0;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .spinner-text {
            font-size: 14px;
            color: #666;
            font-weight: 500;
        }

        /* Download button – Google Play */
        .download-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            background: #3c6ef0;
            color: white;
            padding: 14px 32px;
            border: none;
            border-radius: 50px;
            font-size: 18px;
            font-weight: 600;
            cursor: pointer;
            text-decoration: none;
            transition: background 0.3s, box-shadow 0.3s;
            box-shadow: 0 6px 14px rgba(60, 110, 240, 0.35);
            width: 100%;
            max-width: 280px;
        }

        .download-btn:hover {
            background: #2952d0;
            box-shadow: 0 8px 20px rgba(60, 110, 240, 0.5);
        }

        .download-btn svg {
            width: 24px;
            height: 24px;
            fill: currentColor;
            flex-shrink: 0;
        }

        /* Hidden by default, shown after timeout */
        .fallback-content {
            display: none;
        }

        .fallback-content.show {
            display: block;
        }

        .loading-content {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
        }

        /* Small footer */
        .footer {
            margin-top: 25px;
            font-size: 13px;
            color: #888;
        }

        .footer a {
            color: #3c6ef0;
            text-decoration: none;
        }

        .footer a:hover {
            text-decoration: underline;
        }

        /* Responsive */
        @media (max-width: 480px) {
            .card {
                padding: 28px 20px;
            }
            .card h1 {
                font-size: 22px;
            }
            .download-btn {
                font-size: 16px;
                padding: 12px 24px;
            }
        }
    </style>
</head>
<body>

    <div class="background"></div>
    <div class="overlay"></div>

    <div class="container">
        <div class="card">
            <h1>📚 التمرين في التطبيق</h1>
            
            <!-- Loading state: trying to open app -->
            <div class="loading-content" id="loadingContent">
                <p>جاري محاولة فتح التطبيق...</p>
                <div class="exercise-title">📌 ${exerciseTitle}</div>
                <div class="spinner-wrapper">
                    <div class="spinner"></div>
                    <span class="spinner-text">انتظر قليلاً...</span>
                </div>
            </div>

            <!-- Fallback state: show download button -->
            <div class="fallback-content" id="fallbackContent">
                <p>
                    لفتح هذا التمرين، يرجى تثبيت تطبيق <strong>حسابي</strong> من متجر Google Play.
                </p>
                <div class="exercise-title">📌 ${exerciseTitle}</div>

                <a href="https://play.google.com/store/apps/details?id=com.hisabi.univpro" target="_blank" class="download-btn">
                    <svg viewBox="0 0 24 24" width="24" height="24">
                        <path d="M3 21l11-9-11-9v18zM14 12l11-9-11-9v18z"/>
                    </svg>
                    تحميل من Google Play
                </a>

                <div class="footer">
                    سيتم فتح التمرين تلقائياً بعد التثبيت والفتح
                </div>
            </div>
        </div>
    </div>

    <script>
        // Try to open the app using custom scheme
        const deepLink = '${deepLink}';
        let appOpenedTime = null;

        // Create an invisible iframe to try opening the app (more reliable)
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

        // Detect if page visibility changes (indicates app opened)
        function onVisibilityChange() {
            if (document.hidden) {
                appOpenedTime = Date.now();
                document.removeEventListener('visibilitychange', onVisibilityChange);
            }
        }

        // Try to open app immediately
        tryOpenApp();

        // Listen for visibility changes
        document.addEventListener('visibilitychange', onVisibilityChange);

        // Set timeout to show fallback if app didn't open
        setTimeout(() => {
            if (!appOpenedTime) {
                // App didn't open, show fallback UI
                document.getElementById('loadingContent').style.display = 'none';
                document.getElementById('fallbackContent').classList.add('show');
                document.removeEventListener('visibilitychange', onVisibilityChange);
            }
        }, 3500);
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
