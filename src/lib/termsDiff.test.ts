import { describe, expect, it } from "vitest";
import { markTermsChanges } from "./termsDiff";

describe("marking what changed between two versions of the terms", () => {
  it("marks a word added at the end (Version 2's \"test\")", () => {
    const v1 = "<p><strong>By accepting below, I agree.</strong></p>";
    const v2 = "<p><strong>By accepting below, I agree.</strong><br><strong>test</strong></p>";
    const r = markTermsChanges(v1, v2)!;
    expect(r.changes).toBe(1);
    expect(r.html).toContain('<ins class="terms-added">test</ins>');
    expect(r.html.replace(/<\/?ins[^>]*>/g, "")).toBe(v2);
  });

  it("marks added words as one change, spaces outside the mark", () => {
    const r = markTermsChanges("<p>Report problems to IT.</p>", "<p>Report problems right away to IT.</p>")!;
    expect(r.changes).toBe(1);
    expect(r.html).toBe('<p>Report problems <ins class="terms-added">right away</ins> to IT.</p>');
  });

  it("strikes through removed words where they were", () => {
    const r = markTermsChanges("<p>Keep passwords secret and safe.</p>", "<p>Keep passwords safe.</p>")!;
    expect(r.changes).toBe(1);
    expect(r.html).toContain('<del class="terms-removed">secret and</del>');
    expect(r.html.replace(/<del[^>]*>.*?<\/del>\s?/g, "")).toBe("<p>Keep passwords safe.</p>");
  });

  it("shows a replaced word as removed then added", () => {
    const r = markTermsChanges("<p>Governed by Tennessee law.</p>", "<p>Governed by Florida law.</p>")!;
    expect(r.changes).toBe(1);
    expect(r.html).toBe('<p>Governed by <del class="terms-removed">Tennessee</del> <ins class="terms-added">Florida</ins> law.</p>');
  });

  it("marks only the words of a new paragraph and keeps its tags", () => {
    const r = markTermsChanges("<h2>1. Use</h2><p>Be careful.</p>", "<h2>1. Use</h2><p>Be careful.</p><h2>18. Policy Updates</h2><p>We may update forms.</p>")!;
    expect(r.html).toContain("<h2><ins class=\"terms-added\">18. Policy Updates</ins></h2>");
    expect(r.html).toContain("<p><ins class=\"terms-added\">We may update forms.</ins></p>");
    expect(r.changes).toBe(1);
  });

  it("counts changes in different places separately", () => {
    const r = markTermsChanges("<p>One two three.</p><p>Four five six.</p>", "<p>One 2 three.</p><p>Four five 6.</p>")!;
    expect(r.changes).toBe(2);
  });

  it("finds nothing when the text is the same", () => {
    const html = "<p>Same <strong>text</strong>.</p>";
    expect(markTermsChanges(html, html)).toEqual({ html, changes: 0 });
  });
});
