"use client";

import * as React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold, Italic, Underline, List, ListOrdered, Link as LinkIcon, Heading2, Heading3, Pilcrow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { sanitizeCommentHtml } from "@/lib/markdown";
import { createMentionExtension, type MentionUser } from "./mention-extension";

export type { MentionUser };

/** Imperative handle exposed via `onReady` so callers (e.g. AI helpers) can read
 *  or replace the editor content. Writes go through the same sync path as typing,
 *  so the required hidden input stays in step. */
export type RichTextEditorHandle = {
  /** Replace the whole document with plain text (blank lines → paragraphs). */
  setText: (text: string) => void;
  /** Replace the whole document with (sanitized) rich HTML — e.g. rendered markdown. */
  setHTML: (html: string) => void;
  /** Current plain-text content. */
  getText: () => string;
  /** True when the editor is empty. */
  isEmpty: () => boolean;
  /** Plain text of the current selection ("" when nothing is selected). */
  getSelectionText: () => string;
  /** Replace the current selection with plain text (kept inline). */
  replaceSelection: (text: string) => void;
  /** Move focus into the editor. */
  focus: () => void;
};

export type RichTextEditorProps = {
  name: string;
  defaultHTML?: string;
  placeholder?: string;
  required?: boolean;
  className?: string;
  ariaLabel?: string;
  mentionUsers?: MentionUser[];
  onChangeHTML?: (html: string) => void;
  onReady?: (handle: RichTextEditorHandle) => void;
  /** Actions rendered inside the editor field, pinned bottom-left (e.g. AI helpers).
   *  When set, the field grows taller and reserves bottom padding so text never
   *  flows under the buttons. */
  innerActions?: React.ReactNode;
};

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Plain text → paragraph HTML (double newline splits paragraphs, single → <br>). */
function textToHtml(text: string) {
  const blocks = text.trim().split(/\n{2,}/).filter(Boolean);
  if (blocks.length === 0) return "<p></p>";
  return blocks.map((b) => `<p>${escapeHtml(b).replace(/\n/g, "<br />")}</p>`).join("");
}

// Border/ring chrome + prose typography (matches render sites) + placeholder + live chip.
const EDITOR_CLASS = cn(
  "prose prose-sm dark:prose-invert max-w-none",
  "min-h-24 w-full rounded-lg border border-input bg-transparent p-2.5 text-sm outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
  "[&_.is-editor-empty]:before:pointer-events-none [&_.is-editor-empty]:before:float-left",
  "[&_.is-editor-empty]:before:h-0 [&_.is-editor-empty]:before:text-muted-foreground",
  "[&_.is-editor-empty]:before:content-[attr(data-placeholder)]",
  "[&_.mention]:rounded [&_.mention]:bg-primary/10 [&_.mention]:px-1 [&_.mention]:font-medium [&_.mention]:text-primary",
);

