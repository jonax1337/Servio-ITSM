import { useTransition, type FormEvent } from "react";

/**
 * Submit handler that dispatches a `useActionState` action without React 19's
 * automatic form reset. A `<form action>` is reset after every submission,
 * including ones the server rejected, which wipes what the user typed.
 * Use as `<form onSubmit={useFormSubmit(action)}>`; keep `pending` from useActionState.
 */
export function useFormSubmit(action: (formData: FormData) => void) {
  const [, startTransition] = useTransition();
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => action(formData));
  };
}
