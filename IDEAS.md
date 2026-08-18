# Ideas

## Shipping next

<!-- Committed work with a clear shape — the things actually queued up to build. -->

## Someday

<!-- Worth doing eventually, but not scoped or scheduled yet. -->

## Rejected and why

### Eval fixture gaps

Two candidates failed verification while assembling the discovery eval set, and
both are gaps to fill rather than blockers. Recorded so the next fixture pass
starts from what is already known.

- **interface.ai** — the Greenhouse posting found by search
  (`job-boards.greenhouse.io/interfaceai/jobs/4684101006`) returned
  `unavailable`: filled or closed between being indexed and being fetched. A
  live replacement is needed to cover this company, which is in the real
  pipeline and therefore has ground truth attached.
- **Encore Global** — their board exposes only location and category listing
  pages (`/en/employment/...-audio-visual-jobs/...`), never an individual
  requisition URL, at least not through search. Getting one probably means
  browsing the board directly rather than searching for it.

Also still missing from the set: a non-US posting, an explicitly multi-location
posting, and wider industry spread beyond tech, EPC, medtech and consulting.
Deferred deliberately — manual labelling is the bottleneck, and nine fixtures is
what can be labelled properly in one sitting.

<!-- Ideas deliberately turned down, each with the reasoning, so they don't get re-litigated later. -->

### Recruiter emails from LinkedIn post bodies

Recruiters commonly publish their own address in the body of a LinkedIn job
post, inviting resumes directly — a genuinely public, genuinely high-value
pattern that `crawlCompanyEmails` cannot reach, because it walks six paths on
the company domain and surfaces team inboxes rather than named people.

Measured before building, across 76 unique results from 8 real discovery
queries including three specific to the company in question:

|                                      | Count | Share  |
| ------------------------------------ | ----- | ------ |
| Profile URLs (`/in/`)                | 40    | 53%    |
| **Post URLs** (`/posts/`, `/pulse/`) | **4** | **5%** |
| Other LinkedIn (jobs, company pages) | 18    | 24%    |
| **Snippets containing any email**    | **2** | **3%** |

Post URLs are returned — the `/in/` filter currently discards them — so the
plumbing is not the obstacle. The content is. None of the four posts was a
recruiter publishing an address:

- a company-page post, a CEO post, a hashtag marketing post, and an article

And both emails that appeared were team inboxes of exactly the kind
`crawlCompanyEmails` already returns: a disability-accommodations address from
a `/jobs/view/` page, and a company switchboard from a non-LinkedIn site.

The specific address that prompted this — a named recruiter's, known to be
published in his own post bodies — **appeared zero times across three
company-specific queries.**

The structural reason: a snippet is a ~160-character truncation the search
engine picks around the query terms. An address buried in a post body only
surfaces if it happens to fall inside that window. Reaching it reliably means
fetching the post, which is a new fetch path.

**What would justify revisiting:** a source that returns post bodies rather
than snippets. Gated on re-running the measurement above; if recruiter-authored
addresses do not appear at a usable rate, the answer is still no.

### Alumni-based referral discovery (as a discovery mode)

A second mode on `discoverReferrers` that requires a shared school between the
applicant and the candidate, ranking department matches higher within that set.

The premise is sound — a shared school is the strongest predictor of a referral
reply, stronger than seniority or department, and it is what the standard
referral playbook is built on. **The data to act on it is not in what this app
fetches.**

Measured before building, across 45 unique LinkedIn profiles from 10 realistic
referral queries (Stripe, Dexcom, Figma, Databricks, Snowflake, Notion,
Cloudflare, Airbnb, Palantir, Rippling), through the live Serper path:

|                                              | Count | Share   |
| -------------------------------------------- | ----- | ------- |
| Structured `Education:` field in the snippet | 7     | **16%** |
| Loose prose mention only                     | 1     | 2%      |
| No education data at all                     | 37    | **82%** |

Why 16% is worse than it reads:

- **One entry, not a history.** LinkedIn's meta description emits a single
  `Education:` value. A candidate with degrees from two institutions shows one.
  Match on the other and the user gets nothing, silently.
- **Not always a university.** One of the seven was `Ramapo High School`.
- **Positionally truncated.** Education sits after Experience in the template,
  so it is first to be cut. Five of seven sat in snippets ending in an ellipsis;
  one was visibly severed mid-name.
- **The 82% is unknown, not negative.** Those candidates may well be alumni. A
  mode that filters on school would report "no alumni found" when the truth is
  "cannot see." That is the confidently-wrong failure this codebase spends most
  of its effort eliminating.

In practice: discovery returns up to 8 candidates, so roughly one would carry
any school string at all, which then has to match the user's specific school.
Most searches would return empty and fall through to the LinkedIn shortcut —
making the feature a link to LinkedIn's own alumni search wearing several
hundred lines of costume.

**Shipped instead:** school-filtered LinkedIn people-search links, one per
school, next to the existing people-search shortcut. Same play, no data
dependency, no false negatives.

**What would justify revisiting:** a source that carries education as a real
field rather than a truncated string — LinkedIn's official API, a paid people-
data provider, or users importing their own graduating-class list. Re-running
the measurement above is the gate; if structured coverage is not comfortably
past 50%, the answer is still no.
