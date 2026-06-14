import { useState } from "react";
import mammoth from "mammoth";

/* ────────────────────────────────────────────────
   Resume Evaluator — pre-application check (v2)
   New: posting by URL (web-search fetch), extra-notes
   field, .docx resume upload, and a live three-color
   status blinker. Still no score — the blinker is a
   state derived from real checks, never a number.
   ──────────────────────────────────────────────── */

const INK = "#1B2421";
const PAPER = "#F6F7F5";
const RED = "#C2362B";
const RED_BG = "#FBEFED";
const AMBER = "#9A6B00";
const AMBER_BG = "#FBF3E0";
const GREEN = "#1E7A46";
const GREEN_BG = "#EDF6F0";
const LINE = "#D8DCD8";
const MUTE = "#6B746F";

function extractJSON(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in response");
  return JSON.parse(clean.slice(start, end + 1));
}

async function rawCall(prompt, useSearch, maxTokens) {
  const body = {
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  };
  if (useSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "API error");
  return data.content.map((i) => (i.type === "text" ? i.text : "")).join("\n");
}

async function askClaude(prompt, useSearch = false, maxTokens = 1500) {
  const text = await rawCall(prompt, useSearch, maxTokens);
  try {
    return extractJSON(text);
  } catch (firstErr) {
    // One self-repair pass: hand the broken output back and ask for valid JSON only.
    try {
      const repaired = await rawCall(
        `This text was supposed to be a single valid JSON object but it has a syntax error (${firstErr.message}). Return ONLY the corrected, complete, valid JSON object — no markdown, no commentary, nothing else:\n\n${text}`,
        false,
        maxTokens
      );
      return extractJSON(repaired);
    } catch {
      throw new Error("the model returned malformed data — press Retry");
    }
  }
}

/* ── prompts ── */

const fetchPostingPrompt = (url) => `Use web search to retrieve the job posting at this URL: ${url}

Extract its full content. Respond ONLY with minified JSON, no markdown:
{"found":bool,"title":str,"company":str,"posting_text":str}

posting_text = condensed but COMPLETE extraction: every requirement, qualification, preference, responsibility, location, and visa/clearance note from the posting, in plain text. If the page can't be reached or isn't a job posting, set found:false and explain in posting_text.`;

const fetchRefPrompt = (url) => `Use web search to read this page, which the candidate found while researching a job/company: ${url}

Pull out anything relevant to the role's requirements, preferences, restrictions, culture, comp, or what the team values. Respond ONLY with minified JSON, no markdown:
{"found":bool,"extract":str}

extract = the relevant findings in plain text, under 200 words. If the page can't be reached, set found:false and say so briefly in extract.`;

const reqPrompt = (resume, posting) => `You are a strict resume-vs-job-requirements engine. Compare the RESUME to the JOB POSTING.

Respond ONLY with minified JSON, no markdown, no preamble. Schema:
{"blockers":[{"text":str,"status":"pass"|"fail"|"unknown","note":str}],"musts":[{"text":str,"met":true|false|"unknown","time_to_fill":str|null,"question":str|null}],"plus":[{"text":str,"met":true|false|"partial"}],"summary":str}

Rules:
- blockers = hard walls only: visa/work authorization, security clearance, degree field, hard minimum years. Max 4. "unknown" if resume doesn't say.
- musts = minimum requirements. Binary met. If NOT met and fillable (skill/cert), give realistic time_to_fill (e.g. "2-3 months"). If you cannot tell whether the candidate has it, set met:"unknown" and write a direct question asking if they have an example.
- plus = nice-to-haves, "partial" allowed. Max 6 musts, 6 plus.
- summary = ONE honest sentence on overall fit, naming the biggest gap. No numbers, no percentages.
- Keep every string under 25 words.

RESUME:
${resume}

JOB POSTING:
${posting}`;

const flagPrompt = (resume, posting) => `You are a resume red-flag/green-flag reviewer. Review the RESUME against the JOB POSTING.

Respond ONLY with minified JSON, no markdown. Schema:
{"red_flags":[{"location":str,"severity":"mechanical"|"content"|"fit","issue":str,"original_text":str,"suggested_text":str|null,"needs_input":bool,"question":str|null}],"green_flags":[{"text":str,"action":str}],"ats":{"matched":[str],"missing":[str]}}

Rules:
- mechanical = typos, tense, dates, ATS-breaking format. content = vague bullets, claimed-but-unevidenced skills. fit = role wants X, resume buries or lacks it.
- For mechanical/content: needs_input=false, suggested_text = the actual rewritten text (problem→action→outcome form). original_text = exact text from resume.
- For fit gaps where only the candidate knows if the experience exists: needs_input=true, suggested_text=null, question = direct question to the candidate.
- Max 5 red flags (worst first), max 4 green flags. green action = how to surface it harder.
- ats: exact terms from the posting. matched = appear in resume. missing = required terms absent. Max 8 each.
- Never invent experience. Only rewrite what the resume actually claims.
- Keep strings under 35 words.

RESUME:
${resume}

JOB POSTING:
${posting}`;

