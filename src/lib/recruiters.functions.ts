import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface AnalyzedJob {
  company: string;
  role_title: string;
  location: string | null;
  company_domain: string | null;
  summary: string | null;
  /** Broad function the role sits in, used to aim referral search at the right team. */
  department: string | null;
  seniority: string | null;
}

export const analyzeJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { jobUrl?: string; jobText?: string }) => {
    if (!input.jobUrl && !input.jobText)
      throw new Error("Paste a job link or the job description.");
    return input;
  })
  .handler(async ({ data, context }): Promise<AnalyzedJob> => {
    const { enforceRateLimit } = await import("./ratelimit.server");
    await enforceRateLimit(context.supabase, "analyze_job");

    const { askAI, parseJsonBlock } = await import("./ai.server");
    const { hostFromUrl, isJobBoard } = await import("./discovery.server");

    let pageText = data.jobText ?? "";
    if (data.jobUrl) {
      const { fetchPublicPage } = await import("./fetchPage.server");
      const fetched = await fetchPublicPage(data.jobUrl);
      if (fetched) pageText = `${pageText}\n\n${fetched}`.trim();
    }

    const raw = await askAI(
      [
        {
          role: "system",
          content:
            "You extract structured facts from job postings. Reply with JSON only: " +
            '{"company":string,"role_title":string,"location":string|null,"company_domain":string|null,"summary":string,"department":string|null,"seniority":string|null}. ' +
            "company_domain must be the company's real primary website domain (no www, no protocol) only if you are confident; otherwise null. " +
            "Never use a job board domain as company_domain. summary is 1-2 sentences about the role. " +
            "department is the broad function the role sits in — one of Engineering, Data, Product, Design, " +
            "Marketing, Sales, Finance, Operations, Legal, Support — or null if genuinely unclear. " +
            "seniority is the level as written in the posting (e.g. Junior, Mid, Senior, Staff, Lead, Director) or null.",
        },
        {
          role: "user",
          content: `Job URL: ${data.jobUrl ?? "n/a"}\n\nJob content:\n${pageText.slice(0, 12000) || "(none provided)"}`,
        },
      ],
      // Pure field extraction — no reasoning to do, and skipping thinking cuts
      // this call from ~8s to under a second.
      { json: true, thinking: false },
    );

    const parsed = parseJsonBlock<AnalyzedJob>(raw, {
      company: "",
      role_title: "",
      location: null,
      company_domain: null,
      summary: null,
      department: null,
      seniority: null,
    });

    if (!parsed.company_domain && data.jobUrl) {
      const host = hostFromUrl(data.jobUrl);
      if (host && !isJobBoard(host)) parsed.company_domain = host;
    }
    if (!parsed.company)
      throw new Error("Couldn't identify the company. Try pasting the full job description.");
    return parsed;
  });

export interface DiscoveredContact {
  name: string | null;
  title: string | null;
  linkedin_url: string | null;
  linkedin_search_url: string;
  email: string | null;
  email_source_url: string | null;
  email_status: "verified_public" | "team_inbox" | "not_found";
  notes: string | null;
}

