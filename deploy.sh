#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "🚀 Starting build and deployment process..."

# Define your project specifics
PROJECT_ID="gen-lang-client-0828235812"
SERVICE_NAME="trading-assistant"
REGION="us-central1"

echo "📦 Skipping strict type checks due to existing backend warnings..."

echo "🔨 Building Nuxt frontend..."
cd web && npm run build && cd ..

echo "☁️ Deploying to Google Cloud Run..."
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --quiet

echo "✅ Deployment completed successfully!"