const questionPrompt = (posting) => `Generate likely interview questions for this specific job posting, derived from its actual requirements.

Respond ONLY with minified JSON, no markdown: {"questions":[{"q":str,"why":str}]}
Max 8. "why" = which requirement it probes, under 12 words.

JOB POSTING:
${posting}`;

const marketPrompt = (posting) => `Use web search to find REAL, currently-open job postings similar to the one below. Match on JOB REQUIREMENTS and RESTRICTIONS (skills, years, degree, visa/clearance, location), not just job title.

Respond ONLY with minified JSON, no markdown:
{"recommendations":[{"company":str,"role":str,"salary_posted":bool,"salary":str|null,"location":str,"match_reason":str,"url":str,"source":str}],"note":str}

Rules:
- Find up to 5 real open postings. Sort by salary HIGH to LOW; postings with no salary go last.
- salary_posted = true ONLY if the posting itself states pay. If true, salary = the posted range with currency. If false, salary = null — do NOT estimate or guess a number.
- match_reason = under 18 words: which requirements/restrictions it shares with the target role.
- url = the real posting link you found. source = the job board/site.
- If you find fewer than 5 real postings, return only what you found and explain in "note". NEVER invent a posting, company, salary, or URL to reach 5.
- note = one line on how many were found and data quality.
- CRITICAL: output ONE valid JSON object only. No line breaks inside string values. No unescaped double-quotes inside strings — use single quotes or omit them. Keep every string under 20 words. Do not stop mid-array; if you're running long, return fewer postings rather than truncating.

TARGET JOB POSTING:
${posting}`;

const draftPrompt = (flag, answer) => `A resume reviewer flagged: "${flag.issue}" and asked the candidate: "${flag.question}". The candidate answered: "${answer}".

Write ONE resume bullet from the candidate's answer in problem→action→outcome form. Use only facts the candidate stated — invent nothing. Respond ONLY with minified JSON: {"suggested_text":str}`;

/* ── small pieces ── */

const mono = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };

function Tag({ children, color, bg }) {
  return (
    <span
      style={{ ...mono, color: color || MUTE, background: bg || "#ECEEEC", fontSize: 11, letterSpacing: "0.06em" }}
      className="px-2 py-0.5 rounded uppercase"
    >
      {children}
    </span>
  );
}

function Spinner({ label }) {
  return (
    <div className="flex items-center gap-3 py-6" style={{ color: MUTE }}>
      <span className="inline-block w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: LINE, borderTopColor: INK }} />
      <span style={{ ...mono, fontSize: 13 }}>{label}</span>
    </div>
  );
}

function ErrorBox({ message, onRetry }) {
  return (
    <div className="rounded-lg p-4 flex items-center justify-between gap-4" style={{ background: RED_BG, border: `1px solid ${RED}` }}>
      <p style={{ color: RED, fontSize: 14 }}>Couldn't finish this section: {message}</p>
      <button onClick={onRetry} className="px-3 py-1.5 rounded text-sm shrink-0" style={{ ...mono, background: INK, color: PAPER }}>
        Retry
      </button>
    </div>
  );
}

function Section({ title, kicker, children }) {
  return (
    <section className="mb-10">
      <div className="flex items-baseline gap-3 mb-4">
        <h2 style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 22, color: INK }}>{title}</h2>
        {kicker && <span style={{ ...mono, fontSize: 12, color: MUTE }}>{kicker}</span>}
      </div>
      {children}
    </section>
  );
}

function Collapsible({ title, kicker, open, onToggle, children }) {
  return (
    <section className="mb-6 rounded-xl" style={{ border: `1px solid ${LINE}`, background: "#FFFFFF" }}>
      <button onClick={onToggle} className="w-full flex items-center justify-between px-5 py-4 text-left">
        <div className="flex items-baseline gap-3">
          <h2 style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 18, color: INK }}>{title}</h2>
          <span style={{ ...mono, fontSize: 12, color: MUTE }}>{kicker}</span>
        </div>
        <span style={{ ...mono, color: MUTE, fontSize: 14 }}>{open ? "− close" : "+ open"}</span>
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </section>
  );
}

/* ── the blinker ── */

