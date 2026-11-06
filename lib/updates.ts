import { db } from "@/lib/db";
import { notifyAdmins } from "@/lib/audit";
import { APP_VERSION } from "@/lib/constants";
import { getBoolSetting, getSetting, setSetting } from "@/lib/settings";
import { safeFetch } from "@/lib/safe-fetch";
import { isNewerVersion, parseReleases, type AvailableRelease } from "@/lib/update-rules";

/**
 * Update discovery: asks GitHub Releases which versions are newer than the
 * running one and caches the answer in AppSetting. Pure parsing lives in
 * lib/update-rules.ts. Settings: UPDATE_CHECK_ENABLED, UPDATE_REPOSITORY,
 * UPDATE_INCLUDE_PRERELEASES (docs/configuration.md).
 */

export const DEFAULT_UPDATE_REPOSITORY = "jonax1337/Servio-ITSM";

const CACHE_KEY = "UPDATE_CACHE";
const NOTIFIED_VERSION_KEY = "UPDATE_NOTIFIED_VERSION";
const RELEASES_PER_PAGE = 20;
/** Every real version is newer than this, so parsing against it lists all published releases. */
const ZERO_VERSION = "0.0.0";
const REPOSITORY_PATTERN = /^[\w.-]+\/[\w.-]+$/;

type UpdateCache = {
  checkedAt: string;
  repository: string;
  includePrereleases: boolean;
  /** Releases the repository has published at all (newer or not), to tell "up to date" from "nothing published". */
  publishedCount: number;
  releases: AvailableRelease[];
};

export type UpdateCheckResult = { ok: true; checkedAt: string; releases: AvailableRelease[] } | { ok: false; error: string };

export type UpdateState = {
  checkedAt: string | null;
  publishedCount: number;
  /** Releases newer than the running version, newest first. */
  releases: AvailableRelease[];
};

export const updateChecksEnabled = (): Promise<boolean> => getBoolSetting("UPDATE_CHECK_ENABLED", true);

async function updateRepository(): Promise<string> {
  return (await getSetting("UPDATE_REPOSITORY", DEFAULT_UPDATE_REPOSITORY)) ?? DEFAULT_UPDATE_REPOSITORY;
}

function parseCache(raw: string | null): UpdateCache | null {
  if (!raw) return null;
  try {
    const cache = JSON.parse(raw) as Partial<UpdateCache>;
    return typeof cache.checkedAt === "string" && Array.isArray(cache.releases) ? (cache as UpdateCache) : null;
  } catch {
    return null;
  }
}

const includePrereleases = (): Promise<boolean> => getBoolSetting("UPDATE_INCLUDE_PRERELEASES", false);

/**
 * The cached check result, filtered against the version running now (a finished update empties the list).
 * A result fetched with other settings (repository, pre-releases) is ignored until the next check.
 */
export async function readUpdateState(): Promise<UpdateState> {
  const cache = parseCache(await getSetting(CACHE_KEY));
  const current = { repository: await updateRepository(), includePrereleases: await includePrereleases() };
  if (!cache || cache.repository !== current.repository || cache.includePrereleases !== current.includePrereleases) {
    return { checkedAt: null, publishedCount: 0, releases: [] };
  }
  return {
    checkedAt: cache.checkedAt,
    publishedCount: cache.publishedCount ?? 0,
    releases: cache.releases.filter((r) => isNewerVersion(r.version, APP_VERSION)),
  };
}

function httpError(status: number, repository: string): string {
  if (status === 404) return `GitHub repository "${repository}" was not found (or is private).`;
  if (status === 403 || status === 429) return "GitHub rate-limited the update check. Try again later.";
  return `GitHub answered the update check with HTTP ${status}.`;
}

async function fetchReleaseJson(repository: string): Promise<unknown> {
  const response = await safeFetch(`https://api.github.com/repos/${repository}/releases?per_page=${RELEASES_PER_PAGE}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Servio-update-check" },
  });
  if (!response.ok) throw new Error(httpError(response.status, repository));
  return JSON.parse(response.text);
}

/**
 * Claim `version` as announced: true only for the caller that records it first.
 * The marker is written before notifying so overlapping checks never announce twice.
 */
async function claimAnnouncement(version: string): Promise<boolean> {
  const marker = await db.appSetting.findUnique({ where: { key: NOTIFIED_VERSION_KEY } });
  if (marker?.value === version) return false;
  if (!marker) {
    try {
      await db.appSetting.create({ data: { key: NOTIFIED_VERSION_KEY, value: version } });
      return true;
    } catch (e) {
      if ((e as { code?: string })?.code === "P2002") return false;
      throw e;
    }
  }
  const claimed = await db.appSetting.updateMany({
    where: { key: NOTIFIED_VERSION_KEY, value: marker.value },
    data: { value: version },
  });
  return claimed.count > 0;
}

async function announceLatest(latest: AvailableRelease | undefined): Promise<void> {
  if (!latest || !(await claimAnnouncement(latest.version))) return;
  await notifyAdmins({
    type: "UPDATE_AVAILABLE",
    title: `Servio ${latest.version} is available`,
    body: `You are running ${APP_VERSION}. Schedule the update under Settings > Updates.`,
  });
}

/** Ask GitHub for newer releases, cache the answer and tell the admins about a new latest version. Never throws. */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const repository = await updateRepository();
  if (!REPOSITORY_PATTERN.test(repository)) return { ok: false, error: `"${repository}" is not a GitHub repository (owner/name).` };
  try {
    const json = await fetchReleaseJson(repository);
    const prereleases = await includePrereleases();
    const releases = parseReleases(json, APP_VERSION, { includePrereleases: prereleases });
    const publishedCount = parseReleases(json, ZERO_VERSION, { includePrereleases: prereleases }).length;
    const checkedAt = new Date().toISOString();
    const cache: UpdateCache = { checkedAt, repository, includePrereleases: prereleases, publishedCount, releases };
    await setSetting(CACHE_KEY, JSON.stringify(cache));
    await announceLatest(releases[0]);
    return { ok: true, checkedAt, releases };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The update check failed." };
  }
}
