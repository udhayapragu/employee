"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "./ui";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" } });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button type="button" onClick={signOut} disabled={pending} className={buttonClass("ghost")}>
      {pending ? "Signing out..." : "Sign out"}
    </button>
  );
}
