#!/bin/bash
# Creates the self-hosted CI VM for adar-mobile: builds & locally packages
# the Android side of arcl/geetabitan/frontdesk (via `eas build --local`)
# and submits to Play Store. iOS still builds via EAS's cloud service
# (GCE/Linux cannot run Xcode) — see infra/CI-SETUP.md for the full flow.
#
# Run this from your own Terminal (needs your authenticated gcloud CLI —
# same account/project used by adar-core's infra/deploy.sh).
set -euo pipefail

PROJECT_ID="bdas-493785"
ZONE="us-central1-a"
INSTANCE_NAME="adar-mobile-ci"
MACHINE_TYPE="e2-standard-4"      # 4 vCPU / 16GB — comfortable for Gradle + Metro bundling.
                                   # Bump to e2-standard-8 if builds feel slow.
DISK_SIZE="100GB"                 # Android SDK + Gradle/npm caches add up fast.
SA="adar-sa@${PROJECT_ID}.iam.gserviceaccount.com"   # reuses the existing ADAR service account

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

gcloud compute instances create "${INSTANCE_NAME}" \
  --project="${PROJECT_ID}" \
  --zone="${ZONE}" \
  --machine-type="${MACHINE_TYPE}" \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size="${DISK_SIZE}" \
  --boot-disk-type=pd-ssd \
  --service-account="${SA}" \
  --scopes=cloud-platform \
  --metadata-from-file startup-script="${SCRIPT_DIR}/startup-ci-vm.sh" \
  --tags=adar-mobile-ci

echo ""
echo "VM created. Provisioning (Node/Java/Android SDK/eas-cli install) runs"
echo "automatically via the startup script — give it ~5-10 minutes, then:"
echo ""
echo "  gcloud compute ssh ${INSTANCE_NAME} --project=${PROJECT_ID} --zone=${ZONE}"
echo ""
echo "To check the startup script finished:"
echo "  gcloud compute ssh ${INSTANCE_NAME} --project=${PROJECT_ID} --zone=${ZONE} \\"
echo "    --command='sudo journalctl -u google-startup-scripts --no-pager | tail -20'"
