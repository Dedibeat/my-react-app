# The Four-Repo System: A Review Before I Go

Written by the retiring senior engineer. Read all of it. It is long because the
system is one thing and nobody has ever written about it as one thing.

Scope: `qoj-intergration` → `llm-integration` → `analyze_standings` →
`my-react-app`, plus the `mostafa_sheet` reference material. Sources: the five
details docs, read end to end, cross-referenced against each other. The
per-repo "simplicity first / surgical changes" rules are deliberately
suspended for this document — this is judgment, not code.

---

## Part 1 — What you got wrong

Not style. Mistakes that cost money, lost data, shipped broken software, or
burned weeks. I'm going to be specific, and where you eventually did the right
thing I'll say so — because in almost every case you *knew* how to do it
right, and did it right *after* the damage. That's the pattern to fix.

### 1. You root-caused a production-crashing bug and then left the fix on disk

The DB 500s — every signup and login on the live site failing — were traced to
the libsql Hrana stream bug, fixed with a stdlib rewrite of `db.py`, and
**verified against the real Turso DB with 30 parallel requests, all green**.
Then the session ended with the fix sitting uncommitted in a working tree,
with a note in DETAILS.md: *"Needs to be committed and pushed to deploy the
fix to Render."* Production kept serving the broken build.

That is not a git-hygiene nitpick. A verified fix for a total-outage bug that
isn't pushed **is not a fix**. It's a private artifact on one machine, one
`git checkout .` away from not existing. And it wasn't an isolated slip —
DETAILS.md "Issue 3" catalogs a working tree with ~16 modified/deleted files
spanning **two sessions** of uncommitted work, including that DB fix. Later,
the GH Pages migration shipped a bundle built from a tree that was "one commit
ahead of origin/master," pushed via SSH directly into the pages repo —
**the live site was built from source that existed in no pushed commit
anywhere**. And the Vercel prod deployment was separately found serving a
bundle four commits stale because the GitHub webhook had silently stopped
firing and nobody noticed until a manual audit.

Three different ways for "what's deployed" to diverge from "what's in git,"
and you hit all three. The rule you kept breaking is simple: **a change is
done when it is committed, pushed, and observed live — not when it works
locally.** The docs even contain the observation trick (curl the deployed
bundle and grep for the new sort key). You had the verification technique and
used it *after* discovering the staleness, never as the closing step of the
change that introduced it.

### 2. The docs said `deepseek-v4-flash`; the code ran `-pro`; the money didn't care

`CLAUDE.md` documented the tagger's default model as `deepseek-v4-flash`. The
code ran `deepseek-v4-pro` — at roughly **3.2× the per-token price** — and
nobody knew until a docs audit. Then the drift happened *again in the other
direction*: the runtime-facts table said `-pro` after commit 72872a6 had
switched the code to `-flash`. And a third instance: on 2026-06-25 you
measured Flash ≈ Pro quality and *decided* "use Flash for detect_olympiad" —
and production `detect_olympiad` kept running Pro, a divergence the log itself
flags as open.

Individually each is small. Together they mean that for weeks, **nobody could
answer "what model is production running" without reading the source**, and
every cost analysis and every "is this experiment comparable to production"
judgment was built on a guess. The runtime-facts table was invented precisely
to stop this and then wasn't kept in sync — a sync table that isn't
mechanically checked is just a second place for the lie to live. The tagger
repo already knows the fix, because it uses it elsewhere:
`tests/test_taxonomy_consistency.py` mechanically enforces prompt↔taxonomy
lockstep. Constants that cost money deserve the same enforcement as
constants that shape tags.

The same family of failure, worse consequence: the 320-problem importance run
was launched with `--workers 330`, the burst outran DeepSeek's context cache,
and **~8.9M input tokens billed as cache misses** for a ~27K-token prefix that
should have been paid for roughly once. Output was ~2.5M tokens of which
**~95% was native reasoning that the code discarded**. You discovered all of
this *after* the run, from the usage numbers. The usage logger and the warmup
call — both built the very next session — should have been the *pre-flight*
for the first paid run, not the post-mortem tooling. Before you spend, you
measure what a spend costs. `--limit 2` existed. Use it.

