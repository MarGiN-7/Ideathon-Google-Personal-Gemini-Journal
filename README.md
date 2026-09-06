# 📝 Personal Gemini Journal - Secure Authenticated AI Journaling

> **Ideathon Submission:** Production-grade AI Journaling app with Firebase Auth, Firestore data isolation, Gemini multi-turn conversations, and Secret Manager integration — deployed on Cloud Run.

---

## 🎯 Brief Description (For Ideathon Submission)

Personal Gemini Journal is a **secure, production-ready AI journaling web application** that helps users reflect, brainstorm, and capture their thoughts with the guidance of Google's Gemini 1.5 Flash model.

### 🏗️ How Each Required Technology is Leveraged:

**🔐 Firebase Authentication** — Implements email/password + Google Sign-In. Every API call sends a Firebase ID token (`Authorization: Bearer <JWT>`) which is verified server-side via `firebase-admin`'s `verifyIdToken()` middleware before any data access. Anonymous and unauthenticated requests are rejected with 401.

**☁️ Firestore User-Isolated Document Storage** — Strict per-user data isolation enforced with **defense-in-depth**:
1. **Server-side:** ALL Firestore queries are scoped to `db.collection('users').doc(req.user.uid).collection(...)` — user IDs are NEVER accepted from the client.
2. **Firestore Security Rules:** Production rules that only allow `read/write if request.auth.uid == userId`, with a top-level deny-all fallback.

Data structure: `/users/{userId}/conversations/{convId}` — zero cross-user leakage possible.

**🚀 Cloud Run Deployment** — Containerized with a minimal `node:20-alpine` Docker image, deployed as a managed Cloud Run service with:
- A **dedicated least-privilege service account** (only `datastore.user`, `secretmanager.secretAccessor`, Firebase SDK role)
- Auto-scaling capped at 5 instances
- Secrets mounted from Secret Manager (not env vars)
- Production `NODE_ENV` + `helmet()` CSP headers + rate limiting

**🤖 Multi-turn Interaction with Gemini API** — Full context-persistent journaling conversations using `@google/generative-ai` SDK:
- System instructions define Gemini as a compassionate journal companion
- Safety settings configured for all 4 harm categories (`BLOCK_MEDIUM_AND_ABOVE`)
- Sliding context window (last 20 turns) to stay within token limits
- Structured history: `{ role: 'user'|'model', parts: [{ text }] }`
- Input limits (< 5000 chars/message) and 30 req/min per-user rate limits

**🔑 Secure API Key Retrieval via Google Cloud Secret Manager** — Gemini API key is **never hardcoded, never placed in env vars, and never committed**:
- Stored as a `projects/*/secrets/gemini-api-key` secret
- Cloud Run mounts via `--set-secrets="/secrets/gemini-api-key=..."`
- Server loads at startup using `@google-cloud/secret-manager` SDK with the dedicated service account
- Local `.env` fallback only for development (excluded via `.gitignore`)

### ✨ Original Feature Enhancements (Beyond Base Spec):
1. **🧠 AI Mood Analysis** — Gemini analyzes the emotional tone of each journal entry, returning primary mood, intensity (1-10), themes, and a gentle suggestion.
2. **📋 AI-Generated Daily Journal Prompts** — Fresh reflection prompts generated daily per user, cached in Firestore to avoid redundant calls.
3. **📝 Conversation Auto-Summarization** — One-click AI summarization of long journal entries into revisitable personal insights.
4. **📊 Journaling Stats Dashboard** — Visual mood distribution charts, total entries, summarized count, and message count metrics.
5. **🛡️ Enterprise Security Layer** — Helmet CSP headers, Express rate limiting, input length validation, generic error messages (no stack leaks), and structured logging.

---

## 🚀 Quick Deployment (~15 minutes)

### Prerequisites
- A Google Cloud account with billing enabled
- `gcloud` CLI installed & authenticated: `gcloud auth login`
- Docker installed & running
- A Gemini API key from https://aistudio.google.com

