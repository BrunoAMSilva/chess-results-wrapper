let firebaseAuthModulePromise: Promise<typeof import("../lib/firebase-auth-client")> | null = null;

function loadFirebaseAuthModule() {
  if (!firebaseAuthModulePromise) {
    firebaseAuthModulePromise = import("../lib/firebase-auth-client");
  }

  return firebaseAuthModulePromise;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const message = error.message || "";
  if (
    message.includes("Outdated Optimize Dep")
    || message.includes("Failed to fetch dynamically imported module")
  ) {
    return fallback;
  }

  return message;
}

export function initLoginPage() {
  const card = document.querySelector<HTMLElement>(".login-card");
  if (!card || card.dataset.loginBound === "true") {
    return;
  }

  card.dataset.loginBound = "true";

  const rawRedirectUrl = card.dataset.redirect || "/referee";
  const redirectUrl = rawRedirectUrl.startsWith("/") && !rawRedirectUrl.startsWith("//")
    ? rawRedirectUrl
    : "/referee";
  const loadErrorMessage = card.dataset.loadError || "Unable to load Google sign-in. Refresh the page and try again.";

  const button = document.getElementById("googleSignIn") as HTMLButtonElement | null;
  const spinner = document.getElementById("signInSpinner") as HTMLElement | null;
  const errorEl = document.getElementById("authError") as HTMLElement | null;
  const errorMsg = document.getElementById("authErrorMessage") as HTMLElement | null;

  if (!button || !spinner || !errorEl || !errorMsg) {
    return;
  }

  const setPending = (pending: boolean) => {
    button.disabled = pending;
    button.hidden = pending;
    spinner.hidden = !pending;
  };

  setPending(false);
  errorEl.hidden = true;

  button.addEventListener("click", async () => {
    setPending(true);
    errorEl.hidden = true;

    try {
      const { signInWithGooglePopup } = await loadFirebaseAuthModule();
      const token = await signInWithGooglePopup();

      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Login failed");
      }

      window.location.href = redirectUrl;
    } catch (error) {
      const authError = error as { code?: string };
      if (
        authError.code === "auth/popup-closed-by-user"
        || authError.code === "auth/cancelled-popup-request"
      ) {
        setPending(false);
        return;
      }

      errorMsg.textContent = getErrorMessage(error, loadErrorMessage);
      errorEl.hidden = false;
      setPending(false);
    }
  });
}
