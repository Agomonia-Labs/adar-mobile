import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App).
// This is what expo/AppEntry.js normally does, but its own relative
// import ('../../App') assumes node_modules sits right next to App.tsx --
// which isn't true here, since npm workspaces hoists `expo` up to the
// repo root. This local entry file lives beside App.tsx, so `./App`
// always resolves correctly regardless of hoisting.
registerRootComponent(App);
