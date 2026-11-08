"use client";

import { createContext, useContext, useMemo } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime, AssistantChatTransport } from "@assistant-ui/react-ai-sdk";
import type { UIMessage } from "@ai-sdk/react";
import { Thread } from "@/components/thread";
import { AI_ASSISTANT_NAME } from "@/lib/constants";
import { SableMark } from "@/components/sable-mark";
import { useSableChatAdapters } from "@/components/assistant/sable-adapters";
import { PortalToolUI } from "./portal-tool-ui";
import { useT } from "@/lib/i18n/client";

// Tappable starter prompts shown on the empty portal chat (sent as the user's message,
// so they follow the UI language — Sable answers in the language it is addressed in).
const PORTAL_SUGGESTIONS = ["suggestion.login", "suggestion.password", "suggestion.laptop", "suggestion.status"] as const;

/** The signed-in user's first name, for the personalised empty-state greeting. */
const FirstNameContext = createContext("");

/** Empty-state greeting (replaces a seeded message so the suggestions show). */
function PortalWelcome() {
  const firstName = useContext(FirstNameContext);
  const t = useT("portal");
  return (
    <div className="aui-thread-welcome-root mb-6 flex flex-col items-center gap-3 px-4 text-center">
      <span className="grid size-11 place-items-center rounded-xl bg-sable text-sable-foreground">
        <SableMark className="size-6" />
      </span>
      <h1 className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-xl font-semibold duration-200">
        {t("welcomeTitle", { name: firstName, assistant: AI_ASSISTANT_NAME })}
      </h1>
      <p className="text-muted-foreground max-w-xs text-sm">
        {t("welcomeText")}
      </p>
    </div>
  );
}

const PORTAL_COMPONENTS = { ToolFallback: PortalToolUI, Welcome: PortalWelcome };

/**
 * The self-service (portal) chat — the SAME assistant-ui Thread as the console,
 * bound to the ephemeral portal streaming route (`/api/portal/assistant`, USER
 * scope, no persistence — the runtime holds the transcript) with the portal's
 * confirm-to-create tool UI, image/text attachments + voice dictation, and
 * tappable starter prompts.
 */
export function PortalThread({ firstName }: { firstName: string }) {
  const transport = useMemo(
    () => new AssistantChatTransport<UIMessage>({ api: "/api/portal/assistant" }),
    [],
  );

  const adapters = useSableChatAdapters();
  const t = useT("portal");
  const suggestions = useMemo(() => PORTAL_SUGGESTIONS.map((k) => t(k)), [t]);

  const runtime = useChatRuntime<UIMessage>({ transport, adapters });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <FirstNameContext.Provider value={firstName}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Thread components={PORTAL_COMPONENTS} suggestions={suggestions} />
        </div>
      </FirstNameContext.Provider>
    </AssistantRuntimeProvider>
  );
}
