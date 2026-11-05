"use client";

import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Loader2, Pencil, Plus, Save, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createSkill, deleteSkill, getSkill, importSkill, setSkillEnabled, updateSkill } from "@/lib/actions/sable-skills";
import { AI_ASSISTANT_NAME } from "@/lib/constants";
import { SKILL_BODY_MAX, SKILL_DESCRIPTION_MAX, SKILL_NAME_MAX, validateSkill } from "@/lib/sable-skills";
import type { SableSkill } from "@/lib/sable-workspace";

type Editor = { mode: "create" } | { mode: "edit" | "view"; skill: SableSkill };

const SOURCE_LABEL = { builtin: "Built-in", custom: "Custom" } as const;

function SourceBadge({ source }: { source: SableSkill["source"] }) {
  const tone = source === "custom" ? "bg-sable-muted text-sable" : "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>{SOURCE_LABEL[source]}</span>;
}

function SkillCard({ skill, onOpen }: { skill: SableSkill; onOpen: (editor: Editor) => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useOptimistic(skill.enabled);
  const isCustom = skill.source === "custom";

  const toggle = (next: boolean) =>
    startTransition(async () => {
      setEnabled(next);
      const result = await setSkillEnabled({ name: skill.name, id: skill.id }, next);
      if (!result.ok) toast.error(result.error ?? "Could not change the skill.");
      router.refresh();
    });

  return (
    <li className="grid content-between gap-3 rounded-lg border p-3">
      <div className="grid gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate font-mono text-xs font-medium">{skill.name}</span>
          <SourceBadge source={skill.source} />
        </div>
        <span className="line-clamp-2 text-xs text-muted-foreground">{skill.description}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch size="sm" checked={enabled} disabled={pending} onCheckedChange={toggle} />
          {enabled ? "Enabled" : "Disabled"}
        </label>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={isCustom ? `Edit ${skill.name}` : `View ${skill.name}`}
            onClick={() => onOpen({ mode: isCustom ? "edit" : "view", skill })}
          >
            {isCustom ? <Pencil className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
          {isCustom ? (
            <ConfirmButton
              action={deleteSkill}
              fields={{ id: skill.id ?? "" }}
              title={`Delete "${skill.name}"?`}
              description={`${AI_ASSISTANT_NAME} will no longer have this skill. This cannot be undone.`}
              triggerVariant="ghost"
              triggerLabel={`Delete ${skill.name}`}
              successMessage="Skill deleted."
            />
          ) : null}
        </div>
      </div>
    </li>
  );
}

const EDITOR_TITLE = { create: "New skill", edit: "Edit skill", view: "Built-in skill" } as const;

/** Mounted only while its dialog is open, so every opening starts from fresh state. */
function SkillEditor({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(editor.mode !== "create");
  const readOnly = editor.mode === "view";

  useEffect(() => {
    if (editor.mode === "create") return;
    let cancelled = false;
    getSkill({ name: editor.skill.name, id: editor.skill.id })
      .then((detail) => {
        if (cancelled) return;
        if (!detail) {
          toast.error("Skill not found.");
          onClose();
          return;
        }
        setName(detail.name);
        setDescription(detail.description);
        setBody(detail.body);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        toast.error("Could not load the skill.");
        onClose();
      });
    return () => {
      cancelled = true;
    };
  }, [editor, onClose]);

  const save = () => {
    const input = { name: name.trim(), description: description.trim(), body: body.trim() };
    const invalid = validateSkill(input);
    if (invalid) {
      setError(invalid);
      return;
    }
    startTransition(async () => {
      const result =
        editor.mode === "edit" && editor.skill.id
          ? await updateSkill(editor.skill.id, input)
          : await createSkill(input);
      if (!result.ok) {
        setError(result.error ?? "Could not save the skill.");
        return;
      }
      toast.success(editor.mode === "create" ? "Skill created." : "Skill saved.");
      onClose();
      router.refresh();
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{EDITOR_TITLE[editor.mode]}</DialogTitle>
        <DialogDescription>
          {readOnly
            ? "Shipped with Servio (sable/skills): it can be switched off but not edited."
            : `${AI_ASSISTANT_NAME} loads a skill on demand when its description matches the task.`}
        </DialogDescription>
      </DialogHeader>

      {loading ? (
        <div className="grid place-items-center py-12">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="skill-name">Name</Label>
            <Input
              id="skill-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              readOnly={readOnly}
              maxLength={SKILL_NAME_MAX}
              placeholder="vpn-troubleshooting"
              className="font-mono"
            />
            {readOnly ? null : (
              <p className="text-xs text-muted-foreground">
                Lowercase letters, digits and hyphens. Must not match a built-in name.
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="skill-description">Description</Label>
            <Input
              id="skill-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              readOnly={readOnly}
              maxLength={SKILL_DESCRIPTION_MAX}
              placeholder="Use when a user reports VPN connection problems."
            />
            {readOnly ? null : (
              <p className="text-xs text-muted-foreground">
                One line. {AI_ASSISTANT_NAME} decides from this text when to load the skill.
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="skill-body">Instructions (Markdown)</Label>
            <Textarea
              id="skill-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              readOnly={readOnly}
              maxLength={SKILL_BODY_MAX}
              placeholder={"# VPN troubleshooting\n\n1. Ask which client and OS …"}
              className="max-h-[45vh] min-h-56 overflow-auto font-mono text-xs"
            />
          </div>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          {readOnly ? "Close" : "Cancel"}
        </Button>
        {readOnly ? null : (
          <Button type="button" onClick={save} disabled={pending || loading}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save skill
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

/**
 * Admin management of Sable's skills: switch any skill on or off, create, edit
 * and delete custom ones, import a SKILL.md. Changes apply to the next agent
 * run. Renders inside the page's form, so every button is `type="button"`.
 */
export function AiSkillsManager({ skills }: { skills: SableSkill[] }) {
  const router = useRouter();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [importing, startImport] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const closeEditor = useCallback(() => setEditor(null), []);

  const importFile = (file: File) =>
    startImport(async () => {
      const result = await importSkill(await file.text());
      if (result.ok) toast.success(`Imported ${file.name}.`);
      else toast.error(result.error ?? "Could not import the file.");
      router.refresh();
    });

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {skills.filter((s) => s.enabled).length} of {skills.length} skills enabled. Changes apply to the next run.
        </p>
        <div className="flex gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".md,text/markdown"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) importFile(file);
            }}
          />
          <Button type="button" variant="outline" size="sm" disabled={importing} onClick={() => fileInput.current?.click()}>
            {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Import SKILL.md
          </Button>
          <Button type="button" size="sm" onClick={() => setEditor({ mode: "create" })}>
            <Plus className="size-4" />
            New skill
          </Button>
        </div>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {skills.map((skill) => (
          <SkillCard key={`${skill.source}:${skill.name}`} skill={skill} onOpen={setEditor} />
        ))}
      </ul>

      <Dialog open={editor !== null} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent className="sm:max-w-2xl">
          {editor ? <SkillEditor editor={editor} onClose={closeEditor} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
