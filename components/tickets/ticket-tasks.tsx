"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { Plus, X, Square, CheckSquare } from "lucide-react";
import { addTask, toggleTask, deleteTask } from "@/lib/actions/tickets";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Task = { id: string; title: string; done: boolean };

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="icon-sm" variant="ghost" disabled={pending} aria-label="Add task">
      <Plus className="size-4" />
    </Button>
  );
}

export function TicketTasks({ ticketId, tasks }: { ticketId: number; tasks: Task[] }) {
  const ref = useRef<HTMLFormElement>(null);
  const done = tasks.filter((t) => t.done).length;

  return (
    <div className="grid gap-2">
      {tasks.length > 0 ? (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{done}/{tasks.length} done</span>
          <div className="ml-3 h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} />
          </div>
        </div>
      ) : null}

      <ul className="grid gap-1">
        {tasks.map((t) => (
          <li key={t.id} className="group flex items-center gap-2">
            <form action={toggleTask}>
              <input type="hidden" name="taskId" value={t.id} />
              <button type="submit" className="flex items-center text-muted-foreground hover:text-foreground" aria-label="Toggle task">
                {t.done ? <CheckSquare className="size-4 text-primary" /> : <Square className="size-4" />}
              </button>
            </form>
            <span className={cn("flex-1 text-sm", t.done && "text-muted-foreground line-through")}>{t.title}</span>
            <ConfirmButton
              action={deleteTask}
              fields={{ taskId: t.id }}
              title="Delete task?"
              description={`"${t.title}" will be permanently deleted.`}
              triggerVariant="ghost"
              triggerSize="icon-xs"
              triggerClassName="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              triggerLabel="Delete task"
            >
              <X className="size-3.5" />
            </ConfirmButton>
          </li>
        ))}
      </ul>

      <form
        ref={ref}
        action={async (fd) => { await addTask(fd); ref.current?.reset(); }}
        className="flex items-center gap-1"
      >
        <input type="hidden" name="ticketId" value={ticketId} />
        <Input name="title" placeholder="Add a task…" className="h-8" required />
        <AddButton />
      </form>
    </div>
  );
}