### 3. The importance rater: the rigor was real, but it arrived after the money

Four experiments — the LOO held-out eval, the noise-ceiling probe, the
bucketing check, the anchored decider — converged on one verdict: the model
cannot reproduce Mostafa's novelty axis from problem text; the failure is
systematic, non-invertible, prompt-resistant. The experiments themselves are
some of the best work in these repos. Each tested a *distinct mechanism*
(wording → sampling → calibration → reference frame), each was cheap
(~$1 each), each was honestly reported.

So was it genuine rigor or an expensive path to an obvious conclusion? Both,
and here's the uncomfortable part: **the sequence was inverted.** The 40
labeled problems in `promth.txt` — the entire ground truth needed for the
decisive eval — existed *before the feature shipped*. The cheap first check
(rate the 40, compare to Saad, ~$1, one afternoon) was available from day
one. Instead, the order of events was: build the rater → run it over 320
production problems (the cache-miss fiasco above) → ship the P1–P5 column to
the UI → build a dual-thumb range slider → rebuild it as a merged heat-strip
slider → fix its stuck-at-P5-P5 deadlock → add a reset pill → **then** run
the held-out eval that showed the ratings were regression-to-the-mean noise.
Three sessions of UI polish on a data column that a one-afternoon check would
have killed.

And the tell was written down *before any of it ran*. The original scope
notes say: *"Expect the resulting ratings to skew toward the middle (p2–p3)
more than mostafa would assign; this is a known limitation."* You predicted
the exact failure mode, documented it, and shipped anyway. Reading
`promth.txt` closely would have shown the second tell: the labels encode
**trainee comments** ("introduces a very new trick") — a signal that simply
is not present in the production input. The four experiments proved,
expensively and beautifully, something the inputs' information content
already implied.

The lesson is not "don't run experiments." It's: **the cheapest decisive test
runs before the feature ships, not after.** Eval-first is not a luxury for
LLM features; it's the difference between $4 of evals and weeks of UI work on
noise.

### 4. The difficulty model's constants were swept against a yardstick you later proved is your noisiest referee

`MU0 = 2000`. `PRIOR_STRENGTH = 1.0`. `SMOOTH = 0.5`. `sigma = 400`. The sigma
choice is documented with a sweep table whose selection criterion is
**LLM-bucket Spearman** — agreement with `difficulty_estimate`, a
statement-only guess emitted by the sibling repo's tagger. The same details
doc, a few hundred lines later, concludes from the Kattis comparison that
*"the LLM is the noisier referee"* — noisier than your own model. So the
model's regularization was tuned to maximize agreement with a signal you
subsequently demonstrated to be the weakest external check you have. That's
the textbook shape of overfitting to a proxy: not "the constants are wrong,"
but "you cannot know they're right, because the thing they were optimized
against isn't truth."

To be fair about what happened next: you then built genuinely independent
yardsticks (CF-rated mirrors, Kattis, the gym fixed-θ instrument), a LOCO
metric with a noise floor, and guards — and the two autoresearch campaigns
re-tested σ sweeps against the better metric and correctly discarded them. The
methodology matured impressively. But the early constants were never
systematically re-derived under the new metric, and the pattern nearly
repeated at the calibration layer: the two-leg map's hyperparameters (NBINS,
ALPHA) were "chosen on this same anchor set (the known residual risk)," and
the gym-prior change was **logged as KEPT on the strength of guards that were
circular for that change** — pulling `b` toward `b_gym` mechanically raises
Spearman against `b_gym` — while the genuinely independent signals (AUC flat,
Kattis *down*) said no. Review caught it and reverted. Good. But "review
caught it" was luck-shaped; the guard-circularity check should be part of the
keep rule itself: **a corroborating metric must be independent of the change's
mechanism, or it isn't corroboration.**

One more from the same repo, because it's the purest case: the original
"KEPT" log entry for `80afc92` described a commit that **had never actually
been made**. The experiment log asserted repository state instead of
reporting it. Logs that describe intentions as facts are how the next person
loses a day.

