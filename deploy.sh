#!/usr/bin/env bash
# Deploy Flight Wall to Google Cloud Run from source.
# Usage:
#   PROJECT=my-project REGION=us-central1 CONTROL_PIN=1234 ./deploy.sh
# Any of PROJECT / REGION / SERVICE / CONTROL_PIN may be omitted to use defaults.
set -euo pipefail

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-flight-wall}"

if [[ -z "${PROJECT}" ]]; then
  echo "No project set. Pass PROJECT=... or run: gcloud config set project <id>" >&2
  exit 1
fi

echo "Deploying '${SERVICE}' to project '${PROJECT}' (${REGION})..."

# Ensure required APIs are enabled (idempotent).
gcloud services enable \
  run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com firestore.googleapis.com \
  --project "${PROJECT}"

ENV_ARGS=()
if [[ -n "${CONTROL_PIN:-}" ]]; then
  ENV_ARGS+=(--set-env-vars "CONTROL_PIN=${CONTROL_PIN}")
fi

gcloud run deploy "${SERVICE}" \
  --source . \
  --project "${PROJECT}" \
  --region "${REGION}" \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  "${ENV_ARGS[@]}"

echo
echo "Done. Service URL:"
gcloud run services describe "${SERVICE}" --project "${PROJECT}" --region "${REGION}" \
  --format 'value(status.url)'
