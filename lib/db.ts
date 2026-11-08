import { PrismaClient } from "@prisma/client";
import { releaseExternalRef, releaseExternalRefMany } from "./ticket-external-ref";

function createClient(): PrismaClient {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  }).$extends({
    name: "ticket-external-ref-release",
    // A ticket gives up its monitoring dedup key (`openExternalRef`) the moment
    // any write moves it into a terminal status — in every code path, including
    // updateMany and interactive transactions (see lib/ticket-external-ref.ts).
    query: {
      ticket: {
        create: ({ args, query }) => query({ ...args, data: releaseExternalRef(args.data) }),
        createMany: ({ args, query }) => query({ ...args, data: releaseExternalRefMany(args.data) }),
        update: ({ args, query }) => query({ ...args, data: releaseExternalRef(args.data) }),
        updateMany: ({ args, query }) => query({ ...args, data: releaseExternalRef(args.data) }),
        updateManyAndReturn: ({ args, query }) => query({ ...args, data: releaseExternalRef(args.data) }),
        upsert: ({ args, query }) =>
          query({ ...args, create: releaseExternalRef(args.create), update: releaseExternalRef(args.update) }),
      },
    },
  });
  // A query-only extension leaves the client's API exactly as it was (same models,
  // methods, arguments and results; only `$on`/`$use` go away, and nothing uses them).
  // Prisma's generated types still differ, though — the extended transaction client
  // isn't assignable to `Prisma.TransactionClient`, which the actions pass around —
  // so the client keeps its plain PrismaClient type.
  return client as unknown as PrismaClient;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
