import { gt, rcompare, valid } from "semver";
import type { AppNotification } from "./notifications";

export const releasesPage =
  "https://github.com/chronoscope-app/chronoscope-public/releases";
export const releasesApi =
  "https://api.github.com/repos/chronoscope-app/chronoscope-public/releases?per_page=20";
const storageKey = "chronoscope-github-releases-v1";
const hour = 60 * 60 * 1000;
const day = 24 * hour;

export interface PublishedRelease {
  version: string;
  tag: string;
  url: string;
  preview: boolean;
}
export interface ReleaseCheck {
  release: PublishedRelease | null;
  checkedAt: number | null;
  cached: boolean;
  error?: string;
}
interface Hooks {
  fetch: typeof fetch;
  storage: Pick<Storage, "getItem" | "setItem">;
  notify(notices: AppNotification[]): void;
  open(url: string): Promise<void> | void;
  now?(): number;
}

function releaseTag(tag: unknown, preview: boolean): PublishedRelease | null {
  if (typeof tag !== "string" || tag.length > 128 || tag.trim() !== tag)
    return null;
  const version = valid(tag);
  return version
    ? {
        version,
        tag,
        preview,
        url: `${releasesPage}/tag/${encodeURIComponent(tag)}`,
      }
    : null;
}

/** GitHub's latest endpoint excludes previews. Our published app previews use
 * normal version tags, so inspect the published list and let semver order it. */
export function newestRelease(payload: unknown): PublishedRelease | null {
  if (!Array.isArray(payload))
    throw Error("GitHub returned an unexpected release response.");
  return (
    payload
      .flatMap((entry) => {
        if (
          !entry ||
          entry.draft !== false ||
          typeof entry.published_at !== "string" ||
          !Number.isFinite(Date.parse(entry.published_at))
        )
          return [];
        const release = releaseTag(entry.tag_name, entry.prerelease === true);
        return release ? [release] : [];
      })
      .sort((a, b) => rcompare(a.version, b.version))[0] || null
  );
}

/** A thin GitHub API client: no update feed, installer or workspace access. */
export class ReleaseUpdates {
  private enabled = true;
  private checkedAt = 0;
  private attemptedAt = 0;
  private latest: PublishedRelease | null = null;
  private pending?: Promise<ReleaseCheck>;
  private timer?: ReturnType<typeof setInterval>;
  private readonly now: () => number;
  constructor(
    readonly currentVersion: string,
    private hooks: Hooks,
  ) {
    if (!valid(currentVersion)) throw Error("Invalid application version");
    this.now = hooks.now || Date.now;
    try {
      const saved = JSON.parse(hooks.storage.getItem(storageKey) || "{}");
      this.enabled = saved.automatic !== false;
      const time = (value: unknown) =>
        typeof value === "number" && value > 0 && value <= this.now()
          ? value
          : 0;
      this.checkedAt = time(saved.checkedAt);
      this.attemptedAt = time(saved.attemptedAt);
      this.latest = releaseTag(saved.tag, saved.preview === true);
    } catch {
      /* A restricted or corrupt local store must not prevent a check. */
    }
  }
  get automatic() {
    return this.enabled;
  }
  isNewer(release: PublishedRelease | null) {
    return !!release && gt(release.version, this.currentVersion);
  }
  setAutomatic(enabled: boolean) {
    this.enabled = enabled;
    this.save();
    if (!enabled) this.hooks.notify([]);
    else if (this.timer) void this.check();
  }
  start() {
    if (this.timer) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), hour);
  }
  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
  async check(manual = false): Promise<ReleaseCheck> {
    if (!manual && !this.enabled) return this.cached();
    let result: ReleaseCheck;
    if (
      !manual &&
      ((this.checkedAt && this.now() - this.checkedAt < day) ||
        (this.attemptedAt && this.now() - this.attemptedAt < hour))
    ) {
      result = this.cached();
    } else {
      if (!this.pending)
        this.pending = this.request().finally(() => {
          this.pending = undefined;
        });
      result = await this.pending;
    }
    if (manual || this.enabled) this.publish(result.release);
    return result;
  }
  private cached(): ReleaseCheck {
    return {
      release: this.latest,
      checkedAt: this.checkedAt || null,
      cached: true,
    };
  }
  private save() {
    try {
      this.hooks.storage.setItem(
        storageKey,
        JSON.stringify({
          automatic: this.enabled,
          checkedAt: this.checkedAt,
          attemptedAt: this.attemptedAt,
          tag: this.latest?.tag || null,
          preview: this.latest?.preview || false,
        }),
      );
    } catch {
      /* Session checks still work if storage is unavailable. */
    }
  }
  private async request(): Promise<ReleaseCheck> {
    this.attemptedAt = this.now();
    this.save();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 8000);
    try {
      const response = await this.hooks.fetch(releasesApi, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        credentials: "omit",
        redirect: "error",
        cache: "no-cache",
        signal: abort.signal,
      });
      if (response.status === 403 || response.status === 429)
        throw Error(
          "GitHub is limiting update checks. Please try again later.",
        );
      if (!response.ok)
        throw Error(
          `GitHub releases are unavailable (HTTP ${response.status}).`,
        );
      this.latest = newestRelease(await response.json());
      this.checkedAt = this.now();
      this.save();
      return { ...this.cached(), cached: false };
    } catch (error) {
      const message = abort.signal.aborted
        ? "GitHub did not respond in time. Please try again."
        : error instanceof Error && /^GitHub /.test(error.message)
          ? error.message
          : "Could not check GitHub releases. Check your connection and try again.";
      return { ...this.cached(), error: message };
    } finally {
      clearTimeout(timer);
    }
  }
  private publish(release: PublishedRelease | null) {
    this.hooks.notify(
      release && this.isNewer(release)
        ? [
            {
              id: `release:${release.version}`,
              source: "updates",
              title: `Chronoscope ${release.version} is available`,
              message: `You’re using ${this.currentVersion}. ${release.preview ? "Experimental preview. " : ""}Open the GitHub release for notes and downloads.`,
              actions: [
                {
                  label: "View release",
                  run: () => this.hooks.open(release.url),
                },
              ],
            },
          ]
        : [],
    );
  }
}
