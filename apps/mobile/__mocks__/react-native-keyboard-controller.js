// Jest auto-uses manual mocks for node_modules placed in <rootDir>/__mocks__.
// react-native-keyboard-controller ships native views that don't exist in the
// jest environment; its bundled mock swaps them for plain RN components.
module.exports = require('react-native-keyboard-controller/jest')
