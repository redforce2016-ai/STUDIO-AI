import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBrowserViewportSvg,
  computeNextScrollY,
  decodeHtmlEntities,
  extractNumericAndTechnicalFacts,
  getAgentBrowserState,
  matchFormRefsForSignup,
  parseAgentBrowserSnapshotJson,
  parseHtmlToStructuredPage,
  refineAndFinalizeStudioPrompt,
  resolveClickTargetUrl,
  selectAvailableProfileWithRotation,
} from "./agentBrowser.js";
import type { BrowserProfileAccount } from "../src/types/studio.js";

test("decodeHtmlEntities decodes named and numeric entities accurately", () => {
  const raw = "لوله&nbsp;مانیسمان &laquo;رده ۸۰&raquo; &amp; استاندارد &#65;STM";
  const decoded = decodeHtmlEntities(raw);
  assert.equal(decoded, "لوله مانیسمان «رده ۸۰» & استاندارد ASTM");
});

test("parseHtmlToStructuredPage extracts title, headings, paragraphs, data points, and resolved links", () => {
  const sampleHtml = `
    <!doctype html>
    <html>
      <head>
        <title>راهنمای مهندسی لوله مانیسمان صنعتی</title>
        <script>console.log("ignore script");</script>
      </head>
      <body>
        <h1>لوله مانیسمان رده ۴۰ و ۸۰</h1>
        <h2>مشخصات فنی و استاندارد ASTM A106</h2>
        <p>لوله مانیسمان بدون درز در دمای ۴۵۰ درجه سانتی‌گراد و فشار کاری ۱۲۰ بار در خطوط نفت و گاز استفاده می‌شود.</p>
        <p>در فرآیند تولید مقاطع فولادی بدون درز، شمش فولادی گرد در کوره تا دمای ۱۲۵۰ درجه گرم شده و بدون هیچ‌گونه جوشکاری سوراخ‌کاری می‌گردد.</p>
        <a href="/standards/astm-a106">مشاهده جدول استاندارد ASTM A106</a>
        <a href="https://fa.wikipedia.org/wiki/فولاد">مقاله فولاد در ویکی‌پدیا</a>
      </body>
    </html>
  `;

  const page = parseHtmlToStructuredPage({
    html: sampleHtml,
    url: "https://industry.example.com/articles/seamless-pipe",
    statusCode: 200,
  });

  assert.equal(page.title, "راهنمای مهندسی لوله مانیسمان صنعتی");
  assert.equal(page.domain, "industry.example.com");
  assert.equal(page.headings.length, 2);
  assert.equal(page.headings[0], "لوله مانیسمان رده ۴۰ و ۸۰");
  assert.equal(page.keyParagraphs.length, 2);
  assert.ok(page.keyDataPoints.length >= 1);
  assert.equal(page.links.length, 2);
  assert.equal(page.links[0].href, "https://industry.example.com/standards/astm-a106");
  assert.equal(page.links[1].index, 2);
  assert.ok(page.wordCount > 25);
});

test("extractNumericAndTechnicalFacts prioritizes sentences with numbers and technical units", () => {
  const paragraphs = [
    "این یک متن کوتاه است.",
    "بر اساس استاندارد API 5L، ضخامت جداره لوله رده ۸۰ در سایز ۴ اینچ برابر با ۸.۵۶ میلی‌متر است.",
  ];
  const facts = extractNumericAndTechnicalFacts(paragraphs);
  assert.equal(facts.length, 1);
  assert.ok(facts[0].includes("API 5L"));
});

test("computeNextScrollY clamps scroll position within [0, maxScrollY]", () => {
  assert.equal(computeNextScrollY(0, 960, "down"), 320);
  assert.equal(computeNextScrollY(800, 960, "down"), 960);
  assert.equal(computeNextScrollY(320, 960, "up"), 0);
  assert.equal(computeNextScrollY(640, 960, "top"), 0);
  assert.equal(computeNextScrollY(0, 960, "bottom"), 960);
});

test("resolveClickTargetUrl resolves numeric indices, text matches, and direct URLs", () => {
  const page = parseHtmlToStructuredPage({
    html: `<html><body><p>توضیحات فنی کامل درباره استاندارد لوله‌های بدون درز فولادی در صنعت پتروشیمی.</p><a href="https://example.com/spec">جدول ضخامت مانیسمان</a></body></html>`,
    url: "https://example.com",
  });
  const searchResults = [
    {
      index: 1,
      title: "نتیجه اول جستجو",
      url: "https://example.org/hit1",
      snippet: "خلاصه نتیجه اول",
      sourceEngine: "Wikipedia FA",
    },
  ];

  const byIndex = resolveClickTargetUrl({
    target: "#1",
    extractedPage: page,
    searchResults,
  });
  assert.equal(byIndex?.url, "https://example.com/spec");

  const byText = resolveClickTargetUrl({
    target: "ضخامت",
    extractedPage: page,
    searchResults,
  });
  assert.equal(byText?.url, "https://example.com/spec");

  const byDirectUrl = resolveClickTargetUrl({
    target: "https://fa.wikipedia.org",
    extractedPage: page,
    searchResults,
  });
  assert.equal(byDirectUrl?.url, "https://fa.wikipedia.org");
});

