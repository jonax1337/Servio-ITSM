"use client";

import { createContext, useContext, useState } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ToolFallback } from "@/components/tool-fallback";
import { ProposalCard, type ProposalStatus } from "./proposal-card";
import { ToolActivityChip, hasToolActivity } from "./tool-activity";
import {
  SableCitationRow,
  SableDraftCard,
  SableFileHitsCard,
  SableSourcesCard,
  SableTicketCard,
  type Citation,
} from "./sable-read-cards";
import { toast } from "sonner";
import { dismissAssistantProposal, type AssistantProposal } from "@/lib/actions/ai-assistant";
import { parseRemoteToolName } from "@/lib/claude-agent-events";
import { approvalCardProposal, mcpCallLabel } from "@/lib/sable-mcp-policy";

/** Provides the active conversation id to proposal cards (for applyAssistantProposal). */
export const SableConversationContext = createContext<string>("");

/** Tool name of an approval card rebuilt from a reloaded transcript (sable-thread hydrate). */
export const RESTORED_PROPOSAL_TOOL = "propose_restored";

/**
 * Tool UI for the assistant-ui thread: renders Sable's approve-first
 * `ProposalCard` for `propose_*` write tools and for remote MCP calls that need
 * approval (both carry the proposal in their result), a compact branded
 * activity chip for known read tools, the default collapsible fallback labelled
 * "<server> · <tool>" for remote MCP calls, and the plain fallback for anything
 * else (or a read tool that errored).
 */
export const SableToolUI: ToolCallMessagePartComponent = (props) => {
  // The synthetic "Sources" part (emitted after the answer) — render the panel
  // directly from its result, no chip.
  if (props.toolName === "cited_sources") {
    return props.result ? <SableSourcesCard result={props.result} /> : null;
  }
  const proposal = approvalCardProposal(props.toolName, props.result);
  if (proposal) return <ProposalTool proposal={{ ...proposal, toolCallId: proposal.toolCallId ?? props.toolCallId }} />;
  // A propose_* still running / not yet resolved — render nothing (no ugly generic card).
  if (props.toolName.startsWith("propose_")) return null;
  const remote = parseRemoteToolName(props.toolName);
  if (remote) return <ToolFallback {...props} toolName={mcpCallLabel(remote.server, remote.tool)} />;
  if (hasToolActivity(props.toolName) && props.status?.type !== "incomplete") {
    const running = props.status?.type === "running";
    return (
      <div className="flex flex-col gap-1">
        <ToolActivityChip
          toolName={props.toolName}
          args={props.args as Record<string, unknown> | undefined}
          running={running}
        />
        {!running ? (
          <div className="aui-tool-detail empty:hidden">
            <BrandedResult
              toolName={props.toolName}
              result={props.result}
              args={props.args as Record<string, unknown> | undefined}
            />
          </div>
        ) : null}
      </div>
    );
  }
  return <ToolFallback {...props} />;
};

/**
 * Generative read UI for a couple of high-value tools, rendered from the tool
 * RESULT beneath its activity chip. Quietly returns nothing when there's no
 * result (e.g. the buffered claude-code path never surfaces tool outputs), so
 * the chip alone remains the graceful baseline. `draft_document` is the
 * exception: its `execute` is a pure pass-through of the args, so the card can
 * (and must) fall back to the ARGS — otherwise providers that don't surface tool
 * results to the client (Ollama streaming, buffered claude-code) would never
 * show the artifact at all.
 */
function BrandedResult({
  toolName,
  result,
  args,
}: {
  toolName: string;
  result: unknown;
  args?: Record<string, unknown>;
}) {
  if (toolName === "draft_document") {
    return <SableDraftCard result={result} args={args} />;
  }
  if (result == null) return null;
  switch (toolName) {
    // Console only: the ticket card links to /tickets/[id]. Portal's
    // get_my_ticket keeps its plain chip (its route is /portal/tickets/[id]).
    case "get_ticket":
      return <SableTicketCard result={result} />;
    case "project_search_files":
      return <SableFileHitsCard result={result} />;
    case "search_knowledge_base":
    case "search_knowledge":
      return <SableCitationRow citations={knowledgeCitations(result)} />;
    default:
      return null;
  }
}

/** KB search returns `[{ title, url, excerpt, audience }]`; keep the real hits. */
function knowledgeCitations(result: unknown): Citation[] {
  if (!Array.isArray(result)) return [];
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const row of result) {
    const r = row as { title?: unknown; url?: unknown };
    const title = typeof r.title === "string" ? r.title : "";
    const url = typeof r.url === "string" ? r.url : "";
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);
    out.push({ label: title, href: url });
  }
  return out;
}

/** The card's starting state: the decision a reloaded transcript carries, else pending. */
function initialStatus(proposal: AssistantProposal): ProposalStatus {
  if (proposal.decision?.status === "applied") return { status: "applied", msg: proposal.decision.summary ?? "Applied" };
  if (proposal.decision?.status === "dismissed") return { status: "dismissed" };
  if (proposal.decision?.status === "unconfirmed") {
    return { status: "error", msg: "Applying this did not confirm. Check the record before asking Sable again." };
  }
  return { status: "idle" };
}

function ProposalTool({ proposal }: { proposal: AssistantProposal }) {
  const conversationId = useContext(SableConversationContext);
  const [status, setStatus] = useState<ProposalStatus>(() => initialStatus(proposal));

  // Once dismissed, it's gone for good (the server remembers it across reloads).
  if (status.status === "dismissed") return null;

  return (
    <ProposalCard
      conversationId={conversationId}
      proposal={proposal}
      status={status}
      onStatusChange={(next) => {
        if (next.status !== "dismissed") {
          setStatus(next);
          return;
        }
        void dismissAssistantProposal({ conversationId, proposal }).then((res) => {
          if (res.ok) setStatus(next);
          else toast.error(res.error ?? "Could not dismiss");
        });
      }}
    />
  );
}
