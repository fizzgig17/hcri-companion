/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';
import { installGlobalErrorHandler } from './src/crashLog';

// Before anything else -- a crash during the very first render needs this
// listening before that render starts. See crashLog.ts for why.
installGlobalErrorHandler();

AppRegistry.registerComponent(appName, () => App);
