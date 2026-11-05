"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { KeyRound, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { createApiToken, type ActionState } from "@/lib/actions/tokens";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ComboField } from "@/components/combo-field";
import type { ComboOption } from "@/components/combobox";

const SCOPE_OPTIONS: ComboOption[] = [
  { value: "read", label: "Read only" },
  { value: "read,write", label: "Read & write" },
  { value: "read,write,admin", label: "Read, write & admin" },
];

export function TokenManager() {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    createApiToken,
    undefined,
  );
  const submit = useFormSubmit(action);
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending) {
      if (state?.error) {
        toast.error(state.error);
      } else if (state?.token) {
        toast.success("API token created");
        formRef.current?.reset();
      }
    }
    wasPending.current = pending;
  }, [pending, state]);

  const fe = state?.fieldErrors ?? {};

  return (
    <div className="grid gap-4">
      {state?.token ? (
        <Alert>
          <KeyRound />
          <AlertTitle>Copy your new token now</AlertTitle>
          <AlertDescription className="grid gap-2">
            <p>
              This is the only time the full token will be shown. Store it
              somewhere safe — you won&apos;t be able to see it again.
            </p>
            <code className="block w-full overflow-x-auto rounded-md border bg-muted px-2.5 py-1.5 font-mono text-xs text-foreground">
              {state.token}
            </code>
          </AlertDescription>
        </Alert>
      ) : null}

      <form ref={formRef} method="post" onSubmit={submit} className="grid gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid min-w-48 flex-1 gap-1.5">
            <Label htmlFor="token-name">Name</Label>
            <Input
              id="token-name"
              name="name"
              placeholder="e.g. CI pipeline"
              required
            />
          </div>
          <div className="grid min-w-48 gap-1.5">
            <Label>Scopes</Label>
            <ComboField name="scopes" options={SCOPE_OPTIONS} defaultValue="read" />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Generate token
          </Button>
        </div>
        {fe.name ? (
          <p className="text-xs text-destructive">{fe.name[0]}</p>
        ) : null}
      </form>
    </div>
  );
}
