import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyCkfbHrlTppWGm5Cgag2aJVv2RvEexxaTw",
  authDomain: "adminhubsolutions.firebaseapp.com",
  projectId: "adminhubsolutions",
  storageBucket: "adminhubsolutions.firebasestorage.app",
  messagingSenderId: "551227170830",
  appId: "1:551227170830:web:76177508a429ff35f8dc5f",
  measurementId: "G-M03FS74TNJ",
};

export const firebaseApp: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

let analyticsPromise: Promise<Analytics | null> | null = null;

export function getFirebaseAnalytics() {
  if (typeof window === "undefined") return Promise.resolve(null);

  if (!analyticsPromise) {
    analyticsPromise = isSupported()
      .then((supported) => (supported ? getAnalytics(firebaseApp) : null))
      .catch(() => null);
  }

  return analyticsPromise;
}