### 5. Three deploy targets, zero decisions

The app serves from Vercel, Render, *and* GitHub Pages. Not by design — by
accretion. The Vercel-Python dead end burned "the most time" of a session
before the API moved to Render (a defensible call, well documented). Then GH
Pages was added as a "secondary, full mirror" with its own SSH deploy key,
its own force-push workflow, its own `--base=./` build variant — and Vercel
was "left in place for now." Every one of those "for now"s is still there.

The costs are all over the docs: a manual `vercel --prod` because the webhook
died; CORS breakage on the Pages origin until an env var was hand-edited on
Render; `VITE_API_BASE` build-time wiring that makes a dev page silently talk
to prod unless you remember the env var; three places a stale bundle can
serve, **two of which were observed actually serving stale code**. Each
target is individually cheap. The *set* of them is a standing tax on every
deploy and every debugging session ("which origin are you on?"). Nobody ever
sat down and wrote "we serve from X, the others die." That sentence is one
line of judgment that would have deleted a whole class of incidents.

### 6. You tested against production by accident, twice, and wrote it in prod

Feedback-endpoint verification ran against the **production Turso DB**
because `TURSO_URL`/`TURSO_TOKEN` were exported in the shell — creating the
`problem_feedback` table in prod as a side effect of a *test*, plus a
leftover `fbtester` user that couldn't even be cleaned up in-session. The
footgun (`TURSO_URL` silently overrides `LIBSQL_URL`) got documented as a
"beware" note. A beware-note is not a fix. Prod credentials should not be
reachable by default from a dev shell, and a test that writes should assert
which database it's pointed at before it writes. This one ended harmlessly.
The identical pattern with a `DELETE` in it doesn't.

### 7. The sidecar overwrite: 760 paid reasoning traces, gone

`detect_olympiad_with_reasoning.py` defaulted its output sidecar to
`reasoning_sidecar_path(--output)` — which, for an in-place run, **is the
same file it reads its assist data from**. First full run: all 760 tagging
reasoning traces overwritten with 412 olympiad traces. Not in git, no backup,
unrecoverable; the assist feature is now dead for 1,256 problems unless the
tagger is re-run at real cost. The fix (distinct suffix + refuse to equal the
assist source) took minutes. The pre-flight question that would have
prevented it takes seconds: *"this run writes files — enumerate the paths;
does any of them alias an input?"* For any in-place pipeline, that question
is mandatory, every time.

### 8. Every consumer discovered the data corruption separately, and nobody told the producer

`tagged.json` shipped with duplicate problems — 2,658 entries, 1,799 unique
URLs, 85 problem_ids reused across contests. The **frontend** discovered it
via React duplicate-key warnings and deduped its copy with a local Python
snippet. Months apart, `analyze_standings` discovered its copy had **213
contest entries for 146 contests** — up to 6× duplicated standings silently
inflating every team's contest count and the fit's likelihood; removing them
moved arch A's agreement with the LLM ranking from **+0.792 to +0.908**. The
largest single accuracy improvement in that repo's history was a *data bug
from upstream*, and the two consumers each found and fixed their own slice
independently. As far as the docs show, the extractor — the producer — was
never fixed or even notified; the corruption is still latent for the next
dataset regeneration (the loaders keep "defensive" dedup guards, which is an
admission that the source is untrusted).

