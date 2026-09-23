#!/bin/bash
# Startup script for adar-mobile-ci — installs everything needed to build
# Android apps locally (via `eas build --local`) and drive iOS cloud builds
# (via `eas build`) for the three Expo apps in this monorepo.
set -euo pipefail

apt-get update -y
apt-get install -y curl unzip git openjdk-17-jdk-headless wget

# --- Node 20 -----------------------------------------------------------
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# --- Android SDK cmdline-tools ------------------------------------------
export ANDROID_HOME=/opt/android-sdk
mkdir -p "${ANDROID_HOME}/cmdline-tools"
cd /tmp
wget -q https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O cmdline-tools.zip
unzip -q cmdline-tools.zip -d "${ANDROID_HOME}/cmdline-tools"
mv "${ANDROID_HOME}/cmdline-tools/cmdline-tools" "${ANDROID_HOME}/cmdline-tools/latest"

export PATH="${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${PATH}"

yes | sdkmanager --licenses --sdk_root="${ANDROID_HOME}" >/dev/null
sdkmanager --sdk_root="${ANDROID_HOME}" \
  "platform-tools" "platforms;android-34" "build-tools;34.0.0"

# Persist env vars for all future shells (SSH sessions)
cat >> /etc/profile.d/android-sdk.sh << 'ENV_EOF'
export ANDROID_HOME=/opt/android-sdk
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
ENV_EOF
chmod 644 /etc/profile.d/android-sdk.sh

# --- EAS CLI -------------------------------------------------------------
npm install -g eas-cli

echo "adar-mobile-ci provisioning complete."
