"use client";
import { useEffect, useRef } from "react";
import { acceptInvitation } from "@/app/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
export function AcceptInvitationForm() {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get(
      "token",
    );
    if (token && input.current) input.current.value = token;
    if (token) window.history.replaceState(null, "", window.location.pathname);
  }, []);
  return (
    <form action={acceptInvitation} className="space-y-5">
      <label>
        Invitation token
        <Input ref={input} name="token" required pattern="[a-f0-9]{64}" />
      </label>
      <Button>Accept invitation</Button>
    </form>
  );
}
