/**
 * Discovery eval harness. Local only — never in CI, never in `npm test`.
 *
 *   npm run eval            replay from cassettes, zero API calls
 *   npm run eval -- --record   hit the network and record
 *
 * See evals/PLAN.md for cost, metrics, and the predictions recorded before the
 * first run.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { analyzeJobCore, type AnalyzedJob } from "../src/lib/recruiters.functions";
import {
  crawlCompanyEmails,
  findLinkedInProfiles,
  findReferralProfiles,
  searchPersonEmail,
  verifyDomain,
} from "../src/lib/discovery.server";
import { confirmedOnly, isRecruiterTitle, type FoundProfile } from "../src/lib/discovery.parse";

const CASSETTES = "evals/cassettes";
const FIXTURES = "evals/fixtures";
const REPORTS = "evals/reports";
const RECORD = process.argv.includes("--record");

/** Statuses that mean "try later", not "this is the answer". */
const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);

interface Fixture {
  id: string;
  company: string;
  sizeBand: string;
  industry: string;
  jobUrl: string | null;
  jobText: string | null;
  mustPaste: boolean;
  note: string;
  labels: { relevantReferrerTitles: string[]; irrelevantReferrerTitles: string[] };
}

/* ---------------------------------------------------------------- cassettes */

/**
 * Record and replay at the fetch boundary.
 *
 * One caching layer, not two: every Serper query, every page crawl and the
 * model calls all travel by fetch, so intercepting here freezes the entire run.
 * Replay is what makes a scorer change measurable without spending credits.
 */
let live = 0;
let replayed = 0;
/*
 * Misses are counted, not merely thrown.
 *
 * fetchPublicPage and fetchText both wrap their fetch in try/catch, so a thrown
 * cassette miss is swallowed and reported as "unavailable" — the run would then
 * continue on empty page text and compute aggregates over nothing. Counting
 * survives the catch; the run fails at the end if any miss happened.
 */
let misses = 0;
const missedUrls = new Set<string>();

function cassettePath(method: string, url: string, body: string): string {
  const key = createHash("sha256").update(`${method} ${url} ${body}`).digest("hex").slice(0, 32);
  return join(CASSETTES, `${key}.json`);
}

function installFetchCassette(): void {
  const real = globalThis.fetch;
  mkdirSync(CASSETTES, { recursive: true });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : "";
    const path = cassettePath(method, url, body);

    if (existsSync(path)) {
      replayed++;
      const tape = JSON.parse(readFileSync(path, "utf8")) as {
        status: number;
        headers: Record<string, string>;
        body: string;
        url: string;
      };
      return new Response(tape.body, { status: tape.status, headers: tape.headers });
    }

    if (!RECORD) {
      misses++;
      missedUrls.add(`${method} ${url.slice(0, 100)}`);
      throw new Error(`cassette miss (replay mode): ${method} ${url.slice(0, 120)}`);
    }

    live++;
    const res = await real(input as RequestInfo, init);
    const text = await res.clone().text();

    /*
     * Do not tape a transient failure. A 503 from the model got recorded on the
     * first pass and then replayed forever, turning a momentary blip into a
     * permanently broken fixture. Leaving these untaped costs one live call on
     * the next run and keeps the set re-runnable.
     */
    if (TRANSIENT.has(res.status)) return res;

    writeFileSync(
      path,
      JSON.stringify({
        method,
        url,
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body: text,
      }),
    );
    return res;
  }) as typeof globalThis.fetch;
}

/* ------------------------------------------------------------------ capture */

interface Captured {
  domainRejected: { domain: string; reason: string; company: string | null }[];
  countryHint: {
    fn: string;
    jobCountry: string | null;
    same: number;
    different: number;
    unknown: number;
  }[];
}

function captureLogs(): { logs: Captured; restore: () => void } {
  const logs: Captured = { domainRejected: [], countryHint: [] };
  const warn = console.warn;
  const info = console.info;

  console.warn = (...args: unknown[]) => {
    if (args[0] === "[domain-rejected]") {
      try {
        logs.domainRejected.push(JSON.parse(String(args[1])));
      } catch {
        /* keep going; a malformed log line should not sink the run */
      }
      return;
    }
    warn(...args);
  };
  console.info = (...args: unknown[]) => {
    if (args[0] === "[country-hint]") {
      try {
        logs.countryHint.push(JSON.parse(String(args[1])));
      } catch {
        /* as above */
      }
      return;
    }
    info(...args);
  };

  return {
    logs,
    restore: () => {
      console.warn = warn;
      console.info = info;
    },
  };
}

/* --------------------------------------------------------------------- run */

interface Result {
  fixture: Fixture;
  analyzed: AnalyzedJob | null;
  error: string | null;
  recruiters: FoundProfile[];
  referrers: FoundProfile[];
  emails: { email: string; sourceUrl: string }[];
  personEmails: { email: string; sourceUrl: string }[];
  resolvedDomain: string | null;
  logs: Captured;
}

