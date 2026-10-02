const { withAndroidStyles } = require("expo/config-plugins");

/**
 * SDK 54 writes android:enforceNavigationBarContrast from
 * androidNavigationBar.enforceContrast, but later style plugins can miss it.
 * Force the flag off last so 3-button Android nav stays fully transparent
 * instead of drawing the system contrast scrim.
 */
function withAndroidNavigationBarContrast(config) {
  return withAndroidStyles(config, (configWithStyles) => {
    const contrastItem = {
      _: "false",
      $: {
        name: "android:enforceNavigationBarContrast",
        "tools:targetApi": "29",
      },
    };
    const styles = configWithStyles.modResults.resources.style ?? [];
    const mainThemeIndex = styles.findIndex(({ $ }) => $.name === "AppTheme");
    if (mainThemeIndex === -1) return configWithStyles;

    const mainTheme = styles[mainThemeIndex];
    const items = mainTheme.item ?? [];
    const enforceIndex = items.findIndex(
      ({ $ }) => $.name === "android:enforceNavigationBarContrast",
    );
    if (enforceIndex === -1) {
      mainTheme.item = [contrastItem, ...items];
    } else {
      items[enforceIndex] = contrastItem;
    }
    return configWithStyles;
  });
}

module.exports = withAndroidNavigationBarContrast;
