# Long-conversation evaluation (unit-verified harness, no paid results)

The deterministic `dataset.mjs` generates 1,600 question/answer cases and 3,040
current messages, plus 480 archived revisions/deletions/candidates and 160 manual
locked memories. It uses no user data. Categories (160 each) cover early events,
relationships, corrections, item locations, timelines, user preferences, locked
facts, deletions, selected candidates and unsupported questions. Each question
has an exact value/null answer key, versioned evidence, prohibited old answers,
and early/middle/late position metadata. SHA-256 identifies the full dataset.
`validateDataset` checks current evidence and ensures obsolete facts never leak
into the provider projection. All data is generated in memory, not a downloaded
or hidden corpus.

## Commands

From repository root, run only unit tests during development:

```sh
node --test --test-concurrency=6 tests/conversation/evaluation/*.test.mjs
```

The script is callable without connections or money; default is plan-only:

```sh
node tests/conversation/evaluation/run.mjs
```

A separately authorized real run would use:

```sh
node tests/conversation/evaluation/run.mjs --run --config tests/conversation/evaluation/run.local.json
```

Do not run the last command as a unit test. Without config/authorization/explicit
budget it returns `blocked`, exit 2 and no quality result. stdout is the final
JSON report; stderr emits admission intents and measured records so an external
harness can capture progress. Scripts do not choose or overwrite output files.
Exit codes: 0 complete with quality thresholds passed, 1 complete but thresholds
failed, 2 blocked/incomplete. Planning alone is always `not-run`.

## Built-in adapter and real configuration

`adapter.mjs` exports `createEvaluationAdapter({executor,config,env?,dependencies?})`.
The CLI uses it directly; **no local adapter module or user JavaScript is required**.
All three adapters use the repository's real `createConversationServices`, store,
runtime, compiler, memory and retrieval. Native `pi` uses Pi; `claude` and `codex`
use their actual executors and the restricted SDK gateway. `dependencies` is a pure-unit test seam,
not required by an operator. The native path opens no port. SDK runs mount the existing per-turn gateway on
a random local port; their OS-restricted children can reach only that gateway.
Pure unit tests replace start/process boundaries and open no listeners. Each question batch owns
an isolated temporary `evaluation/.runs/eval-*/conversation-v1` directory, seeded
with the selected synthetic history and source labels. Only that generated directory
is removed on completion. The directory can temporarily contain connection secrets;
do not share interrupted-run directories. Existing user databases are never opened.

Budget enforcement covers native OpenAI Chat Completions/embeddings, Claude
Anthropic Messages, and Codex Responses. The SDK gateway receives the same guarded
fetch as native/auxiliary requests; no model call uses an unmetered fallback.
`memoryConnection` and `embeddingConnection` are optional objects in the same
executor configuration, with the same fields/pricing as `connection`. An explicit memory connection may
set `executor` to native/pi/claude/codex; embedding remains native. Credentials
come from the named environment variable. A missing memory connection uses the
primary; a missing embedding connection uses keyword retrieval. Auxiliary budgets
remain independent of the primary evaluation condition. Image generation and
memory-writing tools are disabled. Optional `tools` accepts `recall_memory`,
`search_lore`, `roll_dice`, `get_time`; recall embedding calls use the same ceiling.

A configuration template is below. All model IDs, limits and price upper bounds
are operator-supplied declarations, not measured provider capabilities or current
pricing. Replace the illustrative values with your connection's verified values.
These caps need not fund an entire condition: insufficient reservations block.

```json
{
  "allowPaid": true,
  "cacheModes": ["uncontrolled"],
  "batchSize": 50,
  "budget": {
    "maxCostUsd": 1,
    "maxRequests": 10,
    "maxInputTokens": 1000000,
    "maxOutputTokens": 20000,
    "deadlineMs": 60000
  },
  "executors": {
    "pi": {
      "modelVersion": "replace-with-verified-model-version",
      "maxRequestsPerBatch": 4,
      "memoryFrequency": 5,
      "connection": {
        "provider": "openai-compatible",
        "baseUrl": "https://your-provider.example/v1/",
        "model": "replace-with-model-id",
        "apiKeyEnv": "EVALUATION_API_KEY",
        "contextWindow": 200000,
        "workingBudget": 190000,
        "maxOutputTokens": 8192,
        "pricing": {
          "inputUsdPerMillionUpper": 10,
          "outputUsdPerMillionUpper": 30,
          "perRequestUsdUpper": 0.01,
          "source": "replace-with-verified-price-source-and-date"
        }
      }
    }
  }
}
```

Inline `apiKey`/headers are rejected. `modelVersion` identifies the configured
version, not a claim that a mutable provider alias was experimentally pinned.
Missing connection, model version, environment credentials or price ceilings
blocks before provider calls. Never commit real local configuration or credentials.

### Configuring both SDKs with one credential

`config.example.json` contains all three executors, disabled paid authorization
and deliberately unset price ceilings. Fill connection URLs/model versions,
verified limits/prices and budgets; set the environment variable and authorize a
separate run. No adapter module is needed. All entries may name the **same**
`apiKeyEnv`, including an endpoint supporting both Anthropic and Responses.
No real provider URL, model capability or price is inferred from the key.