async function runFixture(f: Fixture): Promise<Result> {
  const { logs, restore } = captureLogs();
  const out: Result = {
    fixture: f,
    analyzed: null,
    error: null,
    recruiters: [],
    referrers: [],
    emails: [],
    personEmails: [],
    resolvedDomain: null,
    logs,
  };

  try {
    out.analyzed = await analyzeJobCore(f.jobUrl ?? undefined, f.jobText ?? undefined);
    const a = out.analyzed;

    // Mirrors discoverContacts, minus auth, rate limiting and persistence.
    const domain = a.company_domain ? await verifyDomain(a.company_domain) : null;
    out.resolvedDomain = domain;

    const [recruiters, inboxes] = await Promise.all([
      findLinkedInProfiles(a.company, a.role_title, a.location),
      domain ? crawlCompanyEmails(domain) : Promise.resolve([]),
    ]);
    out.recruiters = recruiters;

    /*
     * discoverContacts looks for a personal address for each of the top four
     * profiles before falling back to team inboxes. Omitting this measured only
     * half the email pipeline and would have reported "no emails anywhere" on
     * evidence that never tested the main path.
     */
    const top = recruiters.slice(0, 4);
    const personEmails = await Promise.all(
      top.map((p) => searchPersonEmail(p.name, a.company, domain).catch(() => null)),
    );
    out.personEmails = personEmails
      .filter((e): e is NonNullable<typeof e> => Boolean(e))
      .map((e) => ({ email: e.email, sourceUrl: e.sourceUrl }));

    out.emails = inboxes
      .filter((e) => e.recruitingRelevant)
      .slice(0, 4)
      .map((e) => ({ email: e.email, sourceUrl: e.sourceUrl }));

    out.referrers = await findReferralProfiles(a.company, a.department, a.role_title, a.location);
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  } finally {
    restore();
  }
  return out;
}

/* ------------------------------------------------------------------ report */

function pct(n: number, d: number): string {
  return d === 0 ? "—" : `${Math.round((n / d) * 100)}%`;
}