export const discoverContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { targetId: string }) => {
    if (!input.targetId) throw new Error("Missing job target.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { enforceRateLimit } = await import("./ratelimit.server");
    await enforceRateLimit(supabase, "discover_contacts");

    const { data: target, error } = await supabase
      .from("job_targets")
      .select("*")
      .eq("id", data.targetId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!target) throw new Error("Job target not found.");

    const { createSearchCache } = await import("./cache.server");
    const cache = createSearchCache(supabase);

    const {
      crawlCompanyEmails,
      findLinkedInProfiles,
      linkedInPeopleSearchUrl,
      searchPersonEmail,
      verifyDomain,
    } = await import("./discovery.server");

    const domain = target.company_domain ? await verifyDomain(target.company_domain) : null;

    const [profiles, inboxEmails] = await Promise.all([
      findLinkedInProfiles(target.company, target.role_title, cache),
      domain ? crawlCompanyEmails(domain) : Promise.resolve([]),
    ]);

    const contacts: DiscoveredContact[] = [];

    // Look these up concurrently. Serially, six profiles meant six search calls
    // plus up to 24 page fetches back to back, which blew the request timeout
    // long before the handler could return.
    // Four, not six: each profile costs a search plus page fetches, and the
    // per-invocation request budget on serverless hosts is finite.
    const topProfiles = profiles.slice(0, 4);
    const personEmails = await Promise.all(
      topProfiles.map((profile) =>
        // One profile failing to resolve shouldn't sink the whole discovery run.
        searchPersonEmail(profile.name, target.company, domain, cache).catch(() => null),
      ),
    );

    topProfiles.forEach((profile, index) => {
      const personEmail = personEmails[index] ?? null;
      contacts.push({
        name: profile.name,
        title: profile.title || null,
        linkedin_url: profile.linkedinUrl,
        linkedin_search_url: linkedInPeopleSearchUrl(target.company, profile.name),
        email: personEmail?.email ?? null,
        email_source_url: personEmail?.sourceUrl ?? null,
        email_status: personEmail ? "verified_public" : "not_found",
        notes: personEmail
          ? "Email found published on a public web page (link included)."
          : "No publicly published email found — reach out on LinkedIn instead.",
      });
    });

    for (const inbox of inboxEmails.filter((e) => e.recruitingRelevant).slice(0, 4)) {
      contacts.push({
        name: null,
        title: "Company recruiting inbox",
        linkedin_url: null,
        linkedin_search_url: linkedInPeopleSearchUrl(
          target.company,
          "recruiter talent acquisition",
        ),
        email: inbox.email,
        email_source_url: inbox.sourceUrl,
        email_status: "team_inbox",
        notes: "Published on the company's own website.",
      });
    }

    if (!contacts.length) {
      contacts.push({
        name: null,
        title: "Recruiting team",
        linkedin_url: null,
        linkedin_search_url: linkedInPeopleSearchUrl(
          target.company,
          "recruiter OR talent acquisition OR hiring manager",
        ),
        email: null,
        email_source_url: null,
        email_status: "not_found",
        notes:
          "No verifiable public contact found. Use the LinkedIn people search below to reach the team directly.",
      });
    }

    // Scoped to this contact_type: referrers live in the same table, and an
    // unscoped delete here would silently wipe them on every recruiter re-run.
    await supabase
      .from("contacts")
      .delete()
      .eq("target_id", target.id)
      .eq("contact_type", "recruiter");
    const { data: inserted, error: insertError } = await supabase
      .from("contacts")
      .insert(
        contacts.map((c) => ({
          ...c,
          target_id: target.id,
          user_id: userId,
          contact_type: "recruiter",
        })),
      )
      .select();
    if (insertError) throw new Error(insertError.message);

    if (domain && domain !== target.company_domain) {
      await supabase.from("job_targets").update({ company_domain: domain }).eq("id", target.id);
    }

    return { contacts: inserted ?? [] };
  });

/**
 * Find senior people on the hiring team who could refer the applicant.
 *
 * Separate from discoverContacts because it wants the opposite kind of person:
 * not someone whose job is to receive applications, but someone on the team who
 * could vouch for one. Stored in the same table under contact_type 'referrer'.
 *
 * No email lookup here, deliberately — see the notes field. A referral ask
 * belongs on LinkedIn, where the recipient chose to be contactable.
 */
export const discoverReferrers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { targetId: string }) => {
    if (!input.targetId) throw new Error("Missing job target.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { enforceRateLimit } = await import("./ratelimit.server");
    await enforceRateLimit(supabase, "discover_referrers");

    const { data: target, error } = await supabase
      .from("job_targets")
      .select("*")
      .eq("id", data.targetId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!target) throw new Error("Job target not found.");

    const { createSearchCache } = await import("./cache.server");
    const { findReferralProfiles, linkedInPeopleSearchUrl } = await import("./discovery.server");

    const profiles = await findReferralProfiles(
      target.company,
      target.department,
      target.role_title,
      createSearchCache(supabase),
    );

    const contacts: DiscoveredContact[] = profiles.map((profile) => ({
      name: profile.name,
      title: profile.title || null,
      linkedin_url: profile.linkedinUrl,
      linkedin_search_url: linkedInPeopleSearchUrl(target.company, profile.name),
      email: null,
      email_source_url: null,
      email_status: "not_found",
      notes:
        "Potential referrer — senior in this team. Ask on LinkedIn: a referral request is a favour, and cold-emailing someone's work address for one tends to land badly.",
    }));

    if (!contacts.length) {
      contacts.push({
        name: null,
        title: "No referrers found",
        linkedin_url: null,
        linkedin_search_url: linkedInPeopleSearchUrl(
          target.company,
          target.department ?? target.role_title,
        ),
        email: null,
        email_source_url: null,
        email_status: "not_found",
        notes:
          "Nobody senior enough surfaced for this team. Use the LinkedIn people search below and look for someone you share a school, employer or community with.",
      });
    }

    await supabase
      .from("contacts")
      .delete()
      .eq("target_id", target.id)
      .eq("contact_type", "referrer");
    const { data: inserted, error: insertError } = await supabase
      .from("contacts")
      .insert(
        contacts.map((c) => ({
          ...c,
          target_id: target.id,
          user_id: userId,
          contact_type: "referrer",
        })),
      )
      .select();
    if (insertError) throw new Error(insertError.message);

    return { contacts: inserted ?? [] };
  });

