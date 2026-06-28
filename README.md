# Cloudflare R2 Upload Backend

This is a simple Node.js backend that accepts file uploads and stores them in Cloudflare R2.
It returns a public URL that can be used by your Flutter app.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in your Cloudflare R2 credentials:

```dotenv
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key-id
R2_SECRET_ACCESS_KEY=your-secret-access-key
R2_BUCKET_NAME=your-bucket-name
R2_PUBLIC_BASE_URL=https://files.example.com
R2_UPLOAD_PREFIX=exercises
PORT=3000
```

- `R2_PUBLIC_BASE_URL` is optional.
- If omitted, the backend will use Cloudflare R2 default URL:
  `https://<account-id>.r2.cloudflarestorage.com/<bucket>`.

## Install dependencies

```bash
cd cloudflare_r2_backend
npm install
```

## Run the server

```bash
npm start
```

## API

### POST /upload

Accepts a multipart form with:
- `file`: the uploaded file
- `subject`: optional subject name
- `title`: optional file title

Response:

```json
{
  "url": "https://files.example.com/exercises/math/1678901234-exam1-sample.pdf",
  "objectKey": "exercises/math/1678901234-exam1-sample.pdf"
}
```

## Flutter integration

Use the backend URL as `R2_UPLOAD_ENDPOINT` in your Flutter app:

```bash
flutter run --dart-define=R2_UPLOAD_ENDPOINT=http://localhost:3000/upload \
  --dart-define=R2_PUBLIC_BASE_URL=https://files.example.com
```

Your Flutter app will upload files to this backend, which then stores them in Cloudflare R2.
