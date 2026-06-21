module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    // react-native-reanimated/plugin is added in Phase A4/B when the composer
    // and bottom sheets start using reanimated animations. It requires
    // react-native-worklets as a peer, deferred until then.
  }
}
