"use client";

import { useState } from "react";
import { Pencil, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { ConfirmButton } from "@/components/confirm-dialog";
import { CategoryForm, type CategoryData, type ParentOption, type TeamOption } from "@/components/categories/category-form";
import { setCategoryArchived, deleteCategory } from "@/lib/actions/categories";
import { useT } from "@/lib/i18n/client";

export function CategoryRowActions({
  category,
  parents,
  teams,
  archived,
  deletable,
}: {
  category: CategoryData;
  parents: ParentOption[];
  teams: TeamOption[];
  archived: boolean;
  deletable: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const t = useT("categories");

  return (
    <div className="flex items-center gap-1">
      {/* Edit */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("edit.title")} />}>
          <Pencil className="size-4 text-muted-foreground" />
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("edit.title")}</DialogTitle>
            <DialogDescription>{t("edit.description")}</DialogDescription>
          </DialogHeader>
          <CategoryForm parents={parents} teams={teams} category={category} />
        </DialogContent>
      </Dialog>

      {/* Archive / Restore */}
      <form action={setCategoryArchived}>
        <input type="hidden" name="id" value={category.id} />
        <input type="hidden" name="archived" value={archived ? "false" : "true"} />
        <Button type="submit" variant="ghost" size="icon-sm" aria-label={archived ? t("restore") : t("archive")}>
          {archived ? (
            <ArchiveRestore className="size-4 text-muted-foreground" />
          ) : (
            <Archive className="size-4 text-muted-foreground" />
          )}
        </Button>
      </form>

      {/* Delete — only when nothing references it */}
      {deletable ? (
        <ConfirmButton
          action={deleteCategory}
          fields={{ id: category.id }}
          title={t("delete.title")}
          description={t("delete.description", { name: category.name })}
          triggerVariant="ghost"
          triggerLabel={t("delete.label")}
        >
          <Trash2 className="size-4 text-muted-foreground" />
        </ConfirmButton>
      ) : null}
    </div>
  );
}
