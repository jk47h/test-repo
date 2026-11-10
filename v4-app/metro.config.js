// Experiment 4 (V-9): expo-sqlite loads SQLite as a WebAssembly file
// in the browser, so Metro has to treat .wasm files as assets.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push("wasm");

module.exports = config;