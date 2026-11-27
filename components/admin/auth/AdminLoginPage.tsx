"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAdmin } from "../../../features/admin/AdminProvider";
import SignInPanel from "./SignInPanel";

export default function AdminLoginPage() {
  const { user, loading, reload, t } = useAdmin();
  const router = useRouter();

  useEffect(() => {
    if (user) router.replace("/admin/menu");
  }, [router, user]);

  return (
    <main className="admin-sheet">
      {loading ? (
        <div className="admin-loading" role="status">
          <p>{t.opening}</p>
        </div>
      ) : user ? null : (
        <SignInPanel onSignedIn={() => void reload(t)} />
      )}
    </main>
  );
}
