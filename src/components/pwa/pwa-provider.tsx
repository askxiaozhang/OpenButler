"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

type Platform = "android" | "ios" | "other";

interface PwaContextValue {
  canInstall: boolean;
  installed: boolean;
  platform: Platform;
  install(): Promise<boolean>;
}

const PwaContext = createContext<PwaContextValue>({
  canInstall: false,
  installed: false,
  platform: "other",
  install: async () => false,
});

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<Platform>("other");

  useEffect(() => {
    function onInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    }

    function onInstalled() {
      setInstallPrompt(null);
      setInstalled(true);
    }

    async function initialize() {
      await Promise.resolve();
      const userAgent = navigator.userAgent;
      setPlatform(
        /Android/i.test(userAgent)
          ? "android"
          : /iPhone|iPad|iPod/i.test(userAgent)
            ? "ios"
            : "other",
      );
      setInstalled(
        window.matchMedia("(display-mode: standalone)").matches ||
          Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
      );
      if ("serviceWorker" in navigator) {
        await navigator.serviceWorker.register("/sw.js");
      }
    }

    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    void initialize();
    return () => {
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    function clearBadge() {
      if (document.visibilityState !== "visible") return;
      if (typeof navigator.clearAppBadge === "function") void navigator.clearAppBadge();
    }
    document.addEventListener("visibilitychange", clearBadge);
    clearBadge();
    return () => document.removeEventListener("visibilitychange", clearBadge);
  }, []);

  const value = useMemo<PwaContextValue>(
    () => ({
      canInstall: Boolean(installPrompt),
      installed,
      platform,
      install: async () => {
        if (!installPrompt) return false;
        await installPrompt.prompt();
        const choice = await installPrompt.userChoice;
        if (choice.outcome === "accepted") {
          setInstallPrompt(null);
          setInstalled(true);
          return true;
        }
        return false;
      },
    }),
    [installPrompt, installed, platform],
  );

  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>;
}

export function usePwa() {
  return useContext(PwaContext);
}
