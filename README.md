# Speed Alert

Installable PWA for GPS speed threshold alerts with custom tones.

## 1) Repo setup

If this folder is not connected to your GitHub repo yet:

```bash
git init
git add .
git commit -m "chore: bootstrap Speed Alert app"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

## 2) Run locally

```bash
npm install
npm run dev
```

## 3) Vercel project setup

1. Create/import this repository in Vercel.
2. In local terminal, link once:

```bash
npx vercel link
```

3. In Vercel dashboard, get:
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

4. Add these as GitHub Actions repository secrets:
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

## 4) GitHub Actions deployment

Workflow file: `.github/workflows/vercel-deploy.yml`

Behavior:
- Pull requests deploy a Vercel Preview.
- Push to `main` deploys to Vercel Production.

## 5) PWA + service worker

This project uses `vite-plugin-pwa` to generate and register a service worker.

Key files:
- `vite.config.js`
- `public/manifest.webmanifest`
- `src/sw-register.js`

## 6) Install app on Android

1. Open the deployed HTTPS URL in Chrome on Android.
2. Use the in-app `Install app` button when enabled.
3. If the button is disabled, use Chrome menu `Add to Home screen` / `Install app`.

Install criteria are met by this setup (manifest + service worker + HTTPS).

## Notes

- SVG icons are included for installability. For best launcher quality on all Android devices, replace them with 192x192 and 512x512 PNG icons.
