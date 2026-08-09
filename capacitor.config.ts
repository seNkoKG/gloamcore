import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.ninjalens.poe",
  appName: "Ninja Lens",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    SplashScreen: {
      launchShowDuration: 900,
      launchAutoHide: true,
      backgroundColor: "#071014",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#071014",
      overlaysWebView: false,
    },
    LocalNotifications: {
      smallIcon: "ic_stat_ninja_lens",
      iconColor: "#2fe0ad",
    },
  },
};

export default config;
