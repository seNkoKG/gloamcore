import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { LocalNotifications } from "@capacitor/local-notifications";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";

export const isNativeMobile = Capacitor.isNativePlatform();
export const isMobileApp =
  isNativeMobile ||
  (typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("mobile") === "1");

export async function configureMobileRuntime() {
  if (!isNativeMobile) return;
  document.documentElement.dataset.platform = Capacitor.getPlatform();
  try {
    await StatusBar.setStyle({ style: Style.Light });
    if (Capacitor.getPlatform() === "android") {
      await StatusBar.setBackgroundColor({ color: "#071014" });
    }
  } catch {
    // Status bar customisation is cosmetic.
  }
  try {
    await SplashScreen.hide();
  } catch {
    // The native launch screen may already be hidden.
  }
}

export async function tactileTap() {
  if (!isNativeMobile) return;
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    // Haptics are optional.
  }
}

export async function preparePriceAlerts() {
  if (!isNativeMobile) return false;
  try {
    let permission = await LocalNotifications.checkPermissions();
    if (permission.display === "prompt") {
      permission = await LocalNotifications.requestPermissions();
    }
    return permission.display === "granted";
  } catch {
    return false;
  }
}

export async function notifyPriceTarget(
  title: string,
  body: string,
  id: number,
) {
  if (isNativeMobile) {
    if (!(await preparePriceAlerts())) return;
    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            id,
            title,
            body,
            schedule: { at: new Date(Date.now() + 250) },
            extra: { route: "watchlist" },
          },
        ],
      });
    } catch {
      // The in-app alert badge remains the fallback.
    }
    return;
  }
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch {
    // The in-app alert badge remains the fallback.
  }
}
