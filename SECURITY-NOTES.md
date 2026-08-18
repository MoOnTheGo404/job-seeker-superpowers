# Prompt injection: what the attack is and what was done about it

ReachPoint reads job postings written by strangers and feeds them to a language
model. This is a note on the resulting attack surface, written to be
understandable without reading the code.

## 1. The gate accepted evidence from the document it was defending against

The check was: before trusting the company domain the model returns, confirm
something else points at it. One of the accepted signals was "the domain appears
in the fetched page."

That signal is worthless, and it took a real test to see why. **The attacker
wrote the page.** A hostile posting saying _"our company website is
attacker-controlled.com"_ corroborates itself. Run against the real function:

```
attacker domain corroborated by its own posting: true
```

Worse, the unit test covering this had been hiding it — it passed empty page
text, so the case never ran. The test looked like proof the gate worked. It was
proof the gate worked when the attacker did not try.

The same flaw appeared a second time, one step removed. When a user pastes a
description with no link, the company name and the domain are both read out of
that same pasted text. A name match there proves only that the text agrees with
itself. That path also accepted:

```
{"ok":true,"domain":"acmecorp-careers.net"}
```

The generalisable lesson: **corroboration is only worth something if it comes
from outside the thing being checked.** Two signals drawn from one
attacker-controlled document are one signal.

## 2. The real attack is the model choosing the site, not inventing an address

The intuitive worry is a posting that makes the model return
`contact@attacker.com` as the recruiter. That cannot happen. The model is never
asked for an email address and has no field to put one in; addresses are found
by regex over fetched pages.

The actual path is quieter. The model does choose `company_domain`, and the
crawler then visits that domain and harvests whatever addresses it finds there.
A posting that redirects the domain therefore yields attacker addresses that
**genuinely appear in the fetched text** and **genuinely carry a source URL**.

So the obvious defense — _"the email must appear in the page we fetched"_ —
**passes the attack cleanly.** It verifies that the address was really found,
when the problem is that the crawler was pointed at the wrong page. The app then
labels the result _"Published on the company's own website."_

The defense has to sit on the domain, not on the email.

## 3. What is closed, and what an attacker can still do

**Closed**

- Domains the model invented outright, with nothing independent pointing at them
- Both self-corroboration paths above
- IP literals in all four spellings — dotted quad, IPv6, decimal, hex
- Private, loopback, link-local and CGNAT ranges
- Non-public suffixes: `.internal`, `.local`, `.test`, `.invalid`, bare hostnames
- Wildcard-DNS hosts carrying an embedded private address, e.g.
  `169.254.169.254.nip.io`, which has a real public TLD
- Homoglyph lookalikes in both Unicode (`аpple.com` with a Cyrillic а) and
  punycode (`xn--pple-43d.com`)

Blocking the address ranges closes a **server-side fetch primitive** — an
attacker could aim the Worker's outbound requests. Cloudflare Workers has no
EC2-style instance-metadata endpoint, so this was never a credential-theft hole
and is not described as one.

**Still possible**

- **A lookalike carrying the company name.** Registering `acmecorp-jobs.net`
  still clears the name-agreement check. Closing it needs an allowlist or
  domain-age signals. Recorded as a passing test so the limit stays visible.
- **Controlling a posting entirely.** The attacker then controls the company
  name too — but exercising that control defeats the deception, because the user
  sees they are contacting "Attacker Corp" rather than the company they expected.
- **Shaping a drafted message.** Third-party text is fenced and capped, but a
  prompt instruction is a request, not a boundary. A human reads every message
  before sending it.

**The tradeoff taken.** The paste path now yields no company domain at all,
because nothing independent is available to corroborate one. That is the
Handshake workflow: those postings cannot be read from a link, so users must
paste, and they now get LinkedIn profiles and the people-search shortcut but no
company email crawling. Every rejection is logged with domain, reason and source
URL so the real-world cost is measured rather than guessed at.

**Layer ordering.** Prompt fencing is the weakest layer and is present because
it is nearly free. The domain validator does the work, because it does not care
what the model was persuaded to say.

## 4. Why CI runs four gates rather than two

While wiring this up, an import was left out. **`npm run build` passed clean.**
Vite strips types and bundles; it does not type-check. `tsc --noEmit` caught it:

```
error TS2304: Cannot find name 'fenceUntrusted'.
```

A green build would have shipped a runtime `ReferenceError` on **every
`analyzeJob` call** — the application's primary action, broken every time, with
the build reporting success.

That is the concrete argument for typecheck, lint, test and build as four
separate gates. A passing build is not evidence that the code runs.
