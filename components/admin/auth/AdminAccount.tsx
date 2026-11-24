"use client";

import { useRouter } from "next/navigation";
import { useAdmin } from "../../../features/admin/AdminProvider";

export default function AdminAccount() {
  const { user, t, signOut } = useAdmin();
  const router = useRouter();

  async function handleSignOut() {
    try {
      if (await signOut()) router.replace("/admin/menu");
    } catch (error) {
      router.replace("/admin/menu");
      throw error;
    }
  }

  return (
    <>
      <div className="admin-account">
        <span>{user?.name?.slice(0, 1).toUpperCase() || "D"}</span>
        <div>
          <strong>{user?.name || t.demoWorkspace}</strong>
          <small>{user ? t.signedInByEmail : t.exploreBeforeSignIn}</small>
        </div>
      </div>
      {user && (
        <button
          type="button"
          className="admin-signout"
          onClick={() => void handleSignOut()}
        >
          {t.signOut}
        </button>
      )}
    </>
  );
}