This is the systemic version of everything above: **there are at least four
divergent copies of "the dataset"** — `my-react-app/data/tagged.json`,
`public/tagged.json` (a hand-synced mirror the build doesn't even serve),
`llm-integration/data/tagged.json`, `analyze_standings/data/tagged.json` —
mutated in place by different tools, with different dedup states, joined by
different keys. And the cross-repo plumbing is one person's home directory:
`rate_importance.py`'s default `--input` is the **absolute path**
`/home/dedibeat/Projects/my-react-app/data/tagged.json` — an LLM CLI in one
repo whose default behavior is to rewrite the frontend's data file in
another repo, in place. `llm-integration` reads `../mostafa_sheet/promth.txt`
and `../icpc-notebook/sections/`. None of this is visible from inside any
single repo, which is exactly why nobody ever saw the system whole.

### 9. Every v2 tag was produced under a broken editorial parser

`extract_editorial_snippet` split the contest editorial on PDF form-feeds.
On contest 1799, only problems G and L got snippets at all, and G's "snippet"
contained the editorials for G, H, I, J, and K. Until 2026-06-21, editorial
grounding — the thing the whole confidence-cap hierarchy keys on — was
corrupted for a large fraction of problems, and it was found by *reading one
contest's output by hand*, late. Everything tagged under prompt v2 had to be
paid for again. The lesson generalizes: **when a parser feeds an LLM, sample
its output and read it** — the LLM will not throw an exception on garbage
input; it will confidently tag garbage.

### The through-line

Look at the list again. The DB fix was correct — undeployed. The evals were
excellent — late. The metric discipline was real — after the constants were
tuned. The bench caught the bad prompt — after the first prompt shipped
untested. The dedup guards are solid — downstream of a producer nobody fixed.
You are good at the *second* pass. The entire cost of this system to date is
the gap between the first pass and the second. Close that gap and you're a
different team.

---

## Part 2 — The handover: how to think about this system

For the model inheriting this. Not rules — rules are what the per-repo
CLAUDE.md files are for, and following them was never the problem. This is
the judgment layer above the rules: how to decide what a task *is* before
you start it. Every section below exists because its absence caused a
specific incident in Part 1; none is padding.

### 2.0 First, hold the correct picture: this is one pipeline, not four repos

The unit of this system is not a repo. It is the **lineage of one artifact**:

```
qoj.ac ──(qoj-intergration/qoj.py)──▶ contests.json
   contests.json ──(llm-integration: main.py, detect_olympiad.py,
                    extract_techniques.py, rate_importance.py)──▶ tagged.json
   tagged.json + standings ──(analyze_standings)──▶ problem_rating.json,
                                                    medal_badges.json
   tagged.json + problem_rating.json ──▶ my-react-app/data/ ──▶ users
```

Every field in `tagged.json` has a producer, a contract, and consumers in
*other repos*. `shortest_solution` is written by the extractor and read by
three LLM passes. `difficulty_estimate` was written by the tagger, consumed
by the app, then consumed by `analyze_standings` as a validation yardstick,
then removed from the tagger (v3) — and each of those steps had cross-repo
consequences. The repos also touch through the filesystem: absolute default
paths, `../` sibling reads, in-place writes into another repo's data
directory. Until you have traced which copy of which file a task touches,
you do not yet know what the task is.

### 2.1 When a request names one repo, find the request's blast radius before its solution

A request will say "change the tags" or "fix the difficulty column." The repo
it names is where the *symptom* or the *edit* lives — almost never where the
task ends. The method:

1. **Name the artifact the change flows through.** Not the file you'll edit —
   the data field or contract that changes. "Retag with a new taxonomy" →
   the artifact is the `primary_tags` field of `tagged.json`.
2. **Walk upstream:** who produces the inputs to that artifact? Does the
   change need anything the producer doesn't emit yet (a new extractor
   field)? If yes, the task starts one repo earlier than it was phrased.
3. **Walk downstream:** grep *every* repo for the field name. The app's
   `flattenContests` silently drops fields it doesn't know; the standings
   repo may be using the field as a *validation yardstick* (the LLM
   difficulty was); a search-hay string may embed it. A consumer you didn't
   find isn't a consumer that doesn't exist — it's an incident scheduled for
   later.
4. **Enumerate the copies.** Which of the four+ `tagged.json` copies does
   this touch? Does the change need to be mirrored (`data/` vs `public/`),
   re-derived (`dist/`), or re-run (a resume-aware LLM pass whose cache the
   change invalidates)?
5. Only now scope the work — and say the blast radius out loud in your
   report, including the repos you verified are *not* affected and how you
   verified it.