test("selectAvailableProfileWithRotation automatically switches to next Google account when daily quota is exhausted", () => {
  const mockProfiles: BrowserProfileAccount[] = [
    {
      id: "prof_1",
      name: "Google Account 1",
      email: "user1@gmail.com",
      password: "Test#Pass1",
      avatarColor: "#10B981",
      userDataDir: "output/browser_profiles/prof_1",
      status: "active",
      dailyLimit: 3,
      usedToday: 3, // Exhausted!
      connectedSites: ["google_flow", "leonardo_ai"],
      lastUsedAt: null,
      notesFa: "",
    },
    {
      id: "prof_2",
      name: "Google Account 2",
      email: "user2@gmail.com",
      password: "Test#Pass2",
      avatarColor: "#38BDF8",
      userDataDir: "output/browser_profiles/prof_2",
      status: "standby",
      dailyLimit: 3,
      usedToday: 1, // Available!
      connectedSites: ["google_flow", "leonardo_ai"],
      lastUsedAt: null,
      notesFa: "",
    },
  ];

  const rotation = selectAvailableProfileWithRotation({
    profiles: mockProfiles,
    currentActiveProfileId: "prof_1",
    siteId: "google_flow",
  });

  assert.equal(rotation.selectedProfile.id, "prof_2");
  assert.equal(rotation.selectedProfile.email, "user2@gmail.com");
  assert.equal(rotation.switchedFromProfile?.email, "user1@gmail.com");
  assert.equal(
    rotation.updatedProfiles.find((p) => p.id === "prof_1")?.status,
    "quota_exhausted"
  );
  assert.equal(
    rotation.updatedProfiles.find((p) => p.id === "prof_2")?.status,
    "active"
  );
});

test("refineAndFinalizeStudioPrompt locks in model-specific tokens and camera motion before submission", () => {
  const veoResult = refineAndFinalizeStudioPrompt({
    rawPrompt: "شات نزدیک از لوله مانیسمان رده ۸۰ در پالایشگاه",
    siteId: "google_flow",
    mode: "image_to_video",
    modelId: "veo_2",
    aspectRatio: "9:16",
    resolution: "1080p",
  });

  assert.ok(veoResult.finalizedPrompt.includes("Google Veo 2"));
  assert.ok(veoResult.finalizedPrompt.includes("Vertical 9:16"));
  assert.ok(veoResult.enhancementsFa.length >= 3);

  const omniResult = refineAndFinalizeStudioPrompt({
    rawPrompt: "نمای سینمایی کوره ذوب فولاد",
    siteId: "google_flow",
    mode: "text_to_video",
    modelId: "omni_flash",
    aspectRatio: "16:9",
    resolution: "1080p",
  });

  assert.ok(omniResult.finalizedPrompt.includes("Gemini Omni Flash"));
  assert.ok(omniResult.finalizedPrompt.includes("Widescreen 16:9"));
});

test("buildBrowserViewportSvg renders valid SVG markup with current URL, profile, and model", () => {
  const svg = buildBrowserViewportSvg({
    url: "https://labs.google/fx/tools/flow",
    title: "Google Flow Studio",
    activeAgent: "ایجنت استودیو وب",
    commandLabel: "STUDIO_RENDER",
    extractedPage: null,
    searchResults: [],
    scrollY: 0,
    activeProfileEmail: "hamid.studio.ai.01@gmail.com",
    activeModelLabel: "Google Veo 2",
  });
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("Google Flow Studio"));
  assert.ok(svg.includes("hamid.studio.ai.01@gmail.com"));
});

test("agent browser initializes 10 Gmail accounts with non-empty credentials and isolated dirs", () => {
  const state = getAgentBrowserState();
  assert.equal(state.profiles.length, 10);
  for (const prof of state.profiles) {
    assert.ok(prof.email.endsWith("@gmail.com"));
    assert.ok(prof.password.length >= 8);
    assert.ok(prof.userDataDir.includes(prof.id));
  }
});

test("parseAgentBrowserSnapshotJson & matchFormRefsForSignup resolve @eN accessibility refs accurately", () => {
  const sampleStdout = JSON.stringify({
    success: true,
    data: {
      origin: "https://studio.example.com/signup",
      snapshot: "- textbox \"Full Name\" [ref=e1]\n- textbox \"Email Address\" [ref=e2]\n- textbox \"Password\" [ref=e3]\n- checkbox \"I agree\" [ref=e4]\n- button \"Create Account\" [ref=e5]",
      refs: {
        e1: { name: "Full Name", role: "textbox" },
        e2: { name: "Email Address", role: "textbox" },
        e3: { name: "Password", role: "textbox" },
        e4: { name: "I agree to terms", role: "checkbox" },
        e5: { name: "Create Account", role: "button" },
      },
    },
  });

  const parsed = parseAgentBrowserSnapshotJson(sampleStdout);
  assert.equal(parsed.interactiveRefs.length, 5);
  assert.equal(parsed.interactiveRefs[0].ref, "@e1");
  assert.equal(parsed.originUrl, "https://studio.example.com/signup");

  const matched = matchFormRefsForSignup(parsed.interactiveRefs);
  assert.equal(matched.nameRef, "@e1");
  assert.equal(matched.emailRef, "@e2");
  assert.equal(matched.passwordRef, "@e3");
  assert.equal(matched.agreeRef, "@e4");
  assert.equal(matched.submitRef, "@e5");
});
