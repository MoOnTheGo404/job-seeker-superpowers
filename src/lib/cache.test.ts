import { describe, expect, it } from "vitest";
import { buildCacheKey } from "./cache.server";

describe("buildCacheKey", () => {
  it("is stable for the same query", () => {
    expect(buildCacheKey("Stripe recruiter linkedin.com/in")).toBe(
      buildCacheKey("Stripe recruiter linkedin.com/in"),
    );
  });

  it("ignores casing and whitespace noise", () => {
    // Company and role names reach these queries straight from the model, with
    // inconsistent casing and spacing — those must not fragment the cache.
    const canonical = buildCacheKey("Stripe recruiter linkedin.com/in");
    expect(buildCacheKey("  stripe   RECRUITER  linkedin.com/in ")).toBe(canonical);
    expect(buildCacheKey("Stripe\trecruiter\nlinkedin.com/in")).toBe(canonical);
  });

  it("keeps genuinely different queries apart", () => {
    expect(buildCacheKey("Stripe recruiter linkedin.com/in")).not.toBe(
      buildCacheKey("Stripe talent acquisition linkedin.com/in"),
    );
    // Different companies must never collide, or one company's recruiters
    // would be served for another.
    expect(buildCacheKey("Stripe recruiter")).not.toBe(buildCacheKey("Shopify recruiter"));
  });

  it("namespaces the key so it cannot collide with another cache's entries", () => {
    expect(buildCacheKey("anything")).toMatch(/^search:/);
  });
});