For Claude, `baseUrl` is the Anthropic-compatible root: `/v1/messages` is appended
unless the root already ends with `/v1`, in which case `/messages` is appended.
For Codex it is the Responses API root: `/responses` is appended (normally use a
root ending in `/v1`). These are the existing gateway's exact URL rules. Native
uses `/chat/completions` and embedding uses `/embeddings`. Tool calls go through
that same turn gateway/domain registry; external recall embeddings and summaries
share the overall quote. Host tools, arbitrary endpoints and redirects are not
extra budgeted capabilities and remain prohibited.

### Honest cache modes and unsupported executors

The default plan remains pi/claude/codex × 32,768/65,536/131,072/full × cold/warm
× repeat 3 = **72 conditions**. The built-in adapter does **not** have verified
provider cache isolation. It returns `cacheControl:false`, `verified:false` and
blocks every cold/warm request with `provider-cache-isolation-unverified`, before
any external work. A fresh local database/session does not prove a cold provider
cache. No warm result or cache metric is fabricated.

Explicit `cacheModes:["uncontrolled"]` selects a separately labeled 36-condition
baseline. It never counts as the requested cold/warm evaluation. All three executors expose the same `capabilities/quote/run` interface and have
implemented hard egress ceilings. Native conditions use the selected native
connection; Claude/Codex use the selected Anthropic/Responses endpoint through
their SDK gateway. Installed pinned SDKs and the repository's supported OS isolation
backend are still runtime prerequisites, not replaced by unit doubles in real runs. Missing or blocked executors retain `quality:null` for
the overall report; individual completed conditions retain their actual scores.

`full` never folds or drops selected raw history; oversized input is blocked.
Other budgets invoke the real runtime's bounded compression policy, including its
maximum foreground attempts. The harness does not pre-summarize history to bypass
that policy. A connection can therefore block before producing an answer.

### Quotation, enforcement and exact adapter API

- `capabilities` describes configured model/window, wiring and explicit blockers.
  `runtimeWired:true` means the implementation is connected, not that a paid or
  integrated run was verified.
- `quote(request)` performs no I/O and returns
  `{hardUpperBound:true,maxCostUsd,maxRequests,maxInputTokens,maxOutputTokens}`.
  Each quote reserves `maxRequestsPerBatch` times the worst configured connection
  bounds, including **all** main, summary, indexing, recall and tool-loop requests.
- `run({snapshot,questions,responseFormat,condition,preserveFullHistory,signal,
  ceiling,onFirstToken})` returns `{output,usage,cache,execution}` after runtime
  completion and tracked background jobs. No custom model/tool loop is added.
- `transport-budget.mjs` guards the actual injected `fetch`, including SDK `Request`
  objects. Only configured endpoint/model/protocol POSTs are allowed; redirects and
  unpriced endpoints are rejected. It reserves a conservative UTF-8 byte input
  bound plus protocol allowance, a required output limit and configured price
  upper bound **before every dispatch**. Retries/unknown outcomes consume their
  reservation. All requests share one cap. Even a budget rejection swallowed by
  a background job invalidates the measurement.
- `usage` includes actual input/output/provider request counts. Actual `costUsd`
  remains null unless the connection explicitly declares
  `providerCostField:"usage.cost_usd"` and every response supplies it.
  `costUpperBoundUsd` is separately labeled `configured-price-upper-bound`;
  it is never substituted for billed cost. Missing token usage halts the run.
  Anthropic message_start/delta counters are merged, including explicit cache
  read/write counts once; missing cache counts remain unknown. Responses usage
  comes from response.completed. A truncated SDK stream is incomplete.
- Return cache metadata for the baseline is
  `{mode:"uncontrolled",verified:false,sessionKey}`. Cold/warm verification is
  mandatory for any future adapter that claims those modes.

The enforced dollar ceiling is conditional on the operator's declared maximum
rates and the provider honoring output limits; client-side admission cannot
control an upstream billing violation. A detected usage/bound violation fails the
run. Cancellation and deadlines stop further dispatch. Unknown paid outcomes stop
the matrix and are never retried automatically. No budget reservations are refunded.

Current composition integration gaps are listed in `INTEGRATION-NOTES.md`; pure
unit success does not establish successful integrated execution.

## Scoring and evidence limits

Scoring is local and deterministic: exact normalized answer/null plus exact source
references. It does not award substring matches (including negations). Missing,
duplicate, invalid and invented answers are separate from valid answers. Thresholds
are 90% correctness, at most 2% invented answers, zero stale leaks, and all deletion
and candidate-selection guards correct. A condition only receives a score after
all its batches finish; a partial run has `quality:null`. Median/p95 completion
latency, first-token latency and complete actual cost are reported. Unknown
latency/cost stays null.

This synthetic exact-fact benchmark measures controlled recall and revision
exclusion, not general roleplay/narrative quality. "Invented answer" is an
operational exact-value metric, not a validated natural-language hallucination
judge. Fixtures that use expected answers are labeled `mock` and used only in
unit tests. No model-quality, paid-cost, cold/warm or real-executor result has
been obtained. Real execution, full-context capacity and cache isolation remain unverified or
explicitly blocked. Native and both SDK adapter implementations are present. SDK
egress policy tests invoke the real executor/gateway with fake SDKs and transport;
no child process, real port or provider is exercised.