function ToolbarButton({ active, onClick, label, disabled, children }: {
  active?: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={!!active}
      disabled={disabled}
      onClick={onClick}
      className={cn(active && "bg-muted text-foreground")}
    >
      {children}
    </Button>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [linkUrl, setLinkUrl] = React.useState("");
  const disabled = !editor;
  const t = useT("components");

  return (
    <div role="toolbar" aria-label={t("editor.formatting")} className="flex flex-wrap items-center gap-0.5 rounded-lg border p-1">
      <ToolbarButton disabled={disabled} active={editor?.isActive("paragraph")} onClick={() => editor?.chain().focus().setParagraph().run()} label={t("editor.paragraph")}><Pilcrow className="size-4" /></ToolbarButton>
      <ToolbarButton disabled={disabled} active={editor?.isActive("heading", { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} label={t("editor.heading2")}><Heading2 className="size-4" /></ToolbarButton>
      <ToolbarButton disabled={disabled} active={editor?.isActive("heading", { level: 3 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} label={t("editor.heading3")}><Heading3 className="size-4" /></ToolbarButton>
      <span className="mx-0.5 h-4 w-px bg-border" />
      <ToolbarButton disabled={disabled} active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()} label={t("editor.bold")}><Bold className="size-4" /></ToolbarButton>
      <ToolbarButton disabled={disabled} active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()} label={t("editor.italic")}><Italic className="size-4" /></ToolbarButton>
      <ToolbarButton disabled={disabled} active={editor?.isActive("underline")} onClick={() => editor?.chain().focus().toggleUnderline().run()} label={t("editor.underline")}><Underline className="size-4" /></ToolbarButton>
      <ToolbarButton disabled={disabled} active={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()} label={t("editor.bulletList")}><List className="size-4" /></ToolbarButton>
      <ToolbarButton disabled={disabled} active={editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()} label={t("editor.numberedList")}><ListOrdered className="size-4" /></ToolbarButton>
      <Popover
        open={linkOpen}
        onOpenChange={(o) => { setLinkOpen(o); if (o) setLinkUrl((editor?.getAttributes("link").href as string) ?? ""); }}
      >
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("editor.link")}
              aria-pressed={!!editor?.isActive("link")}
              disabled={disabled}
              className={cn(editor?.isActive("link") && "bg-muted text-foreground")}
            />
          }
        >
          <LinkIcon className="size-4" />
        </PopoverTrigger>
        <PopoverContent className="w-64">
          <div className="grid gap-2">
            <Input type="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" className="h-8" />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => { editor?.chain().focus().extendMarkRange("link").unsetLink().run(); setLinkOpen(false); }}>{t("editor.removeLink")}</Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  const url = linkUrl.trim();
                  if (!/^https?:\/\//i.test(url)) return;
                  editor?.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
                  setLinkOpen(false);
                }}
              >
                {t("editor.addLink")}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function RichTextEditor({
  name, defaultHTML, placeholder, required, className, ariaLabel, mentionUsers, onChangeHTML, onReady, innerActions,
}: RichTextEditorProps) {
  const hiddenRef = React.useRef<HTMLInputElement>(null);
  const onChangeRef = React.useRef(onChangeHTML);
  React.useEffect(() => { onChangeRef.current = onChangeHTML; }, [onChangeHTML]);
  const onReadyRef = React.useRef(onReady);
  React.useEffect(() => { onReadyRef.current = onReady; }, [onReady]);

  // The form bridge — mirrors the editor HTML into an sr-only REQUIRED input so
  // empty submits are blocked with real feedback (type=hidden would be a no-op).
  const syncToInput = React.useCallback((ed: Editor) => {
    const hidden = hiddenRef.current;
    if (!hidden) return;
    const empty = ed.isEmpty;
    const clean = empty ? "" : sanitizeCommentHtml(ed.getHTML());
    hidden.value = clean;
    hidden.setCustomValidity(required && empty ? "Please write a message." : "");
    onChangeRef.current?.(clean);
  }, [required]);

  const extensions = React.useMemo(() => [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        protocols: ["http", "https", "mailto", "tel"],
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      },
    }),
    Placeholder.configure({ placeholder: placeholder ?? "" }),
    createMentionExtension(mentionUsers ?? []),
  ], [mentionUsers, placeholder]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: sanitizeCommentHtml(defaultHTML ?? ""),
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": ariaLabel ?? "",
        spellcheck: "true",
        class: cn(EDITOR_CLASS, innerActions && "min-h-40 pb-12"),
      },
      transformPastedHTML: (html: string) => sanitizeCommentHtml(html),
    },
    onCreate: ({ editor }) => syncToInput(editor),
    onUpdate: ({ editor }) => syncToInput(editor),
  });

  // Expose an imperative handle once the editor exists. Writes use a single
  // chained transaction (clearContent + insertContent) so onUpdate fires once →
  // syncToInput re-populates the required hidden input, exactly like typing.
  React.useEffect(() => {
    if (!editor) return;
    onReadyRef.current?.({
      setText: (text: string) => {
        editor.chain().focus().clearContent(true).insertContent(textToHtml(text)).run();
      },
      setHTML: (html: string) => {
        editor.chain().focus().clearContent(true).insertContent(sanitizeCommentHtml(html)).run();
      },
      getText: () => editor.getText(),
      isEmpty: () => editor.isEmpty,
      getSelectionText: () => {
        const { from, to } = editor.state.selection;
        return from === to ? "" : editor.state.doc.textBetween(from, to, "\n");
      },
      replaceSelection: (text: string) => {
        // insertContent replaces the current selection; keep it inline (no <p> wrap).
        const inline = escapeHtml(text).replace(/\n/g, "<br />");
        editor.chain().focus().insertContent(inline).run();
      },
      focus: () => editor.commands.focus(),
    });
  }, [editor]);

  // Clear the editor when the surrounding form resets. Anchor off the hidden
  // input (always in the DOM) rather than the editor DOM (mounts a tick later).
  React.useEffect(() => {
    if (!editor) return;
    const hidden = hiddenRef.current;
    const form = hidden?.closest("form");
    if (!form) return;
    const onReset = () => {
      // clearContent(true) emits an update → syncToInput resets value AND validity
      // (empty+required → the "please write" message), so re-submitting an empty
      // form is still blocked. Don't hand-clear validity here (it would mask that).
      editor.commands.clearContent(true);
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [editor]);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Toolbar editor={editor} />
      <div className="relative">
        <EditorContent editor={editor} />
        {innerActions ? (
          <div className="absolute bottom-2 left-2 flex items-center gap-1.5">{innerActions}</div>
        ) : null}
      </div>
      {/* sr-only but validation-participating (type=hidden would make required a no-op). */}
      <input name={name} ref={hiddenRef} required={required} tabIndex={-1} aria-hidden="true" className="sr-only" />
    </div>
  );
}

export { RichTextEditor };
