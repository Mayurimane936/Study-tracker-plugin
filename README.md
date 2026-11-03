# StudyTrack

StudyTrack is a React dashboard, FastAPI backend, PostgreSQL database, and Chrome extension for personal and group study tracking.

## Simple Free-Tier Deployment

Use **Vercel** for the frontend, **Neon** for PostgreSQL, and **Render** for FastAPI. This setup can use the free subdomains provided by those services; a purchased domain is optional. Free-tier limits and sleep/usage policies can change, so check each provider's current plan details.

### 1. Create the Neon database

1. Create a free Neon project and database.
2. Copy its pooled connection string. It should use the `postgresql://` scheme and include the Neon SSL parameters.
3. Keep the connection string private. You will paste it into Render as `DATABASE_URL` in a later step.

### 2. Create the Render backend

1. In Render, choose **New → Blueprint** and connect this repository. Render detects `render.yaml` and creates the `studytrack-api` web service.
2. When prompted, set `DATABASE_URL` to the Neon connection string.
3. Set `CORS_ORIGINS` temporarily to `http://localhost:5173` so you can test locally, or leave it until Vercel gives you the deployed frontend URL. Later, replace it with the exact Vercel origin, for example `https://studytrack.vercel.app` (no path or trailing slash).
4. Render generates `STUDYTRACK_SECRET_KEY` from the blueprint. Keep it private and stable; rotating it logs users out.
5. Deploy and wait for the service health check to pass. Copy the backend URL, for example `https://studytrack-api.onrender.com`.

The API health endpoint is `https://YOUR_RENDER_BACKEND/health`. Free Render services may sleep while idle and take a little time to wake on the first request.

### 3. Deploy the Vercel frontend

1. In Vercel, import the repository.
2. Set **Root Directory** to `frontend`.
3. Add the environment variable `VITE_API_URL` with the Render backend URL, with no trailing slash and no `/api`, for example `https://studytrack-api.onrender.com`.
4. Deploy. Vercel detects Vite; the build command is `npm run build` and output directory is `dist`.
5. Copy the Vercel production origin, for example `https://studytrack.vercel.app`.

### 4. Allow the deployed frontend

In Render, set the backend environment variable `CORS_ORIGINS` to the exact Vercel production origin, then redeploy the backend. Do not set it to `*` for an authenticated app. All people opening that same deployed URL share the same origin; a different computer by itself does not need another CORS entry.

If collaborators use Vercel preview deployments for this project, optionally set `CORS_ORIGIN_REGEX` in Render to `^https://study-tracker-plugin(?:-[a-z0-9-]+)?\.vercel\.app$`. This only matches HTTPS origins under this Vercel project slug. For a custom domain or local development, add each exact origin to the comma-separated `CORS_ORIGINS` value instead. After changing either setting, wait for the Render service to redeploy.

### 5. Connect the extension

Once the API and frontend URLs are final, build the production extension from the repository root:

```sh
STUDYTRACK_API_URL=https://YOUR_RENDER_BACKEND node tools/package-extension.mjs
```

The package is written to `extension/release/` and its host permission is restricted to that HTTPS API. Load this folder unpacked for private use or prepare it for Chrome Web Store review. The Chrome extension origin is not needed in CORS for ordinary extension service-worker requests; if a browser content-script flow calls the API directly, add the exact `chrome-extension://EXTENSION_ID` origin to Render's `CORS_ORIGINS` as well.

## Important Data Notes

- Neon is the persistent database. Render's local filesystem is not used for database storage.
- Study sessions older than 90 days are removed automatically. Notes and saved round/month winners remain.
- Keep database credentials and `STUDYTRACK_SECRET_KEY` in provider environment settings. Never commit `.env` files or paste secrets into chat.
- Before making schema changes to existing production data, use a reviewed database migration. SQLAlchemy `create_all` creates missing tables but does not migrate changed columns.
- Back up the Neon database outside the app host and protect the backup because it contains personal notes and account data.

## Local Development

- Backend: configure `DATABASE_URL` and `STUDYTRACK_SECRET_KEY` in `backend/.env`, install `backend/requirements.txt`, then run `uvicorn app:app --reload` from `backend/`.
- Frontend: run `npm ci` and `npm run dev` from `frontend/`. Vite proxies `/api` to local FastAPI. For local API docs, set `ENABLE_API_DOCS=true` in `backend/.env`.
- Extension: load the `extension/` folder as an unpacked extension. Its development config points to `http://127.0.0.1:8000`.