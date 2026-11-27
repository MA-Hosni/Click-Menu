"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { Catalog, Language } from "../../lib/types";
import { createEmptyCatalog } from "../../lib/menu-data";
import { validateCatalog } from "../../lib/catalog-validation";
import { reconcileCatalogSave } from "./reconcileCatalogSave";
import {
  ADMIN_LANGUAGE_KEY,
  AdminCopyContext,
  adminCopy,
  initialAdminLanguage,
  localizeError,
} from "./i18n/admin-copy";

type CatalogUpdater = (current: Catalog) => Catalog;

interface AdminContextValue {
  user: { name: string } | null;
  catalog: Catalog;
  saved: Catalog;
  loading: boolean;
  saving: boolean;
  error: string;
  conflict: boolean;
  notice: string;
  dirty: boolean;
  uiLanguage: Language;
  t: (typeof adminCopy)[Language];
  reload: (copy?: (typeof adminCopy)[Language]) => Promise<void>;
  updateCatalog: (updater: CatalogUpdater) => void;
  clearNotice: () => void;
  saveCatalog: () => Promise<void>;
  signOut: () => Promise<boolean>;
  setDashboardLanguage: (language: Language) => void;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProvider({ children }: { children: ReactNode }) {
  const saveInProgress = useRef(false);
  const [user, setUser] = useState<{ name: string } | null>(null);
  const [catalog, setCatalog] = useState<Catalog>(createEmptyCatalog);
  const [saved, setSaved] = useState<Catalog>(createEmptyCatalog);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const [uiLanguage, setUiLanguage] = useState<Language>("en");
  const t = adminCopy[uiLanguage];
  const dirty = JSON.stringify(catalog) !== JSON.stringify(saved);

  const reload = useCallback(async (copy: (typeof adminCopy)[Language] = adminCopy.en) => {
    setLoading(true);
    setError("");
    setConflict(false);
    try {
      const session = await fetch("/api/me", { cache: "no-store" });
      if (!session.ok) throw new Error(copy.errorSignIn);
      const sessionData = (await session.json()) as { user: { name: string } | null };
      setUser(sessionData.user);
      if (sessionData.user) {
        const response = await fetch("/api/admin/catalog", {
          cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(
            (data as { error?: string }).error || copy.errorLoad,
          );
        const nextCatalog = data.revision === 0 ? createEmptyCatalog() : validateCatalog(data);
        setCatalog(nextCatalog);
        setSaved(nextCatalog);
      } else {
        const empty = createEmptyCatalog();
        setCatalog(empty);
        setSaved(empty);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.errorLoad);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const language = initialAdminLanguage();
      setUiLanguage(language);
      void reload(adminCopy[language]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const updateCatalog = useCallback((updater: CatalogUpdater) => {
    setCatalog(updater);
  }, []);

  const clearNotice = useCallback(() => setNotice(""), []);

  const setDashboardLanguage = useCallback((next: Language) => {
    setUiLanguage(next);
    try {
      localStorage.setItem(ADMIN_LANGUAGE_KEY, next);
    } catch {}
  }, []);

  const saveCatalog = useCallback(async () => {
    if (saveInProgress.current) return;

    setError("");
    setConflict(false);
    setNotice("");
    const submittedDraft = structuredClone(catalog);
    let checked: Catalog;
    try {
      checked = validateCatalog(submittedDraft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.errorFields);
      return;
    }
    saveInProgress.current = true;
    setSaving(true);
    try {
      const response = await fetch("/api/admin/catalog", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checked),
      });
      const data = await response.json();
      if (!response.ok) {
        setConflict(response.status === 409);
        throw new Error((data as { error?: string }).error || t.errorSave);
      }
      const savedCatalog = validateCatalog(data);
      setCatalog((current) =>
        reconcileCatalogSave(current, submittedDraft, savedCatalog),
      );
      setSaved(savedCatalog);
      setNotice(t.savedNotice);
    } catch (cause) {
      setError(
        cause instanceof Error ? localizeError(cause.message, t) : t.errorSave,
      );
    } finally {
      saveInProgress.current = false;
      setSaving(false);
    }
  }, [catalog, t]);

  const signOut = useCallback(async () => {
    if (dirty && !window.confirm(t.confirmSignOut)) return false;
    try {
      await fetch("/api/auth/signout", { method: "POST" });
      return true;
    } finally {
      void reload(t);
    }
  }, [dirty, reload, t]);

  const value = useMemo(
    () => ({
      user,
      catalog,
      saved,
      loading,
      saving,
      error,
      conflict,
      notice,
      dirty,
      uiLanguage,
      t,
      reload,
      updateCatalog,
      clearNotice,
      saveCatalog,
      signOut,
      setDashboardLanguage,
    }),
    [
      user,
      catalog,
      saved,
      loading,
      saving,
      error,
      conflict,
      notice,
      dirty,
      uiLanguage,
      t,
      reload,
      updateCatalog,
      clearNotice,
      saveCatalog,
      signOut,
      setDashboardLanguage,
    ],
  );

  return (
    <AdminCopyContext.Provider value={{ t, language: uiLanguage }}>
      <AdminContext.Provider value={value}>{children}</AdminContext.Provider>
    </AdminCopyContext.Provider>
  );
}

export function useAdmin() {
  const context = useContext(AdminContext);
  if (!context) throw new Error("useAdmin must be used within AdminProvider.");
  return context;
}
