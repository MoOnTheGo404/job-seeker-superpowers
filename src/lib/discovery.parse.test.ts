import { describe, expect, it } from "vitest";
import {
  classifyEmail,
  extractEmails,
  hostFromUrl,
  isJobBoard,
  isRecruiterTitle,
  isSeniorTitle,
  looksLikeAuthWall,
  matchesDepartment,
  matchesPerson,
  normalizeDomain,
  parseJsonBlock,
  parseLinkedInTitle,
  scoreReferralCandidate,
  stripHtml,
} from "./discovery.parse";

describe("isJobBoard", () => {
  it("matches exact hosts and subdomains", () => {
    expect(isJobBoard("greenhouse.io")).toBe(true);
    expect(isJobBoard("boards.greenhouse.io")).toBe(true);
    expect(isJobBoard("acme.myworkdayjobs.com")).toBe(true);
  });

  it("does not match a company that merely ends in similar letters", () => {
    // "notlever.co" must not be caught by the "lever.co" entry.
    expect(isJobBoard("notlever.co")).toBe(false);
    expect(isJobBoard("stripe.com")).toBe(false);
  });

  it("treats Handshake as a board on every subdomain a school might use", () => {
    // Missing this made analyzeJob fall back to joinhandshake.com as the
    // employer's domain and search for recruiters at Handshake itself.
    expect(isJobBoard("joinhandshake.com")).toBe(true);
    expect(isJobBoard("app.joinhandshake.com")).toBe(true);
    expect(isJobBoard("mycollege.joinhandshake.com")).toBe(true);
  });
});

describe("looksLikeAuthWall", () => {
  it("catches a redirect to a login path", () => {
    // Real behaviour: Handshake answers /jobs/123 with a 200 and quietly
    // lands you on /access.
    expect(looksLikeAuthWall("https://app.joinhandshake.com/access", "", "")).toBe(true);
    expect(looksLikeAuthWall("https://x.com/users/sign_in", "", "")).toBe(true);
  });

  it("catches a login title even without a telltale path", () => {
    expect(looksLikeAuthWall("https://x.com/jobs/1", "Log in or sign up | Handshake", "")).toBe(
      true,
    );
  });

  it("catches a short page that only talks about logging in", () => {
    expect(looksLikeAuthWall("https://x.com/jobs/1", "", "Please log in to continue.")).toBe(true);
  });

  it("leaves a real posting alone even when it has a sign-in link", () => {
    const posting =
      "Sign in. Senior Backend Engineer at Acme. Responsibilities: build APIs. " +
      "Qualifications: 5 years experience. Benefits include health cover.";
    expect(looksLikeAuthWall("https://acme.com/jobs/1", "Sign in | Acme", posting)).toBe(false);
  });

  it("prefers job content over a login-shaped URL", () => {
    // A posting that genuinely lives under /session should still be read.
    const posting = "About the role: you will own the data platform. Requirements: SQL.";
    expect(looksLikeAuthWall("https://acme.com/session/jobs/1", "Data Engineer", posting)).toBe(
      false,
    );
  });
});

describe("hostFromUrl", () => {
  it("strips www and returns the bare host", () => {
    expect(hostFromUrl("https://www.stripe.com/jobs/123")).toBe("stripe.com");
  });

  it("returns null for junk rather than throwing", () => {
    expect(hostFromUrl("not a url")).toBeNull();
    expect(hostFromUrl("")).toBeNull();
  });
});

