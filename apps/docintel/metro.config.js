const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Monorepo: resolve @adar/* packages from the workspace root, same as
// frontdesk/geetabitan/arcl's metro.config.js.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// DocIntel is the only app on Expo SDK 54 / React Native 0.81 / React 19 --
// every other app in this monorepo (and the shared @adar/* packages, built
// against whatever the root hoists) is still on the older RN 0.74.5 / React
// 18.2.0. @adar/shared-auth (and react-native-markdown-display) live outside
// apps/docintel/node_modules, so when THEIR OWN code does
// require('react-native') / require('react'), Metro's hierarchical lookup
// walks up from their own directory and finds the monorepo root's OLDER
// copies -- not docintel's nested ones. That loads a second, disconnected
// react-native module instance whose Platform/TurboModuleRegistry was never
// wired to the real (bridgeless, New Architecture) native runtime, which is
// exactly what produced "PlatformConstants could not be found" with an
// empty module registry. Force every react/react-native import in this
// app's bundle -- regardless of which package requests it -- to resolve to
// docintel's own nested copies, so there is only ever one instance of each.
const FORCED_SINGLETON_PACKAGES = ['react', 'react-native'];
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const forced = FORCED_SINGLETON_PACKAGES.find(
    (pkg) => moduleName === pkg || moduleName.startsWith(`${pkg}/`)
  );
  if (forced) {
    return {
      type: 'sourceFile',
      filePath: require.resolve(moduleName, { paths: [projectRoot] }),
    };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
