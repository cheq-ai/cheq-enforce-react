// Dynamic Expo config: the version comes from package.json, so `npm run set-version`
// updates it along with the other version fields.
const { version } = require("./package.json");

module.exports = {
  expo: {
    name: "enforce-react-demo",
    slug: "enforce-react-demo",
    version,
    orientation: "portrait",
    scheme: "enforcedemo",
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.cheq.enforceReactDemo",
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#ffffff",
      },
      package: "com.cheq.enforceReactDemo",
    },
    web: {
      bundler: "metro",
    },
    plugins: [
      "expo-dev-client",
    ],
  },
};