export const draftOutreach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      contactId: string;
      channel: "email" | "linkedin";
      extra?: string;
      purpose?: "application" | "referral";
    }) => {
      if (!input.contactId) throw new Error("Missing contact.");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { enforceRateLimit } = await import("./ratelimit.server");
    await enforceRateLimit(supabase, "draft_outreach");

    const { askAI } = await import("./ai.server");

    const { data: contact } = await supabase
      .from("contacts")
      .select("*, job_targets(*)")
      .eq("id", data.contactId)
      .maybeSingle();
    if (!contact) throw new Error("Contact not found.");

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();
    const target = (
      contact as unknown as {
        job_targets: { company: string; role_title: string; job_description: string | null };
      }
    ).job_targets;

    const limit = data.channel === "linkedin" ? "under 280 characters" : "under 160 words";
    const purpose = data.purpose ?? "application";

    /*
     * A referral ask is not a shorter application. It goes to someone with no
     * obligation to reply, asks for a favour that costs them social capital,
     * and fails hard if it presumes a relationship that doesn't exist — so it
     * gets its own framing rather than a tweaked one.
     */
    const intent =
      purpose === "referral"
        ? [
            `You write a short, respectful referral request from a job applicant to a SENIOR PERSON ON THE TEAM THAT IS HIRING — not a recruiter. Keep it ${limit}, plain language, no buzzwords, no emojis.`,
            "",
            "This person owes the applicant nothing and is being asked for a favour that puts their own",
            "credibility on the line. So: be direct about what you are asking, make it easy to say no,",
            "and make it easy to say yes. Do not assume they will refer — ask whether they would be open",
            "to it, or to a short chat first. Never imply an existing relationship, shared employer,",
            "school or mutual contact unless one is stated in the applicant's background below.",
          ].join("\n")
        : `You write short, non-cringe outreach from a job applicant to a recruiter or hiring manager. Keep it ${limit}, plain language, no buzzwords, no emojis, no fake familiarity. End with one clear, low-friction ask.`;

    const message = await askAI(
      [
        {
          role: "system",
          content: [
            intent,
            "",
            "NEVER invent facts about the applicant. You know only what is listed in the next message.",
            "You do not know their graduation date, university, degree, employers, job titles, years of",
            "experience, skills, tools, metrics, or achievements unless they are stated there explicitly.",
            "Do not infer them, do not estimate them, and do not write a plausible-sounding placeholder",
            "as though it were fact.",
            "",
            "Where a personal detail would strengthen the message but was not provided, write a short",
            "bracketed instruction for the applicant to fill in — for example",
            "'[one line on your most relevant project]'. A visible blank is always better than a",
            "confident guess: this message gets sent to a real person, and an invented detail is a lie",
            "in the applicant's name.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Applicant name: ${profile?.full_name ?? "the applicant"}`,
            `Recipient: ${contact.name ?? "the recruiting team"}${contact.title ? ` (${contact.title})` : ""}`,
            purpose === "referral"
              ? "Recipient relationship: a senior person on the hiring team. They do NOT know the applicant. The ask is a referral."
              : "Recipient relationship: recruiter or hiring manager. The ask is consideration for the role.",
            `Company: ${target.company}`,
            `Role: ${target.role_title}`,
            `Channel: ${data.channel}`,
            data.extra
              ? `Applicant background (the ONLY facts you may state about them): ${data.extra}`
              : "Applicant background: NOT PROVIDED. You know nothing about this applicant beyond their name. Use bracketed placeholders for every personal detail.",
            target.job_description ? `Job details: ${target.job_description.slice(0, 1500)}` : "",
            data.channel === "email"
              ? 'Return JSON only: {"subject": string, "body": string}.'
              : 'Return JSON only: {"subject": null, "body": string}.',
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      // Thinking off: faster, and less likely to hit free-tier capacity limits.
      { json: true, thinking: false },
    );

    const { parseJsonBlock } = await import("./ai.server");
    const parsed = parseJsonBlock<{ subject: string | null; body: string }>(message, {
      subject: null,
      body: message,
    });

    const { data: saved, error } = await supabase
      .from("outreach")
      .insert({
        user_id: userId,
        contact_id: contact.id,
        channel: data.channel,
        purpose,
        subject: parsed.subject,
        message: parsed.body,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return saved;
  });
