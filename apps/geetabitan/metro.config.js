const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Monorepo: resolve @adar/* packages from the workspace root, same as
// frontdesk/docintel/eats/arcl's metro.config.js.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Geetabitan is on Expo SDK 54 / React Native 0.81 / React 19 now, but
// every other app in this monorepo (and the shared @adar/* packages, built
// against whatever the root hoists) is still on RN 0.74.5 / React 18.2.0,
// Expo SDK 51. That mismatch bites in two different shapes, both of which
// produce the exact same symptom: a module that looks fine individually but
// throws "Cannot read property 'prototype' of undefined" (or similarly
// bizarre errors) at app startup, because it's actually two incompatible
// versions of the same package wired together.
//
// Shape 1: a package lives directly under apps/geetabitan/node_modules (a
// sibling of this app's other deps), but something OUTSIDE geetabitan (a
// shared @adar/* workspace package, or react-native-markdown-display) bare-
// requires it. Node's hierarchical require() walk starts from THAT OTHER
// package's own directory, skips right past geetabitan's copy, and finds
// the monorepo root's older one instead. This is what produced DocIntel's
// original "PlatformConstants could not be found" crash (for
// react/react-native).
//
// Shape 2: a package gets hoisted to the monorepo ROOT instead of nested
// under apps/geetabitan at all -- npm's workspace install decided
// geetabitan and the other (older) apps could share one copy of some
// expo-* package. That root copy's OWN code then bare-requires ITS
// dependencies (expo-modules-core, expo-constants, ...) -- and since the
// package now physically lives at the repo root, hierarchical lookup finds
// the repo root's OLD versions of those, not geetabitan's correct nested
// ones. (This is what broke Eats until this same fix was added there.)
//
// Both shapes have the same fix: force every react/react-native/expo*
// import in this app's bundle -- regardless of which package requests it,
// and regardless of where that requesting package itself lives -- to
// resolve from geetabitan's OWN dependency tree. Checked in order: nested
// one level deeper inside apps/geetabitan/node_modules/expo/node_modules
// first (where a handful of expo's own sub-dependencies -- expo-asset,
// expo-font, expo-keep-awake -- live without being promoted to a sibling),
// then directly under apps/geetabitan/node_modules (where almost everything
// else lives). That order matters: require.resolve(name, { paths }) tries
// each given path's own upward directory walk in turn and returns the
// first hit, so if apps/geetabitan/node_modules/expo/node_modules isn't
// tried FIRST, a bare-sibling lookup starting from apps/geetabitan itself
// walks all the way up to the monorepo root's node_modules (finding the
// stale version there) before this second path ever gets a chance.
const FORCE_FROM_APP_TREE = (moduleName) =>
  moduleName === 'react' ||
  moduleName.startsWith('react/') ||
  moduleName === 'react-native' ||
  moduleName.startsWith('react-native/') ||
  moduleName === 'expo' ||
  moduleName.startsWith('expo/') ||
  moduleName.startsWith('expo-') ||
  moduleName.startsWith('@expo/');

const expoNestedModules = path.resolve(projectRoot, 'node_modules/expo');
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (FORCE_FROM_APP_TREE(moduleName)) {
    try {
      return {
        type: 'sourceFile',
        filePath: require.resolve(moduleName, { paths: [expoNestedModules, projectRoot] }),
      };
    } catch (e) {
      // Not actually present anywhere in geetabitan's own tree (e.g. a
      // web-only module on a native platform) -- fall through to Metro's
      // normal resolution instead of hard-failing the whole bundle.
    }
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