describe("normalizeDomain", () => {
  it("reduces a messy input to a bare host", () => {
    expect(normalizeDomain("  HTTPS://WWW.Stripe.com/careers  ")).toBe("stripe.com");
    expect(normalizeDomain("sub.example.co.uk")).toBe("sub.example.co.uk");
  });

  it("rejects things that are not domains", () => {
    // A hallucinated company_domain must not reach the crawler.
    expect(normalizeDomain("Stripe Inc")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
  });
});

describe("stripHtml", () => {
  it("drops script and style bodies entirely", () => {
    const html = "<style>a{color:red}</style><p>Hello</p><script>alert('x@y.com')</script>";
    const text = stripHtml(html);
    expect(text).toBe("Hello");
    // Addresses inside scripts are code, not published contacts.
    expect(text).not.toContain("x@y.com");
  });

  it("collapses whitespace and decodes the entities it handles", () => {
    expect(stripHtml("<p>a&nbsp;&amp;   b</p>")).toBe("a & b");
  });
});

describe("classifyEmail", () => {
  it("flags role inboxes", () => {
    expect(classifyEmail("careers@acme.com")).toBe(true);
    expect(classifyEmail("talent.team@acme.com")).toBe(true);
    expect(classifyEmail("hr@acme.com")).toBe(true);
  });

  it("does not flag ordinary personal addresses", () => {
    expect(classifyEmail("jane.doe@acme.com")).toBe(false);
  });
});

describe("extractEmails", () => {
  const src = "https://acme.com/contact";

  it("finds addresses in both mailto links and body text", () => {
    const html = `<a href="mailto:careers@acme.com">Careers</a><p>or jane.doe@acme.com</p>`;
    const found = extractEmails(html, src, "acme.com").map((e) => e.email);
    expect(found).toContain("careers@acme.com");
    expect(found).toContain("jane.doe@acme.com");
  });

  it("lowercases and trims trailing punctuation", () => {
    const found = extractEmails("<p>Write to Jane.Doe@Acme.com.</p>", src, "acme.com");
    expect(found.map((e) => e.email)).toContain("jane.doe@acme.com");
  });

  it("discards asset filenames and placeholder addresses", () => {
    const html = `<img src="logo@2x.png"><p>you@example.com someone@yourcompany.com</p>`;
    expect(extractEmails(html, src).map((e) => e.email)).toEqual([]);
  });

  it("keeps off-domain addresses only when they are recruiting inboxes", () => {
    const html = `<p>jobs@recruiterpartner.com and randomguy@unrelated.com</p>`;
    const found = extractEmails(html, src, "acme.com").map((e) => e.email);
    expect(found).toContain("jobs@recruiterpartner.com");
    expect(found).not.toContain("randomguy@unrelated.com");
  });

  it("records the surrounding text as provenance context", () => {
    const html = `<p>For hiring enquiries contact careers@acme.com during office hours.</p>`;
    const [hit] = extractEmails(html, src, "acme.com");
    expect(hit?.sourceUrl).toBe(src);
    expect(hit?.context).toContain("hiring enquiries");
    expect(hit?.recruitingRelevant).toBe(true);
  });

  it("returns nothing for a page with no addresses", () => {
    expect(extractEmails("<p>No contact details here.</p>", src)).toEqual([]);
  });
});

describe("matchesPerson", () => {
  it("accepts an address on the company domain containing a name token", () => {
    expect(matchesPerson("jane.doe@acme.com", "Jane Doe", "acme.com")).toBe(true);
    expect(matchesPerson("jdoe@mail.acme.com", "Jane Doe", "acme.com")).toBe(true);
  });

  it("rejects an address on a different domain", () => {
    // Guards against attributing a stranger's address to the person.
    expect(matchesPerson("jane.doe@evil.com", "Jane Doe", "acme.com")).toBe(false);
  });

  it("rejects when no name token appears in the local part", () => {
    expect(matchesPerson("info@acme.com", "Jane Doe", "acme.com")).toBe(false);
  });

  it("ignores short tokens so initials cannot match everything", () => {
    // "Jo" is 2 chars and must not match "info@", "jobs@" and friends.
    expect(matchesPerson("info@acme.com", "Jo Ng", "acme.com")).toBe(false);
  });
});

describe("parseLinkedInTitle", () => {
  it("splits the canonical name - headline - company | LinkedIn shape", () => {
    expect(parseLinkedInTitle("Jane Doe - Technical Recruiter - Acme | LinkedIn")).toEqual({
      name: "Jane Doe",
      title: "Technical Recruiter – Acme",
    });
  });

  it("handles en and em dashes as separators", () => {
    expect(parseLinkedInTitle("Emilie Schwartz – Technical Recruiting Lead").name).toBe(
      "Emilie Schwartz",
    );
  });

  it("keeps a suffixed name intact", () => {
    // "Gary Hebding Jr." must not lose its suffix to the split.
    expect(parseLinkedInTitle("Gary Hebding Jr. - GTM Recruiter @ Stripe").name).toBe(
      "Gary Hebding Jr.",
    );
  });

  it("treats a title with no separator as a bare name", () => {
    expect(parseLinkedInTitle("Amy Salazar")).toEqual({ name: "Amy Salazar", title: "" });
  });

  it("does not split on a hyphenated name", () => {
    // No surrounding spaces, so it is not a separator.
    expect(parseLinkedInTitle("Anne-Marie Cole - Recruiter").name).toBe("Anne-Marie Cole");
  });
});

describe("isRecruiterTitle", () => {
  it("catches recruiting headlines in their common phrasings", () => {
    expect(isRecruiterTitle("Technical Recruiter @ Stripe")).toBe(true);
    expect(isRecruiterTitle("Talent Acquisition Partner")).toBe(true);
    expect(isRecruiterTitle("Recruiting Lead")).toBe(true);
  });

  it("does not flag ordinary staff", () => {
    expect(isRecruiterTitle("Staff Software Engineer")).toBe(false);
  });
});

describe("isSeniorTitle", () => {
  it("accepts genuinely senior individual contributors and managers", () => {
    expect(isSeniorTitle("Senior Backend Engineer")).toBe(true);
    expect(isSeniorTitle("Staff Software Engineer")).toBe(true);
    expect(isSeniorTitle("Director of Engineering")).toBe(true);
    expect(isSeniorTitle("VP Engineering")).toBe(true);
  });

  it("rejects junior and unmarked titles", () => {
    expect(isSeniorTitle("Software Engineer")).toBe(false);
    expect(isSeniorTitle("Junior Developer")).toBe(false);
    expect(isSeniorTitle("")).toBe(false);
  });

  it("rejects recruiters even when their title is senior", () => {
    // Recruiters are found separately; a referral ask is a different request.
    expect(isSeniorTitle("Senior Technical Recruiter")).toBe(false);
    expect(isSeniorTitle("Head of Talent Acquisition")).toBe(false);
  });
});

describe("matchesDepartment", () => {
  it("keeps people in the job's own function", () => {
    expect(matchesDepartment("Senior Backend Engineer", "Engineering")).toBe(true);
    expect(matchesDepartment("Staff Data Scientist", "Data")).toBe(true);
  });

  it("filters out other functions", () => {
    expect(matchesDepartment("Senior Account Executive", "Engineering")).toBe(false);
    expect(matchesDepartment("Director of Marketing", "Engineering")).toBe(false);
  });

  it("widens rather than empties the pool when the department is unknown", () => {
    expect(matchesDepartment("Senior Backend Engineer", null)).toBe(true);
    expect(matchesDepartment("Senior Anything", "Some Unrecognised Team")).toBe(true);
  });
});

describe("scoreReferralCandidate", () => {
  it("scores a senior person on the actual team above a stranger elsewhere", () => {
    const onTeam = scoreReferralCandidate("Senior Backend Engineer", "Engineering");
    const elsewhere = scoreReferralCandidate("Senior Account Executive", "Engineering");
    expect(onTeam).toBeGreaterThan(elsewhere);
  });

  it("ranks more senior titles higher within the same team", () => {
    const director = scoreReferralCandidate("Director of Engineering", "Engineering");
    const senior = scoreReferralCandidate("Senior Software Engineer", "Engineering");
    expect(director).toBeGreaterThan(senior);
  });

  it("returns 0 for people who should never appear as referrers", () => {
    expect(scoreReferralCandidate("Software Engineer", "Engineering")).toBe(0);
    expect(scoreReferralCandidate("Senior Technical Recruiter", "Engineering")).toBe(0);
    expect(scoreReferralCandidate("", "Engineering")).toBe(0);
  });
});

describe("parseJsonBlock", () => {
  const fallback = { company: "", role_title: "" };

  it("parses clean JSON", () => {
    expect(parseJsonBlock('{"company":"Acme","role_title":"Dev"}', fallback)).toEqual({
      company: "Acme",
      role_title: "Dev",
    });
  });

  it("parses JSON wrapped in a markdown fence", () => {
    const fenced = '```json\n{"company":"Acme","role_title":"Dev"}\n```';
    expect(parseJsonBlock(fenced, fallback)).toEqual({ company: "Acme", role_title: "Dev" });
  });

  it("ignores prose before the object", () => {
    expect(parseJsonBlock('Sure! Here you go: {"company":"Acme"}', fallback)).toEqual({
      company: "Acme",
    });
  });

  it("recovers a truncated object by trimming to the last brace", () => {
    expect(parseJsonBlock('{"company":"Acme"} trailing junk', fallback)).toEqual({
      company: "Acme",
    });
  });

  it("falls back rather than throwing on unusable output", () => {
    expect(parseJsonBlock("I could not complete that request.", fallback)).toBe(fallback);
    expect(parseJsonBlock("", fallback)).toBe(fallback);
  });
});
