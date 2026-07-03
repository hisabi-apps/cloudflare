/**
 * Exercise Deep Link Handler
 * Redirects to Google Play with a blurred exam background
 * Tries to open the app first if installed
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

    // Create HTML response with beautiful design
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

        /* Full‑screen blurred background */
        .background {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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

        /* Spinner for trying to open app */
        .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            animation: spin 1s linear infinite;
            margin: 0 auto 15px;
            display: none;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .spinner.show {
            display: block;
        }

        /* Single button – Google Play */
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
            <div class="spinner" id="spinner"></div>
            <h1>📚 التمرين في التطبيق</h1>
            <p id="message">
                جاري فتح التطبيق... إذا لم ينفتح، اضغط على الزر أدناه.
            </p>
            <!-- Optional: show exercise title -->
            <div class="exercise-title">📌 ${exerciseTitle}</div>

            <!-- Single button to Google Play -->
            <a href="https://play.google.com/store/apps/details?id=com.hisabi.univpro" target="_blank" class="download-btn" id="playBtn">
                <svg viewBox="0 0 24 24" width="24" height="24">
                    <path d="M3 21l11-9-11-9v18zM14 12l11-9-11-9v18z"/>
                </svg>
                تحميل من Google Play
            </a>

            <div class="footer" id="footer">
                محاولة فتح التطبيق...
            </div>
        </div>
    </div>

    <script>
        const deepLink = '${deepLink}';
        const spinner = document.getElementById('spinner');
        const message = document.getElementById('message');
        const footer = document.getElementById('footer');
        const playBtn = document.getElementById('playBtn');
        
        let appOpened = false;

        // Function to try opening the app
        function tryOpenApp() {
            spinner.classList.add('show');
            
            // Create invisible iframe to try opening the app
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.src = deepLink;
            document.body.appendChild(iframe);
            
            // Clean up iframe after a short delay
            setTimeout(() => {
                if (document.body.contains(iframe)) {
                    document.body.removeChild(iframe);
                }
            }, 500);
            
            // Check if app opened by detecting visibility change
            const handleVisibilityChange = () => {
                if (document.hidden) {
                    appOpened = true;
                    spinner.classList.remove('show');
                    message.textContent = 'تم فتح التطبيق بنجاح!';
                    footer.textContent = 'تم فتح التمرين في التطبيق';
                    document.removeEventListener('visibilitychange', handleVisibilityChange);
                }
            };

            document.addEventListener('visibilitychange', handleVisibilityChange);

            // If app didn't open within 3 seconds, show Google Play option
            setTimeout(() => {
                if (!appOpened) {
                    spinner.classList.remove('show');
                    message.innerHTML = 'لفتح هذا التمرين، يرجى تثبيت تطبيق <strong>حسابي</strong> من متجر Google Play.';
                    footer.textContent = 'سيتم فتح التمرين تلقائياً بعد التثبيت';
                    playBtn.textContent = '📥 تحميل من Google Play';
                    document.removeEventListener('visibilitychange', handleVisibilityChange);
                }
            }, 3000);
        }

        // Try to open app on page load
        window.addEventListener('load', () => {
            tryOpenApp();
        });

        // Also try when user clicks the button
        playBtn.addEventListener('click', (e) => {
            if (!appOpened) {
                e.preventDefault();
                tryOpenApp();
                
                // Fallback: open Google Play after 4 seconds
                setTimeout(() => {
                    if (!appOpened) {
                        window.open('https://play.google.com/store/apps/details?id=com.hisabi.univpro', '_blank');
                    }
                }, 4000);
            }
        });
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