function buildReport(results: Result[]): string {
  const L: string[] = [];
  const ok = results.filter((r) => !r.error);

  L.push(`# Discovery eval — ${new Date().toISOString()}`);
  L.push("");
  L.push(`Mode: **${RECORD ? "record" : "replay"}** · live fetches ${live} · replayed ${replayed}`);
  L.push("");

  L.push("## Per fixture");
  L.push("");
  L.push(
    "| id | band | company seen | role seen | dept | location | domain | recr | w/ email | refs |",
  );
  L.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of results) {
    const a = r.analyzed;
    L.push(
      `| \`${r.fixture.id}\` | ${r.fixture.sizeBand} | ${a?.company ?? "—"} | ${
        a?.department ?? "—"
      } | ${a?.location ?? "—"} | ${r.resolvedDomain ?? "**null**"} | ${
        r.recruiters.length
      } | ${confirmedOnly(r.recruiters).length} | ${r.personEmails.length} | ${
        r.emails.length
      } | ${r.referrers.length} | ${confirmedOnly(r.referrers).length} |`,
    );
  }
  L.push("");
  const failed = results.filter((r) => r.error);
  if (failed.length) {
    L.push("### Errors");
    L.push("");
    for (const r of failed) L.push(`- \`${r.fixture.id}\` — ${r.error}`);
    L.push("");
  }

  L.push("## Email yield by company size");
  L.push("");
  L.push("| band | fixtures | any email | share |");
  L.push("| --- | --- | --- | --- |");
  const bands = [...new Set(results.map((r) => r.fixture.sizeBand))];
  for (const b of bands) {
    const inBand = results.filter((r) => r.fixture.sizeBand === b);
    const withEmail = inBand.filter((r) => r.emails.length + r.personEmails.length > 0);
    L.push(
      `| ${b} | ${inBand.length} | ${withEmail.length} | ${pct(withEmail.length, inBand.length)} |`,
    );
  }
  L.push("");

  L.push("## Domain gate");
  L.push("");
  const rejects = results.flatMap((r) => r.logs.domainRejected);
  const byReason = new Map<string, number>();
  for (const d of rejects) byReason.set(d.reason, (byReason.get(d.reason) ?? 0) + 1);
  L.push(`Resolved a domain: **${ok.filter((r) => r.resolvedDomain).length}/${ok.length}**`);
  L.push("");
  if (byReason.size) {
    L.push("| reason | count | domains |");
    L.push("| --- | --- | --- |");
    for (const [reason, n] of byReason) {
      const ex = rejects
        .filter((d) => d.reason === reason)
        .map((d) => `\`${d.domain}\``)
        .join(", ");
      L.push(`| ${reason} | ${n} | ${ex} |`);
    }
  } else {
    L.push("No domain was rejected by the gate.");
  }
  L.push("");

  L.push("## Recruiter precision");
  L.push("");
  L.push("Share of returned 'recruiters' whose titles are recruiting titles.");
  L.push("Non-circular: findLinkedInProfiles never filters on isRecruiterTitle.");
  L.push("");
  L.push("| id | returned | recruiting titles | share |");
  L.push("| --- | --- | --- | --- |");
  let totR = 0;
  let totHit = 0;
  for (const r of results) {
    const hit = r.recruiters.filter((p) => isRecruiterTitle(p.title)).length;
    totR += r.recruiters.length;
    totHit += hit;
    L.push(
      `| \`${r.fixture.id}\` | ${r.recruiters.length} | ${hit} | ${pct(hit, r.recruiters.length)} |`,
    );
  }
  L.push(`| **all** | **${totR}** | **${totHit}** | **${pct(totHit, totR)}** |`);
  L.push("");

  L.push("## Employer confirmation");
  L.push("");
  L.push("Results are only shown when the source places the person at the company.");
  L.push("These are the counts that survive that rule.");
  L.push("");
  L.push("| id | recruiters kept | referrers kept | shown at all? |");
  L.push("| --- | --- | --- | --- |");
  for (const r of results) {
    const cr = confirmedOnly(r.recruiters).length;
    const cf = confirmedOnly(r.referrers).length;
    L.push(
      `| \`${r.fixture.id}\` | ${cr}/${r.recruiters.length} | ${cf}/${r.referrers.length} | ${
        cr + cf === 0 ? "**no — fallback only**" : "yes"
      } |`,
    );
  }
  L.push("");

  L.push("## Country hints");
  L.push("");
  const hints = results.flatMap((r) => r.logs.countryHint);
  const same = hints.reduce((n, h) => n + h.same, 0);
  const diff = hints.reduce((n, h) => n + h.different, 0);
  const unk = hints.reduce((n, h) => n + h.unknown, 0);
  const all = same + diff + unk;
  L.push("| bucket | count | share |");
  L.push("| --- | --- | --- |");
  L.push(`| same | ${same} | ${pct(same, all)} |`);
  L.push(`| different | ${diff} | ${pct(diff, all)} |`);
  L.push(`| unknown | ${unk} | ${pct(unk, all)} |`);
  L.push("");

  L.push("## Referrer titles — for manual labelling");
  L.push("");
  L.push("`departmentFit` cannot grade itself. Label these by hand into each");
  L.push("fixture's `labels`, and later runs will grade against them.");
  L.push("");
  for (const r of results) {
    if (!r.referrers.length) continue;
    L.push(
      `**\`${r.fixture.id}\`** — ${r.analyzed?.role_title ?? "?"} (${r.analyzed?.department ?? "?"})`,
    );
    L.push("");
    for (const p of r.referrers.slice(0, 8)) {
      L.push(
        `- ${p.title || "(no title)"}${p.employerConfirmed ? "" : "  _[employer unconfirmed]_"}`,
      );
    }
    L.push("");
  }

  return L.join("\n");
}

/* -------------------------------------------------------------------- main */

async function main(): Promise<void> {
  installFetchCassette();
  mkdirSync(REPORTS, { recursive: true });

  const fixtures = readdirSync(FIXTURES)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(FIXTURES, f), "utf8")) as Fixture)
    .sort((a, b) => a.id.localeCompare(b.id));

  process.stdout.write(`${fixtures.length} fixtures · ${RECORD ? "RECORDING" : "replay"}\n`);

  const results: Result[] = [];
  for (const f of fixtures) {
    process.stdout.write(`  ${f.id} … `);
    // Sequential on purpose: Serper allows 5 req/s and discoverContacts
    // already fans out four concurrent lookups of its own.
    const before = live;
    const r = await runFixture(f);
    /*
     * Pace only when the fixture actually went to the network. Gemini's free
     * tier caps requests per minute, and nine analyses back to back tripped it
     * three times; a replay run does no I/O and should stay instant.
     */
    if (live > before) await new Promise((res) => setTimeout(res, 20_000));
    process.stdout.write(
      r.error
        ? `ERROR ${r.error.slice(0, 60)}\n`
        : `${r.recruiters.length}r ${r.emails.length}e ${r.referrers.length}f\n`,
    );
    results.push(r);
  }

  if (!RECORD && misses > 0) {
    process.stdout.write(
      `\nFAILED: ${misses} cassette miss(es) across ${missedUrls.size} URLs.\n` +
        "Aggregates would be computed over incomplete data, so no report was written.\n" +
        "Run `npm run eval -- --record` to fill the gaps.\n",
    );
    for (const u of [...missedUrls].slice(0, 10)) process.stdout.write(`  ${u}\n`);
    process.exitCode = 1;
    return;
  }

  const report = buildReport(results);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(join(REPORTS, `${stamp}.md`), report);
  writeFileSync(join(REPORTS, "latest.md"), report);
  process.stdout.write(`\nlive ${live} · replayed ${replayed}\nreport: ${REPORTS}/latest.md\n`);
}

await main();