### Step 1: Run the Automated Deploy Script
```bash
# Make executable
chmod +x deploy.sh

# Deploy (replace with your project ID and desired region)
./deploy.sh your-gcp-project-id us-central1
```

This script automates:
- ✅ Enabling all required GCP APIs (Run, Firestore, Secrets, Artifact Registry, Firebase)
- ✅ Creating an Artifact Registry Docker repo
- ✅ Creating a dedicated least-privilege service account with IAM bindings
- ✅ Storing your Gemini API key in **Secret Manager**
- ✅ Building + pushing the Docker image
- ✅ Deploying to **Cloud Run** with all config + secret mounts
- ✅ Printing the Firestore security rules you must paste in Firebase console

### Step 2: Complete Firebase Console Setup
The script will print these. Here's the checklist:

1. Go to **https://console.firebase.google.com** → Add project → select your GCP project
2. **Firestore Database → Create database → Native mode → choose a location**
3. **Firestore → Rules tab** → Paste these PRODUCTION RULES and Publish:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
       match /{document=**} { allow read, write: if false; }
     }
   }
   ```
4. **Authentication → Sign-in method → Enable**
   - ✅ Email/Password
   - ✅ Google
5. **Authentication → Settings → Authorized domains → Add** your Cloud Run URL (without `https://`, e.g., `gemini-journal-abcdef-uc.a.run.app`)
6. **Project Settings → Your Apps → Add Web App (</> icon)** → copy the `firebaseConfig` object
7. Paste the config into **`public/firebase-config.js`** in this project (replace the placeholder object)

### Step 3: Redeploy with Updated firebase-config.js
```bash
# Rebuild
PROJECT=your-project-id
REGION=us-central1
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/gemini-journal-repo/gemini-journal"

docker build -t ${IMAGE}:latest .
docker push ${IMAGE}:latest

gcloud run deploy gemini-journal \
  --project "${PROJECT}" \
  --region "${REGION}" \
  --image "${IMAGE}:latest"
```

✅ **DONE!** Your Cloud Run URL is now a fully working Personal Gemini Journal.

---

## 💻 Local Development

```bash
# 1. Install deps
npm install

# 2. Copy env template and fill in values
cp .env.example .env
#   - GEMINI_API_KEY=your_key (for local dev only)
#   - FIREBASE_SERVICE_ACCOUNT_KEY=$(cat service-account.json | base64 -w 0)
#     (Create one from IAM -> Service Accounts -> Create Key -> JSON)

# 3. Also update public/firebase-config.js with your web app config

# 4. Run dev server
npm run dev   # or npm start

# 5. Visit http://localhost:8080
```

---

## 📂 Project Structure

```
├── server.js                          # Express backend: auth, Firestore, Gemini endpoints
├── package.json                       # Dependencies: firebase-admin, @google-cloud/secret-manager, @google/generative-ai, helmet, express-rate-limit
├── Dockerfile                         # Cloud Run container (node:20-alpine, production deps only)
├── deploy.sh                          # ⭐ End-to-end Cloud Run deployment automation script
├── .env.example                       # Local env template (DO NOT commit .env!)
├── .gitignore / .dockerignore         # Prevent secrets from being committed
├── AI_STUDIO_CUSTOM_INSTRUCTIONS.md   # ⭐ The full security "constitution" for Google AI Studio
├── public/
│   ├── index.html                     # SPA: sign-in + app shell
│   ├── styles.css                     # Full UI: auth card, sidebar, chat, stats, mood panels
│   ├── app.js                         # Firebase Auth UI flow, chat rendering, API calls
│   └── firebase-config.js             # YOUR Firebase web config (step 2.6 above)
```

### API Endpoints (All Authenticated Except /health)
| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Public health check |
| `/api/chat` | POST | Send message to Gemini; saves to Firestore under user |
| `/api/conversations` | GET | List user's conversation summaries (last 50, by updated) |
| `/api/conversations/:id` | GET | Load full single conversation |
| `/api/conversations/:id/summarize` | POST | AI summarization, saves summary to doc |
| `/api/conversations/:id/analyze-mood` | POST | AI mood analysis (JSON: mood, intensity, themes, suggestion) |
| `/api/daily-prompts` | GET | Cached 3 daily Gemini journal prompts per user |
| `/api/stats` | GET | User's journaling stats + mood distribution counts |
| `/api/conversations/:id` | DELETE | User deletes their own entry only |

