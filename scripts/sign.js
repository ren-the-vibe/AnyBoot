// No-op code signing hook for electron-builder.
// Prevents the winCodeSign binary download (which fails due to macOS
// symlinks in the archive) while keeping rcedit icon embedding intact.
exports.default = async function () {};
