import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "hunted_install_dismissed_v1";

export function useInstallPrompt() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    let dismissedAt = 0;
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (raw) dismissedAt = parseInt(raw, 10);
    } catch { /* ignore */ }
    // Re-show after 7 days
    const cooldownExpired = Date.now() - dismissedAt > 7 * 24 * 60 * 60 * 1000;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      if (cooldownExpired) {
        setPrompt(e as BeforeInstallPromptEvent);
      }
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    // Detect already-installed standalone PWA
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setInstalled(true);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const accept = async () => {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    setPrompt(null);
  };

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    setPrompt(null);
  };

  return { canInstall: !!prompt && !installed, accept, dismiss, installed };
}