function Blinker({ light, reasons }) {
  const map = {
    red: { c: RED, bg: RED_BG, label: "SEVERE" },
    yellow: { c: AMBER, bg: AMBER_BG, label: "CAUTION" },
    green: { c: GREEN, bg: GREEN_BG, label: "CLEAR" },
  };
  const m = map[light];
  return (
    <div className="flex items-start gap-4 rounded-xl p-4 mb-4" style={{ background: m.bg, border: `1px solid ${m.c}` }}>
      <div className="flex flex-col items-center gap-1 pt-1">
        <span
          className="blinker-dot"
          style={{ width: 22, height: 22, borderRadius: "50%", background: m.c, display: "inline-block" }}
        />
        <span style={{ ...mono, fontSize: 10, color: m.c, letterSpacing: "0.08em" }}>{m.label}</span>
      </div>
      <div>
        {reasons.map((r, i) => (
          <p key={i} style={{ color: light === "red" ? RED : light === "yellow" ? AMBER : GREEN, fontSize: 14, fontWeight: i === 0 ? 700 : 400 }}>
            {r}
          </p>
        ))}
      </div>
    </div>
  );
}

/* ── flag card ── */

function FlagCard({ flag, onUpdate, onDraft }) {
  const [editText, setEditText] = useState(flag.suggested_text || "");
  const [answer, setAnswer] = useState("");
  const sev = flag.severity;

  return (
    <div className="rounded-xl mb-4 overflow-hidden" style={{ border: `1px solid ${flag.status === "accepted" || flag.status === "edited" ? GREEN : LINE}`, background: "#FFFFFF" }}>
      <div className="flex items-center gap-2 px-4 pt-3 flex-wrap">
        <Tag color={RED} bg={RED_BG}>red flag</Tag>
        <Tag>{sev}</Tag>
        <span style={{ ...mono, fontSize: 12, color: MUTE }}>{flag.location}</span>
        {flag.status !== "open" && (
          <span className="ml-auto" style={{ ...mono, fontSize: 12, color: flag.status === "kept" ? MUTE : GREEN }}>
            {flag.status === "accepted" ? "✓ accepted" : flag.status === "edited" ? "✓ edited" : "kept original"}
          </span>
        )}
      </div>
      <p className="px-4 pt-2 pb-3" style={{ color: INK, fontSize: 14 }}>{flag.issue}</p>

      {flag.needs_input && !flag.suggested_text ? (
        <div className="px-4 pb-4">
          <p className="mb-2" style={{ fontSize: 14, color: INK, fontWeight: 600 }}>{flag.question}</p>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Your answer — only facts, the draft will use nothing else"
            className="w-full rounded-lg p-3 text-sm mb-2"
            style={{ border: `1px solid ${LINE}`, background: PAPER, color: INK, minHeight: 70 }}
          />
          <div className="flex gap-2">
            <button
              disabled={!answer.trim() || flag.drafting}
              onClick={() => onDraft(flag, answer)}
              className="px-3 py-1.5 rounded text-sm disabled:opacity-40"
              style={{ ...mono, background: INK, color: PAPER }}
            >
              {flag.drafting ? "drafting…" : "Draft fix from my answer"}
            </button>
            <button onClick={() => onUpdate(flag.id, { status: "kept", needs_input: false })} className="px-3 py-1.5 rounded text-sm" style={{ ...mono, border: `1px solid ${LINE}`, color: MUTE }}>
              Skip
            </button>
          </div>
          {flag.draftError && <p className="mt-2" style={{ color: RED, fontSize: 13 }}>Draft failed: {flag.draftError}</p>}
        </div>
      ) : (
        <div className="px-4 pb-4">
          {flag.original_text && (
            <div className="rounded-lg p-3 mb-2" style={{ background: RED_BG }}>
              <span style={{ ...mono, fontSize: 11, color: RED }}>BEFORE</span>
              <p style={{ fontSize: 14, color: INK }}>{flag.original_text}</p>
            </div>
          )}
          <div className="rounded-lg p-3 mb-3" style={{ background: GREEN_BG }}>
            <span style={{ ...mono, fontSize: 11, color: GREEN }}>AFTER</span>
            {flag.status === "editing" ? (
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full rounded p-2 text-sm mt-1"
                style={{ border: `1px solid ${GREEN}`, background: "#FFFFFF", color: INK, minHeight: 60 }}
              />
            ) : (
              <p style={{ fontSize: 14, color: INK }}>{flag.status === "edited" ? flag.final_text : flag.suggested_text}</p>
            )}
          </div>
          {flag.status === "open" ? (
            <div className="flex gap-2">
              <button onClick={() => onUpdate(flag.id, { status: "accepted", final_text: flag.suggested_text })} className="px-3 py-1.5 rounded text-sm" style={{ ...mono, background: GREEN, color: "#FFFFFF" }}>
                Accept
              </button>
              <button onClick={() => onUpdate(flag.id, { status: "editing" })} className="px-3 py-1.5 rounded text-sm" style={{ ...mono, border: `1px solid ${LINE}`, color: INK }}>
                Edit
              </button>
              <button onClick={() => onUpdate(flag.id, { status: "kept" })} className="px-3 py-1.5 rounded text-sm" style={{ ...mono, border: `1px solid ${LINE}`, color: MUTE }}>
                Keep original
              </button>
            </div>
          ) : flag.status === "editing" ? (
            <div className="flex gap-2">
              <button onClick={() => onUpdate(flag.id, { status: "edited", final_text: editText })} className="px-3 py-1.5 rounded text-sm" style={{ ...mono, background: GREEN, color: "#FFFFFF" }}>
                Save edit
              </button>
              <button onClick={() => onUpdate(flag.id, { status: "open" })} className="px-3 py-1.5 rounded text-sm" style={{ ...mono, border: `1px solid ${LINE}`, color: MUTE }}>
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => onUpdate(flag.id, { status: "open" })} className="px-3 py-1.5 rounded text-sm" style={{ ...mono, border: `1px solid ${LINE}`, color: MUTE }}>
              Reopen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── main app ── */

export default function App() {
  const [stage, setStage] = useState("input");

  // inputs
  const [resume, setResume] = useState("");
  const [fileName, setFileName] = useState(null);
  const [fileErr, setFileErr] = useState(null);
  const [postingUrl, setPostingUrl] = useState("");
  const [postingPaste, setPostingPaste] = useState("");
  const [notes, setNotes] = useState("");
  const [refLinks, setRefLinks] = useState(["", ""]);

  // resolved posting (after fetch / merge)
  const [posting, setPosting] = useState("");
  const [postingMeta, setPostingMeta] = useState(null);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchErr, setFetchErr] = useState(null);

  const [req, setReq] = useState(null);
  const [reqErr, setReqErr] = useState(null);
  const [reqLoading, setReqLoading] = useState(false);

  const [flags, setFlags] = useState(null);
  const [flagErr, setFlagErr] = useState(null);
  const [flagLoading, setFlagLoading] = useState(false);

  const [market, setMarket] = useState(null);
  const [marketErr, setMarketErr] = useState(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);

  const [prep, setPrep] = useState(null);
  const [prepErr, setPrepErr] = useState(null);
  const [prepLoading, setPrepLoading] = useState(false);
  const [prepOpen, setPrepOpen] = useState(false);

  const [copied, setCopied] = useState(false);

  /* ── resume file upload (.docx via mammoth, or plain text) ── */
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileErr(null);
    try {
      if (file.name.toLowerCase().endsWith(".docx")) {
        const buf = await file.arrayBuffer();
        const out = await mammoth.extractRawText({ arrayBuffer: buf });
        if (!out.value.trim()) throw new Error("The file opened but contained no readable text.");
        setResume(out.value.trim());
        setFileName(file.name);
      } else if (file.name.toLowerCase().endsWith(".txt") || file.name.toLowerCase().endsWith(".md")) {
        const text = await file.text();
        setResume(text.trim());
        setFileName(file.name);
      } else {
        throw new Error("Use .docx or .txt — for PDF, copy-paste the text instead.");
      }
    } catch (err) {
      setFileErr(err.message);
      setFileName(null);
    }
  };

  /* ── posting resolution: URL fetch → merge with paste + notes ── */
  const resolvePosting = async () => {
    let base = postingPaste.trim();
    let meta = null;
    if (postingUrl.trim()) {
      setFetchLoading(true);
      setFetchErr(null);
      try {
        const out = await askClaude(fetchPostingPrompt(postingUrl.trim()), true);
        if (!out.found) throw new Error(out.posting_text || "Couldn't read a job posting at that URL.");
        meta = { title: out.title, company: out.company };
        base = base ? `${out.posting_text}\n\nADDITIONAL PASTED POSTING TEXT:\n${base}` : out.posting_text;
      } catch (err) {
        setFetchErr(err.message + " — paste the posting text manually and re-run.");
        setFetchLoading(false);
        return null;
      }
      setFetchLoading(false);
    }
    if (notes.trim()) {
      base += `\n\nADDITIONAL REQUIREMENTS & PREFERENCES THE CANDIDATE FOUND (treat as part of the posting):\n${notes.trim()}`;
    }
    const links = refLinks.map((l) => l.trim()).filter(Boolean);
    if (links.length) {
      setFetchLoading(true);
      for (const link of links) {
        try {
          const out = await askClaude(fetchRefPrompt(link), true);
          if (out.found && out.extract) {
            base += `\n\nFINDINGS FROM A REFERENCE LINK THE CANDIDATE SHARED (${link}):\n${out.extract}`;
          }
        } catch {
          /* a dead reference link shouldn't block the whole evaluation — skip it */
        }
      }
      setFetchLoading(false);
    }
    setPosting(base);
    setPostingMeta(meta);
    return base;
  };

  const runReq = async (p) => {
    const text = p || posting;
    setReqLoading(true); setReqErr(null);
    try { setReq(await askClaude(reqPrompt(resume, text))); }
    catch (e) { setReqErr(e.message); }
    finally { setReqLoading(false); }
  };

  const runFlags = async (p) => {
    const text = p || posting;
    setFlagLoading(true); setFlagErr(null);
    try {
      const data = await askClaude(flagPrompt(resume, text));
      data.red_flags = (data.red_flags || []).map((f, i) => ({ ...f, id: i, status: "open", final_text: null }));
      setFlags(data);
    } catch (e) { setFlagErr(e.message); }
    finally { setFlagLoading(false); }
  };

  const runMarket = async () => {
    setMarketLoading(true); setMarketErr(null);
    try { setMarket(await askClaude(marketPrompt(posting), true, 2500)); }
    catch (e) { setMarketErr(e.message); }
    finally { setMarketLoading(false); }
  };

  const runPrep = async () => {
    setPrepLoading(true); setPrepErr(null);
    try { setPrep(await askClaude(questionPrompt(posting))); }
    catch (e) { setPrepErr(e.message); }
    finally { setPrepLoading(false); }
  };

  const evaluate = async () => {
    setStage("results");
    setReq(null); setFlags(null); setMarket(null); setPrep(null);
    setMarketOpen(false); setPrepOpen(false); setFetchErr(null);
    const text = await resolvePosting();
    if (!text) return; // fetch failed; error shown
    runReq(text);
    runFlags(text);
  };

  const updateFlag = (id, patch) => {
    setFlags((prev) => ({ ...prev, red_flags: prev.red_flags.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
  };

  const draftFix = async (flag, answer) => {
    updateFlag(flag.id, { drafting: true, draftError: null });
    try {
      const out = await askClaude(draftPrompt(flag, answer));
      updateFlag(flag.id, { drafting: false, suggested_text: out.suggested_text, needs_input: false });
    } catch (e) {
      updateFlag(flag.id, { drafting: false, draftError: e.message });
    }
  };

  const acceptedFixes = flags ? flags.red_flags.filter((f) => f.status === "accepted" || f.status === "edited") : [];

  const copyFixes = () => {
    const text = acceptedFixes.map((f) => `• ${f.final_text || f.suggested_text}`).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const blockerFails = req ? req.blockers.filter((b) => b.status === "fail") : [];

  /* ── blinker logic: derived from real checks, live-updates as flags resolve ── */
  const blinker = (() => {
    if (!req) return null;
    const failedMusts = req.musts.filter((m) => m.met === false);
    if (blockerFails.length || failedMusts.length) {
      const reasons = ["Severe — this application has a wall or a missing MUST."];
      blockerFails.forEach((b) => reasons.push(`✕ blocker: ${b.note || b.text}`));
      failedMusts.forEach((m) => reasons.push(`✕ missing MUST: ${m.text}${m.time_to_fill ? ` (fillable, ~${m.time_to_fill})` : ""}`));
      return { light: "red", reasons };
    }
    const unknowns = [
      ...req.blockers.filter((b) => b.status === "unknown").map((b) => `? unconfirmed blocker: ${b.text}`),
      ...req.musts.filter((m) => m.met === "unknown").map((m) => `? answer needed: ${m.text}`),
    ];
    const openReds = flags ? flags.red_flags.filter((f) => f.status === "open" || f.status === "editing") : [];
    if (unknowns.length || openReds.length || !flags) {
      const reasons = ["A bit severe — fixable items are still open."];
      unknowns.forEach((u) => reasons.push(u));
      if (!flags) reasons.push("… flag review still running");
      else if (openReds.length) reasons.push(`${openReds.length} red flag${openReds.length > 1 ? "s" : ""} unresolved below — resolving them turns this green`);
      return { light: "yellow", reasons };
    }
    return { light: "green", reasons: ["Totally fine — blockers pass, MUSTs met, every flag resolved. Send it."] };
  })();

  /* ── input screen ── */
  if (stage === "input") {
    return (
      <div className="min-h-screen" style={{ background: PAPER }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;900&family=IBM+Plex+Mono:wght@400;500&display=swap');
          @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
          .blinker-dot { animation: blink 1.4s ease-in-out infinite; }
          @media (prefers-reduced-motion: reduce) { .blinker-dot { animation: none; } }`}</style>
        <div className="max-w-3xl mx-auto px-5 py-12">
          <p style={{ ...mono, fontSize: 12, color: MUTE, letterSpacing: "0.1em" }}>PRE-APPLICATION CHECK</p>
          <h1 style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 900, fontSize: 40, color: INK, lineHeight: 1.1 }} className="mt-1 mb-2">
            Resume Evaluator
          </h1>
          <p className="mb-8" style={{ color: MUTE, fontSize: 15 }}>
            Upload your resume, drop the posting link, press Evaluate. Every flag comes with its fix. No invented numbers.
          </p>

          {/* resume: upload or paste */}
          <label style={{ ...mono, fontSize: 12, color: INK }}>YOUR RESUME</label>
          <div className="flex items-center gap-3 mt-1 mb-2">
            <label
              className="px-4 py-2.5 rounded-lg cursor-pointer text-sm"
              style={{ ...mono, background: INK, color: PAPER }}
            >
              Upload .docx / .txt
              <input type="file" accept=".docx,.txt,.md" onChange={onFile} className="hidden" />
            </label>
            {fileName && <span style={{ ...mono, fontSize: 13, color: GREEN }}>✓ {fileName} loaded</span>}
          </div>
          {fileErr && <p className="mb-2" style={{ color: RED, fontSize: 13 }}>{fileErr}</p>}
          <textarea
            value={resume}
            onChange={(e) => { setResume(e.target.value); setFileName(null); }}
            placeholder="…or paste your resume text here. Uploading a file fills this box — check it loaded correctly."
            className="w-full rounded-xl p-4 text-sm mb-6"
            style={{ border: `1px solid ${LINE}`, background: "#FFFFFF", color: INK, minHeight: 160 }}
          />

          {/* posting: url + optional paste */}
          <label style={{ ...mono, fontSize: 12, color: INK }}>JOB POSTING LINK</label>
          <input
            value={postingUrl}
            onChange={(e) => setPostingUrl(e.target.value)}
            placeholder="https://jobs.company.com/…  (the app fetches and reads it)"
            className="w-full rounded-xl p-3.5 text-sm mt-1 mb-3"
            style={{ border: `1px solid ${LINE}`, background: "#FFFFFF", color: INK }}
          />
          <details className="mb-4">
            <summary style={{ ...mono, fontSize: 12, color: MUTE, cursor: "pointer" }}>
              + paste posting text instead (or as backup if the link is behind a login)
            </summary>
            <textarea
              value={postingPaste}
              onChange={(e) => setPostingPaste(e.target.value)}
              placeholder="Paste the posting text…"
              className="w-full rounded-xl p-4 text-sm mt-2"
              style={{ border: `1px solid ${LINE}`, background: "#FFFFFF", color: INK, minHeight: 140 }}
            />
          </details>

          {/* extra findings */}
          <label style={{ ...mono, fontSize: 12, color: INK }}>THINGS YOU'VE FOUND <span style={{ color: MUTE }}>(optional)</span></label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Requirements or preferences you learned elsewhere — recruiter calls, employee posts, team blog, LinkedIn of people in the role. Treated as part of the posting."
            className="w-full rounded-xl p-4 text-sm mt-1 mb-3"
            style={{ border: `1px solid ${LINE}`, background: "#FFFFFF", color: INK, minHeight: 100 }}
          />
          <p className="mb-2" style={{ ...mono, fontSize: 11, color: MUTE }}>…or drop reference links — the app reads each and folds the findings in:</p>
          {refLinks.map((link, i) => (
            <input
              key={i}
              value={link}
              onChange={(e) => setRefLinks((prev) => prev.map((l, j) => (j === i ? e.target.value : l)))}
              placeholder={i === 0 ? "https://glassdoor.com/…  team page, review, recruiter post" : "https://linkedin.com/…  someone currently in the role"}
              className="w-full rounded-xl p-3.5 text-sm mb-2"
              style={{ border: `1px solid ${LINE}`, background: "#FFFFFF", color: INK }}
            />
          ))}
          <div className="mb-6" />

          <button
            onClick={evaluate}
            disabled={!resume.trim() || (!postingUrl.trim() && !postingPaste.trim())}
            className="w-full py-4 rounded-xl text-lg disabled:opacity-30"
            style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, background: INK, color: PAPER }}
          >
            Evaluate
          </button>
        </div>
      </div>
    );
  }

  /* ── results screen ── */
  return (
    <div className="min-h-screen" style={{ background: PAPER }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;900&family=IBM+Plex+Mono:wght@400;500&display=swap');
        @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
        .blinker-dot { animation: blink 1.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .blinker-dot { animation: none; } }`}</style>
      <div className="max-w-3xl mx-auto px-5 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p style={{ ...mono, fontSize: 12, color: MUTE, letterSpacing: "0.1em" }}>PRE-APPLICATION CHECK</p>
            {postingMeta && (
              <p style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 15, color: INK }}>
                {postingMeta.title} · {postingMeta.company}
              </p>
            )}
          </div>
          <button onClick={() => setStage("input")} className="px-3 py-1.5 rounded text-sm" style={{ ...mono, border: `1px solid ${LINE}`, color: INK }}>
            ← New check
          </button>
        </div>

        {fetchLoading && <Spinner label="fetching the posting from the link…" />}
        {fetchErr && (
          <div className="mb-8">
            <ErrorBox message={fetchErr} onRetry={() => setStage("input")} />
          </div>
        )}

        {/* 1 ── VERDICT: blinker + blockers + summary */}
        {(reqLoading || req || reqErr) && (
          <div className="rounded-xl p-5 mb-10" style={{ background: "#FFFFFF", border: `2px solid ${blinker ? (blinker.light === "red" ? RED : blinker.light === "yellow" ? AMBER : GREEN) : LINE}` }}>
            {reqLoading && <Spinner label="comparing resume to requirements…" />}
            {reqErr && <ErrorBox message={reqErr} onRetry={() => runReq()} />}
            {req && blinker && (
              <>
                <Blinker light={blinker.light} reasons={blinker.reasons} />
                <div className="flex flex-wrap gap-2 mb-3">
                  {req.blockers.map((b, i) => (
                    <span
                      key={i}
                      className="px-3 py-1 rounded"
                      style={{
                        ...mono, fontSize: 12,
                        background: b.status === "fail" ? RED : b.status === "pass" ? GREEN_BG : "#ECEEEC",
                        color: b.status === "fail" ? "#FFFFFF" : b.status === "pass" ? GREEN : MUTE,
                      }}
                    >
                      {b.status === "fail" ? "✕" : b.status === "pass" ? "✓" : "?"} {b.text}
                    </span>
                  ))}
                </div>
                <p style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 19, color: INK }}>{req.summary}</p>
              </>
            )}
          </div>
        )}

        {/* 2 ── FIX LIST */}
        <Section title="Fixes" kicker="red flags · before / after · resolving these moves the light">
          {flagLoading && <Spinner label="reviewing for red and green flags…" />}
          {flagErr && <ErrorBox message={flagErr} onRetry={() => runFlags()} />}
          {flags && (
            <>
              {flags.red_flags.length === 0 && <p style={{ color: MUTE, fontSize: 14 }}>No red flags found. Rare — read it once more yourself anyway.</p>}
              {flags.red_flags.map((f) => (
                <FlagCard key={f.id} flag={f} onUpdate={updateFlag} onDraft={draftFix} />
              ))}

              {acceptedFixes.length > 0 && (
                <button onClick={copyFixes} className="mt-1 mb-6 px-4 py-2 rounded-lg text-sm" style={{ ...mono, background: GREEN, color: "#FFFFFF" }}>
                  {copied ? "✓ copied" : `Copy ${acceptedFixes.length} accepted fix${acceptedFixes.length > 1 ? "es" : ""}`}
                </button>
              )}

              {flags.green_flags.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2" style={{ ...mono, fontSize: 12, color: GREEN }}>PROTECT THESE</p>
                  {flags.green_flags.map((g, i) => (
                    <div key={i} className="rounded-xl p-4 mb-3" style={{ background: GREEN_BG, border: `1px solid ${GREEN}` }}>
                      <p style={{ color: INK, fontSize: 14, fontWeight: 600 }}>{g.text}</p>
                      <p style={{ color: GREEN, fontSize: 13 }}>→ {g.action}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Section>

        {/* 3 ── GAPS */}
        <Section title="Gaps" kicker="MUST / PLUS · what's fillable, what isn't">
          {reqLoading && <Spinner label="…" />}
          {req && (
            <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${LINE}`, background: "#FFFFFF" }}>
              {req.musts.map((m, i) => (
                <div key={i} className="px-4 py-3 flex items-start gap-3" style={{ borderBottom: `1px solid ${LINE}` }}>
                  <span style={{ ...mono, fontSize: 12, color: m.met === true ? GREEN : m.met === "unknown" ? AMBER : RED, minWidth: 60 }}>
                    {m.met === true ? "✓ MET" : m.met === "unknown" ? "? ASK" : "✕ MUST"}
                  </span>
                  <div>
                    <p style={{ color: INK, fontSize: 14 }}>{m.text}</p>
                    {m.met === false && m.time_to_fill && <p style={{ color: MUTE, fontSize: 13 }}>fillable — est. {m.time_to_fill}</p>}
                    {m.met === "unknown" && m.question && <p style={{ color: INK, fontSize: 13, fontWeight: 600 }}>{m.question}</p>}
                  </div>
                </div>
              ))}
              {req.plus.map((p, i) => (
                <div key={i} className="px-4 py-3 flex items-start gap-3" style={{ borderBottom: i < req.plus.length - 1 ? `1px solid ${LINE}` : "none" }}>
                  <span style={{ ...mono, fontSize: 12, color: p.met === true ? GREEN : MUTE, minWidth: 60 }}>
                    {p.met === true ? "✓ PLUS" : p.met === "partial" ? "◐ PLUS" : "· PLUS"}
                  </span>
                  <p style={{ color: p.met ? INK : MUTE, fontSize: 14 }}>{p.text}</p>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ATS */}
        <Section title="ATS keywords" kicker="literal string matches — many filters are this dumb">
          {flagLoading && <Spinner label="…" />}
          {flags && (
            <div className="rounded-xl p-4" style={{ border: `1px solid ${LINE}`, background: "#FFFFFF" }}>
              <div className="flex flex-wrap gap-2 mb-3">
                {flags.ats.matched.map((t, i) => (
                  <span key={i} className="px-2 py-1 rounded" style={{ ...mono, fontSize: 12, background: GREEN_BG, color: GREEN }}>✓ {t}</span>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {flags.ats.missing.map((t, i) => (
                  <span key={i} className="px-2 py-1 rounded" style={{ ...mono, fontSize: 12, background: RED_BG, color: RED }}>✕ {t}</span>
                ))}
              </div>
              {flags.ats.missing.length > 0 && (
                <p className="mt-3" style={{ color: MUTE, fontSize: 13 }}>
                  Missing terms only matter if they're true of you — add the word where you already have the experience, never fake it.
                </p>
              )}
            </div>
          )}
        </Section>

        {/* 4 ── SIMILAR POSITIONS (collapsed, lazy) */}
        <Collapsible
          title="Similar positions"
          kicker="up to 5 real open roles · matched on requirements + restrictions"
          open={marketOpen}
          onToggle={() => {
            setMarketOpen(!marketOpen);
            if (!marketOpen && !market && !marketLoading) runMarket();
          }}
        >
          {marketLoading && <Spinner label="searching the web for real open postings…" />}
          {marketErr && <ErrorBox message={marketErr} onRetry={runMarket} />}
          {market && (
            <>
              {(market.recommendations || []).length === 0 && (
                <p style={{ color: MUTE, fontSize: 14 }}>No comparable open postings found right now. {market.note}</p>
              )}
              {(market.recommendations || []).map((r, i) => (
                <div key={i} className="rounded-lg p-3 mb-2" style={{ background: PAPER, border: `1px solid ${LINE}` }}>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span style={{ fontWeight: 700, color: INK, fontSize: 14 }}>{r.company}</span>
                    {r.salary_posted ? (
                      <span style={{ ...mono, fontSize: 13, color: GREEN }}>{r.salary}</span>
                    ) : (
                      <Tag color={MUTE}>no salary posted</Tag>
                    )}
                  </div>
                  <p style={{ color: INK, fontSize: 13 }}>{r.role} · {r.location}</p>
                  <p style={{ color: MUTE, fontSize: 13 }}>Shares: {r.match_reason}</p>
                  <div className="flex items-center gap-2 mt-1">
                    {r.url && (
                      <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ ...mono, fontSize: 12, color: INK, textDecoration: "underline" }}>
                        open posting →
                      </a>
                    )}
                    <span style={{ ...mono, color: MUTE, fontSize: 11 }}>{r.source}</span>
                  </div>
                </div>
              ))}
              {market.note && <p className="mt-2" style={{ color: MUTE, fontSize: 12 }}>{market.note}</p>}
              <p className="mt-1" style={{ color: MUTE, fontSize: 12 }}>Only real postings the search actually found — salary appears only where the posting states it, never estimated.</p>
            </>
          )}
        </Collapsible>

        {/* 5 ── PREP (collapsed, lazy) */}
        <Collapsible
          title="Interview prep"
          kicker="questions derived from this posting's requirements"
          open={prepOpen}
          onToggle={() => {
            setPrepOpen(!prepOpen);
            if (!prepOpen && !prep && !prepLoading) runPrep();
          }}
        >
          {prepLoading && <Spinner label="deriving likely questions…" />}
          {prepErr && <ErrorBox message={prepErr} onRetry={runPrep} />}
          {prep &&
            prep.questions.map((q, i) => (
              <div key={i} className="py-3" style={{ borderBottom: `1px solid ${LINE}` }}>
                <p style={{ color: INK, fontSize: 14, fontWeight: 600 }}>{q.q}</p>
                <p style={{ ...mono, color: MUTE, fontSize: 12 }}>probes: {q.why}</p>
              </div>
            ))}
        </Collapsible>

        <p className="mt-8 text-center" style={{ ...mono, fontSize: 11, color: MUTE }}>
          color = meaning · red = severe · yellow = open items · green = clear · the light is derived from checks, never a guess
        </p>
      </div>
    </div>
  );
}