Case study to internalize: "show importance in the UI" *sounded* like a
my-react-app task. Its true shape was: a prompt + few-shot contract with
`mostafa_sheet`, a paid batch run in `llm-integration`, an in-place mutation
of the app's dataset, a UI column, and — the part everyone skipped — an
evaluation question ("can this rating be produced at all?") whose answer
lived in a fourth repo's labeled data. The task was mis-scoped as frontend
work, so the eval got done last instead of first.

### 2.2 Decomposing a lockstep change: order the steps so that no step strands you

When a change must move across repos or across a producer/consumer boundary,
the decomposition is not "list the edits" — it's "order the edits so the
system is never in a state you can't back out of, and the expensive step
happens exactly once."

Principles, each earned here:

- **Data flows first, in pipeline order.** Producer change → regenerate
  artifact → consumer change. Never edit a consumer against an artifact
  that doesn't exist yet; never regenerate an artifact under consumers that
  can't read it.
- **Version the contract, don't vibe it.** The tagger's
  `prompt_version`-aware resume is the house pattern: a version bump
  mechanically invalidates stale cached results while letting finished work
  survive a mid-run crash. Any cross-repo artifact change should carry a
  version the consumers can check, for the same reason.
- **Find the atomic pairs.** When the status API's GET shape changed
  (`{pid: status}` → `{pid: {status, updated_at}}`), backend and frontend
  had to deploy together — and the docs flagged it. Before you start, ask:
  which pairs of components break if only one side ships? Those pairs are
  your deploy units. If a pair spans a boundary you can't deploy atomically,
  you need a compatibility window (accept both shapes, then remove).
- **Put the irreversible and the expensive last, behind a checkpoint.**
  Paid LLM runs, prod DB writes, force-pushes to a pages repo, in-place
  dataset mutations: sequence them after everything reversible is verified,
  make sure a backup exists (`.bak-pre-*` is the house pattern), make sure
  resume works, and run the `--limit 2` version first. The sidecar-overwrite
  incident is what "expensive step first, path audit never" looks like.
- **The final step of every decomposition is convergence:** commit, push,
  deploy, observe live, update the docs the change invalidated. If your plan
  doesn't contain those as explicit steps, your plan describes work that
  will be lost.

### 2.3 Verification: "tests pass" is the beginning of the question

The test suites here are **mock-only by design** — they prove plumbing:
validators validate, resume resumes, retries retry. They cannot prove that a
model returns sane tags, that a parser reads real PDFs, that a deploy took,
or that a paid run costs what you think. Green tests are necessary and close
to meaningless as a completion claim. The verification ladder for this
system, bottom to top — climb as high as the change's risk demands:

1. **Unit/suite** — plumbing intact.
2. **`--dry-run` / `--limit 2`** — the real path, real data, minimal spend.
   Read the actual output JSON, not the exit code.
3. **Read the artifact and the money.** After any LLM step: open the output,
   read a few rationales against their problems, and read the usage line
   (cache hit ratio, reasoning tokens). The cache-miss fiasco and the
   editorial-leak bug were both sitting in plain sight in outputs nobody
   read.
4. **Behavioral check with known answers.** The benches
   (`olympiad_bench.json`, `techniques_bench.json`, the 40 `promth.txt`
   labels) exist so that "did the change help" is a number, not an
   impression. A prompt/taxonomy/model change that skips its bench is
   unverified, full stop — and remember the house lesson: single-shot
   deltas at n=40 are noise; R≥3 modal, on editorial-grounded gold,
   borderlines excluded.
5. **Live observation.** For anything deployed: hit the deployed URL and
   observe the specific new behavior (the repo's own trick — curl the served
   bundle and grep for the new symbol; curl the endpoint and check the new
   field). "Render auto-deploys on push" is a claim about a webhook, and
   webhooks here have silently died before.

And the anti-patterns, all locally attested: verifying against prod because
the shell had prod env vars (assert your target DB before writing);
verifying the *local* build while the deployed one is stale (observe the
deployment, not the workstation); verifying that a fix works and stopping
before pushing it (verification of an undeployed fix verifies nothing users
will experience).

### 2.4 Docs drift: treat every documented constant as an allegation

