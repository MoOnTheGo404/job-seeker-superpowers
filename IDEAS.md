# Ideas

## Shipping next

<!-- Committed work with a clear shape — the things actually queued up to build. -->

## Someday

<!-- Worth doing eventually, but not scoped or scheduled yet. -->

## Rejected and why

<!-- Ideas deliberately turned down, each with the reasoning, so they don't get re-litigated later. -->

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