---

## ✅ Security Verification Checklist

Every box below was checked in the design:

- [x] **ZERO hardcoded keys** anywhere (Gemini key in Secret Manager; SA via ADC on Cloud Run)
- [x] **Server verifies Firebase ID Token** on every authenticated endpoint via `verifyAuth()` middleware
- [x] **Firestore strict user isolation** on both server (scoped queries) + rules (userId match)
- [x] **Rate limiting** — 100 req/15min global, 30 chat req/min per user
- [x] **Input validation** — message length < 5000, types checked, 1 MB JSON body cap
- [x] **Helmet + CSP headers** applied
- [x] **Generic client errors** — stack traces never leak
- [x] **Alpine Docker image**, production deps only, no secrets in COPY
- [x] **Dedicated service account** with least-privilege role bindings
- [x] **Gemini safety settings** explicit for all 4 harm categories + system instruction set
- [x] **XSS protection** — user content rendered via escaped `textContent` equivalents

---

## 📱 Ideathon Deliverables Checklist

1. ✅ **Google AI Studio Custom Security Directives** → File: `AI_STUDIO_CUSTOM_INSTRUCTIONS.md` (Paste into AI Studio → Settings → Custom Instructions)
2. ✅ **Working App** → Your Cloud Run URL after Step 3 above
3. ✅ **All 4 Core Requirements Met**:
   - Firebase Auth (Email + Google)
   - Multi-turn Gemini conversation
   - User-isolated Firestore storage (dual-layer enforcement)
   - Secret Manager for Gemini key
4. ✅ **4+ Original Enhancements**: Mood Analysis, Daily Prompts, Summarization, Stats Dashboard

---

## 📋 Submission Copy-Paste Templates

**Brief description field:**
```
Personal Gemini Journal is a production-grade AI journaling app. Firebase Authentication secures sign-in via Email/Password + Google, with every API request verified server-side using firebase-admin's verifyIdToken(). Firestore enforces user isolation with defense-in-depth: all server queries are scoped to /users/{uid}/conversations, and Firestore Security Rules explicitly allow read/write ONLY when request.auth.uid == userId, with a top-level deny. The Gemini 1.5 Flash model powers multi-turn journaling conversations with sliding history window and explicit safety settings across all harm categories. The Gemini API key is stored in Google Cloud Secret Manager, mounted into the Cloud Run container via --set-secrets, and loaded at startup via the @google-cloud/secret-manager SDK using a dedicated least-privilege service account — never hardcoded. The app is containerized with node:20-alpine Docker image and deployed to Cloud Run with auto-scaling, helmet CSP headers, and express-rate-limit. Original features beyond spec: AI-powered mood analysis with intensity/themes, Gemini-generated daily journal prompts, one-click conversation summarization, and a mood-distribution stats dashboard.
```

**Social Media Post (copy-paste):**
```
Thrilled to share my Personal Gemini Journal project built for the #AccelerateAIwithCloudRun Ideathon! 🎉

📝 What I built: A secure, production-ready AI journaling app where users sign in, reflect with Gemini, and gain insights from their writing.

🔐 Firebase Auth + Firestore strict per-user isolation (dual-enforced in queries + security rules)
☁️ Deployed on Cloud Run with dedicated least-privilege service account
🔑 Gemini API key secured in Secret Manager (zero hardcoding)
🧠 Multi-turn Gemini 1.5 Flash conversations for guided journaling
✨ Bonus features: AI mood analysis, daily journal prompts, conversation summaries, mood-tracking stats dashboard

Shoutout to Google Cloud for the challenge! #Gemini #Firebase #CloudRun #GenerativeAI #Journaling #BuildinPublic
```

That's it — you have everything needed for a polished, production submission. Good luck! 🚀
