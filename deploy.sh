#!/bin/bash
# ===========================================
# Personal Gemini Journal - Cloud Run Deploy Script
# Usage: ./deploy.sh YOUR_PROJECT_ID
# ===========================================
set -e

PROJECT_ID=${1:?"Error: Please provide your GCP Project ID as argument 1"}
REGION=${2:-us-central1}
SERVICE_NAME="gemini-journal"
REPO_NAME="gemini-journal-repo"
IMAGE_NAME="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}"
SERVICE_ACCOUNT="gemini-journal-sa"

echo "===== 🔐 Personal Gemini Journal - Cloud Run Deployment ====="
echo "Project: $PROJECT_ID"
echo "Region:  $REGION"
echo ""

echo "=== 1/8  Enabling required APIs... ==="
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  firestore.googleapis.com \
  firebase.googleapis.com \
  iam.googleapis.com \
  --project "$PROJECT_ID"
echo "✅ APIs enabled."

echo ""
echo "=== 2/8  Creating Artifact Registry repo... ==="
gcloud artifacts repositories create "$REPO_NAME" \
  --repository-format=docker \
  --location="$REGION" \
  --project "$PROJECT_ID" \
  --description="Personal Gemini Journal images" 2>/dev/null || echo "Repo exists or error (continuing)..."
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
echo "✅ Artifact Registry configured."

echo ""
echo "=== 3/8  Creating dedicated service account... ==="
gcloud iam service-accounts create "$SERVICE_ACCOUNT" \
  --project "$PROJECT_ID" \
  --display-name="Gemini Journal Service Account" 2>/dev/null || echo "SA exists (continuing)..."

SA_EMAIL="${SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "Binding IAM roles to $SA_EMAIL..."
for ROLE in \
  "roles/datastore.user" \
  "roles/firebase.sdkAdminServiceAgent" \
  "roles/secretmanager.secretAccessor" \
  "roles/run.invoker"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$ROLE" \
    --condition=None > /dev/null 2>&1 || true
done
echo "✅ IAM bindings applied."

echo ""
echo "=== 4/8  Setting up Gemini API key in Secret Manager... ==="
read -rp "Paste your Gemini API key (from aistudio.google.com): " GEMINI_KEY
if [ -n "$GEMINI_KEY" ]; then
  echo -n "$GEMINI_KEY" | gcloud secrets create gemini-api-key \
    --project "$PROJECT_ID" \
    --data-file=- \
    --replication-policy="automatic" 2>/dev/null || \
  echo -n "$GEMINI_KEY" | gcloud secrets versions add gemini-api-key \
    --project "$PROJECT_ID" \
    --data-file=-
  echo "✅ Secret stored. Access: projects/$PROJECT_ID/secrets/gemini-api-key/versions/latest"
fi

echo ""
echo "=== 5/8  Building & pushing Docker image... ==="
docker build -t "$IMAGE_NAME:latest" .
docker push "$IMAGE_NAME:latest"
echo "✅ Image pushed: $IMAGE_NAME:latest"

echo ""
echo "=== 6/8  Deploying to Cloud Run... ==="
gcloud run deploy "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --image "$IMAGE_NAME:latest" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --service-account="$SA_EMAIL" \
  --port=8080 \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=5 \
  --timeout=300s \
  --set-secrets="/secrets/gemini-api-key=projects/${PROJECT_ID}/secrets/gemini-api-key:latest" \
  --set-env-vars="GEMINI_SECRET_NAME=projects/${PROJECT_ID}/secrets/gemini-api-key/versions/latest,NODE_ENV=production"

CLOUD_RUN_URL=$(gcloud run services describe "$SERVICE_NAME" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')
echo ""
echo "🚀 🌐 Deployed to: $CLOUD_RUN_URL"

echo ""
echo "=== 7/8  IMPORTANT: Firebase Setup Steps ==="
echo ""
echo "Do these in the Firebase Console (https://console.firebase.google.com):"
echo "  1. Enable Firestore Database in Native mode (choose location, e.g. nam5)"
echo "  2. Enable Authentication -> Sign-in method -> Email/Password AND Google"
echo "  3. Under Authorized domains ADD: $CLOUD_RUN_URL (remove https://)"
echo "  4. Create a Web App and copy your Firebase web config into:"
echo "     ->  public/firebase-config.js"
echo "  5. In Firestore Database -> Rules, paste these PRODUCTION rules:"
echo ""
cat <<'RULES'
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Strict user isolation: each user only sees their own documents
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    // Top-level deny
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
RULES
echo ""
echo "=== 8/8  Rebuild with updated firebase-config.js & Redeploy ==="
echo "After updating public/firebase-config.js, re-run:"
echo ""
echo "  docker build -t $IMAGE_NAME:latest ."
echo "  docker push $IMAGE_NAME:latest"
echo "  gcloud run deploy $SERVICE_NAME --project $PROJECT_ID --region $REGION --image $IMAGE_NAME:latest"
echo ""
echo "✅ Deployment script complete!"
echo ""
echo "NEXT: Now create your social media post with #AccelerateAIwithCloudRun and upload this code to GitHub."
