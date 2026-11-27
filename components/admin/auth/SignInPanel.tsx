"use client";

import { useState } from "react";
import { ArrowRight, KeyRound } from "lucide-react";
import { localizeError, useAdminCopy } from "../../../features/admin/i18n/admin-copy";

async function signIn(password: string): Promise<void> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const data = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(data.error || "");
}

export default function SignInPanel({
  onSignedIn,
}: {
  onSignedIn: () => void;
}) {
  const { t } = useAdminCopy();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await signIn(password);
      onSignedIn();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? localizeError(cause.message, t)
          : t.tryAgain,
      );
      setBusy(false);
    }
  }

  return (
    <section className="admin-signin">
      <div>
        <h2>{t.signInTitle}</h2>
        <p>{t.signInIntro}</p>
      </div>
      <form className="admin-signin-form" onSubmit={submit}>
        <label className="admin-field">
          {t.passwordLabel}
          <input
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button type="submit" className="admin-primary" aria-busy={busy}>
          <KeyRound size={16} />
          {busy ? t.checking : t.signIn}
          <ArrowRight size={16} />
        </button>
      </form>
      {error && (
        <p className="admin-error admin-signin-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
