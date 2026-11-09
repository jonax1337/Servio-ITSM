"use client";

import { createContext, useContext } from "react";
import { UPLOAD_ACCEPT, uploadAccept } from "@/lib/attachments-ui";

const UploadAcceptContext = createContext(UPLOAD_ACCEPT);

/**
 * Carries the file-picker `accept` list (built-in types plus the admin-added
 * extensions from Settings › Uploads) to every upload control below it. Set once
 * per surface in the console and portal layouts.
 */
export function UploadAcceptProvider({ extraExtensions, children }: { extraExtensions: string[]; children: React.ReactNode }) {
  return <UploadAcceptContext.Provider value={uploadAccept(extraExtensions)}>{children}</UploadAcceptContext.Provider>;
}

export function useUploadAccept(): string {
  return useContext(UploadAcceptContext);
}
