const { execSync } = require('child_process');

// Disable certificate auto-discovery so electron-builder skips the
// winCodeSign download entirely. Icon embedding via rcedit still works.
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';

execSync('npx electron-builder', { stdio: 'inherit', env: process.env });