The docs in these repos are unusually good, which creates the failure mode:
they're trusted. The model-name incident (docs said flash, code ran pro,
then the "fixed" table said pro while code ran flash) shows drift survives
*because* each artifact is individually plausible.

Operating posture:

- **Before relying on any doc claim that names a constant, a default, a
  path, or a model — verify it at source.** `grep MODEL main.py` costs five
  seconds. The runtime-facts table even tells you where each value lives;
  the table's *values* are the part that rots.
- **Highest-risk claims:** anything with a price attached (model ids, worker
  counts, token budgets), anything with a default (`--input` paths, env-var
  precedence), and anything that says "X and Y are kept in sync" without a
  test enforcing it. Sync claims without enforcement are wishes.
- **When you find drift, you own it**: fix the doc (or the code — decide
  which one is wrong, that's the actual work), in the same change, with a
  dated log entry. A noticed-but-unfixed drift is worse than an unnoticed
  one, because the next reader sees a doc that survived an audit.
- **When you change behavior, sweep the prose.** The house rule ("update
  details.md after the task") failed exactly where the same fact lived in
  three places. After a behavior change, grep all five doc files for the
  old value. If a fact is important enough to state twice, it's important
  enough to state once and reference — or to enforce with a test, the way
  taxonomy↔prompt lockstep already is.

### 2.5 Reporting a result that cost money and settled nothing

You will run experiments that spend real dollars and return mush. The
temptation — especially for a model that wants to be helpful — is to find
the positive angle: "shows promise," "directionally better," "improved on
two of five metrics." That is how a team ends up shipping a P1–P5 column of
noise. The house standard is the anchored-decider log entry, and it's worth
imitating deliberately: verdict **FAILED** in the header; the metric it was
supposed to move (must-solve recall) moving the *wrong* way, 38%→6%, stated
in the first table; the mechanism ("the middle anchor became a gravity
well"); the cost ($1.02); and the *decision* ("demote the feature; stop
spending on prompt variants").

The contract for any paid, inconclusive, or negative result:

- **Pre-register the success criterion** — before the run, write the number
  that would make you ship. If you can't write it, you're not ready to
  spend. (The ±5-point LOCO threshold with independent corroboration is the
  model.)
- **Report against that criterion first**, then the supporting detail. Never
  lead with the one metric that happened to move.
- **"Within noise" is a null result.** Say "no measurable effect (Δ −1.2,
  noise floor ±20)," never "slightly better." The autoresearch campaigns'
  discipline — 23 of 25 iterations discarded, in writing — is the standard.
- **Check your corroboration for circularity.** If the change's mechanism
  mechanically moves the guard (gym prior → gym Spearman), the guard is
  disqualified for that change. Name which signals are independent.
- **State the cost and what was learned per dollar.** "175 calls, $1.02,
  killed the last prompt-side hypothesis" is a *good* outcome honestly
  framed.
- **Distinguish "measured, no effect" from "not measured."** The Gemma
  schema-mode arm that was intentionally skipped is fine — because the log
  says it was skipped and why. An unlabeled gap reads as a zero.
- **End with a decision**, not a data dump: ship / revert / park, and what
  evidence would reopen it. A parked feature with a reopening condition
  (see: importance, reopened only when a 7× larger dataset appeared) is a
  decision. A trailing "could be explored further" is a cop-out.

### 2.6 Self-review before saying "done": the six questions

Derived one-for-one from this system's actual incidents. Ask them, out loud,
in the report:

1. **Is it committed, pushed, and live — and did I observe it live?** Not
   "will deploy on push." Observed. (Incident: the undeployed DB fix; the
   dead webhook.)
2. **What did this run write, and where?** Enumerate every output path,
   including defaults and in-place targets. Does any alias an input? Did any
   touch another repo's files or a production database? (Incidents: the
   sidecar overwrite; the `fbtester` row in prod.)
3. **If money was spent: what did it cost, what was the cache-hit ratio,
   and does the resume path cover a re-run?** Read the usage line before
   and after scaling worker counts. (Incident: 330 workers, 8.9M cache-miss
   tokens.)
4. **Which documented facts did my change falsify, and did I fix them all —
   in every doc file that states them?** (Incident: flash/pro, three
   times.)
5. **What is the cheapest test that could have proven this change wrong,
   and did I run it?** For prompt/model changes: the bench, at R≥3. For
   parsers feeding LLMs: read five real outputs. For deploys: curl the
   thing. If the honest answer is "the decisive test exists and I skipped
   it," you are not done — you are where the importance feature was the day
   it shipped.
6. **Would the report survive the author of the anchored-decider entry
   reading it?** No hedged verdicts, no laundered nulls, no "KEPT" entries
   describing commits that don't exist.

---

## Part 3 — The goals, judged cold

You asked me not to hand back your framing, so first the premises.

**Goal A's premise is half wrong, and the half that's wrong matters.** No
problem browser wins a gold medal. In a 4–5 month window, the medal is
decided by training hours, team practice under contest conditions, and
strategy — coach territory, not software territory. If the team believes the
platform is the plan, they lose. **But the half that's right is genuinely
rare:** this system holds per-problem solve counts and times for the actual
target contests, a computed gold/silver/bronze difficulty bar for every
historical EA regional, and a technique taxonomy already cross-referenced
against the team's own notebook. Nobody else training for this regional has
that. The honest reframe: *the platform cannot make the team stronger; it can
make every training hour point at the gold bar instead of at "problems in
general."* Aim, not strength. Judged against that reframe, almost all
existing engineering effort — importance sliders, heatmaps, CF sync polish,
feedback modals, three deploy targets — is aim-irrelevant, and the four
unused assets are the entire ballgame.

**Goal B's premise is right, but the first attempt at it read "complement"
as "replicate," and the repos already contain the proof of why that fails.**
Four experiments established that no prompt, no ensemble, no anchor, and no
calibration map recovers Mostafa's novelty judgment from problem text —
because the signal his labels encode (trainee reactions accumulated over
~225 trainees and 25k submissions) is not in the text. Treat that not as a
failed feature but as the **product definition**: his judgment is the scarce
asset precisely because it is not synthesizable. A platform complements it
by doing two things: distributing the judgment he has already made, and
mass-producing everything *around* such judgment that is mechanical — while
building the same feedback loop he used, so new human judgment accumulates.
Note what falls out of the mostafa_sheet history: his levels came from
"students' evaluation… to replace the auto-value," and his importance
ratings began as "asking students to determine how interesting the problem
is." **His method is a crowd-sourced human signal with a curator on top.
That method scales. His labels don't.** The app's per-problem feedback
system — currently a throwaway modal — is, structurally, the seed of exactly
that loop.

**Are the two goals in conflict?** No — but not because they want the same
features (they don't; A wants team-facing aim tools, B wants individual
training loops at scale). They share the entire data spine, the difficulty
model, and the technique extraction; and Goal A is Goal B's founding story.
"The platform a team used to train for — and medal at — an EA regional" is
a credibility asset no amount of feature work buys. Sequence them: A now,
B's foundations laid only where they're free byproducts of A.

### What I would build, in order

**0. One canonical dataset build (precondition, ~days).** Fix the producer:
dedup in `qoj-intergration` where the duplicates are born. One build script
that runs the pipeline end to end into one versioned artifact that all
consumers read; kill the `public/` mirror and the absolute-path defaults;
make `rate_importance`-style in-place cross-repo writes impossible. Every
feature below joins medal badges, techniques, ratings, and statuses by
`(contest_id, problem_id)` — that join is currently a gamble across four
divergent copies. This is not hygiene for its own sake; it is the load-
bearing wall for everything else, and it's days, not weeks.

**1. The gold-bar board (Goal A, the centerpiece — build first, see below).**

**2. Virtual-contest debrief against the real field (Goal A).** The team
replays a past EA regional as a timed 5-hour team contest (Mostafa's own
progression note: 3.5h early, 5h near the contest). They enter their solves
and times; the app places them in the *actual* standings — real rank, real
medal verdict, from data already sitting in `tagged.json` — and then the gap
list: which problems did the gold-band teams solve that you didn't, and
which techniques do those problems exercise. This converts the standings
corpus from model-fitting fuel into the team's weekly feedback loop, and it
is the one feature that trains the *team*, not three individuals. No
platform work needed beyond a form and a join.

**3. Notebook-gap study list over the gold band (Goal A).** Run
`extract_techniques` (validated: 100% on non-borderline gold) over the
gold/bonus-badged problems of the last three seasons of EA regionals
specifically. Rank extension-tier hits by frequency. That output is a
prioritized answer to "what should be added to the notebook, and which
techniques decide medals that we currently can't execute." The machinery
exists end to end; nobody has pointed it at the medal band.

**4. Team visibility, minimal (Goal A).** Three accounts, one shared view of
per-member status over the EA problem set. Who has solved what; what nobody
has touched; what two of three failed. Not chat, not rooms, not a "team
platform" — one column per member on the existing table. The app is
single-user today because features were added for one user; this is the
smallest change that makes it a team tool.

**5. Only after the regional — Goal B's first real feature: the block
sampler.** Mostafa's published method, operationalized: given a user's level
(the difficulty model is genuinely good enough — +0.92–0.96 against CF/gym —
and its residual error is irrelevant for sampling training blocks), emit a
10-problem block at 10/20/60/10 below/at/slightly-above/way-above, biased
toward problems carrying his actual sheet ratings where they exist, shown
verbatim and attributed. Alongside it, grow the feedback loop (per-problem
"taught me something new" signal from real users) — the trainee-comment
signal the LLM never had, accumulating this time at platform scale.

### The single highest-leverage thing: the gold-bar board

One page, for the team, per target regional profile: every problem from
recent EA regionals, badged bronze/silver/**gold**/bonus/star from
`medal_badges.json`, joined with calibrated CF-scale difficulty, technique
tags, each member's status, and editorial availability — default-sorted to
*"gold-badged and below, unsolved by all three of you, exercising techniques
in your notebook-gap list."* The top of that list **is the training plan.**
The gold bar's CF-point median (~2655, spread 2114–2885 by venue) even tells
the team what difficulty ceiling they must be reliable at, per city.

Why this over everything else: it is the unique intersection of all four
unused assets (standings-derived bars, medal badges, technique gaps, LLM
tags) and the existing app; it converts the entire back-catalog of modeling
work into daily training decisions; it serves the team format; and it is
roughly a week of work because **every input already exists as a computed
artifact** — the remaining work is the join and a table the codebase already
knows how to render five different ways. Items 2–4 all snap onto it.

### What I would refuse to build, even if asked

**Any LLM-generated importance/novelty rating shown to users.** This is the
hard no. Four independent measurements proved the rater regresses both tails
to the middle, non-invertibly — it specifically cannot identify the P5
must-solve problems, which is the *only* purpose such a rating has. Shipping
it anyway (again) would put fabricated judgment in the exact place the
platform's whole thesis says human judgment is irreplaceable — it would
counterfeit the one thing Goal B exists to honor. The narrow legitimate use
stays internal: a high-recall model (the Gemma-26B finding, 66% must-solve
recall) as a *candidate queue for a human curator*, its output never
rendered to a trainee. If the sheet's author or platform users rate a
problem, show that, attributed. If no human has, show nothing. "Unknown" is
honest; a confident-looking P3 that is secretly a coin flip is not.

Two supporting refusals, briefly: **no further difficulty-model accuracy
work before the regional** — two 25-iteration campaigns say it's at a robust
plateau, the remaining error lives in 0–1-solver problems no standings data
can resolve, and it is already more than accurate enough for training
selection; the clock belongs to Goal A. And **no fourth deploy target, ever
— pick one of the existing three and delete the other two** the same week
anything from this document ships.

---

*Committed to the review branch across the repo set. The judgment above is
mine; the numbers are all yours — every one of them is already in your own
details docs, which is the most encouraging thing I can tell you: the
raw material for running this well has been on disk the whole time.*
