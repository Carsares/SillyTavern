# Pure context compiler v1

This module reads only the supplied frozen snapshot. It has no legacy settings,
engine, DOM, file, clock, network, storage or random-number dependencies. All files
in this package are ESM. Integration and persistence belong to the runtime owner.

## Public API

```js
import {
    compileContext, computeBudget, PRESET_DEFAULTS, BLOCK_DEFAULTS,
    WORLD_INFO_DEFAULTS, WORLD_ENTRY_DEFAULTS, BUDGET_DEFAULTS,
    CONTEXT_LAYERS,
} from './index.js';

const plan = compileContext(snapshot, {
    draft: 'An unsaved new user message', // omit after beginTurn already saved it
    type: 'send', // send|regenerate|continue|impersonate|auxiliary|group
    workingBudget: 65536,
    variables: { visits: 2 }, // overlays snapshot.settings.variables
    seed: 'frozen-parent-turn-id',
    tools: [{ name: 'recall', description: 'Search', parameters: { type: 'object' } }],
    capabilities: {
        contextWindow: 131072, maxOutputTokens: 4096, inputLimit: 131072,
        outputLimit: 16384,
        tools: true,
        types: ['send', 'regenerate', 'continue', 'impersonate', 'auxiliary', 'group'],
        mediaTokenCost: { image: 2048 }, // verified upper estimate, not a default
    },
    countTokens: request => ({ tokens: tokenizer(request), method: 'my-tokenizer-v1', exact: true }),
});
```

`compileContext` is synchronous. `countTokens(request)` receives
`{mode, messages, tools, prompt?}` and must count the *entire* request, including
message envelopes, reasoning, tool calls/results, tool definitions and media.
It returns a nonnegative integer (reported as an injected estimate) or
`{tokens, method?, exact?}`. Promises/invalid numbers are rejected. The compiler
may call it repeatedly for candidate layouts and an L1 warning calculation;
it must be pure and support both chat/text request shapes. `exact: true` is the
injected counter's attestation, never a claim of actual billed provider usage.
The fallback counts UTF-8 bytes plus envelope allowances, explicitly tagged
`utf8-conservative-estimate`, `exact: false`. It is a conservative text heuristic,
not a mathematical upper bound for every tokenizer. Media has no guessed default:
provide `capabilities.mediaTokenCost[type]` or a pure `(part) => integer` callback,
or a complete injected counter. Unknown media costs fail closed.

The returned contract is
`{messages, blocks, estimatedTokens, budget, omitted, effects, sourceRefs}` with
additive fields `{mode, tools, prompt?, tokenCount, warnings}`. Messages preserve
roles, typed content, `toolCalls`, `toolCallId`, `name`, and `reasoning`; each block
contains its rendered `message`, layer, placement and source references.
No credentials are copied to the plan. `estimatedTokens` is numeric even when a
counter attests exactness; use `tokenCount` for counting provenance.

`computeBudget({contextWindow,inputLimit?,maxOutputTokens,workingBudget?})` returns
`{hardInputBudget,workingBudget,safetyTokens}`:

```text
I = inputLimit ?? contextWindow
S = max(256, ceil(min(I, contextWindow) * 0.02))
H = min(I, contextWindow - maxOutputTokens) - S
W = min(workingBudget ?? 65536, H)
```

Inputs must be positive safe integers and H must be positive. Context window and
output reserve have no guessed model defaults. Compiler limits come from the
selected frozen connection, overridden by `capabilities.limits` and then direct
capability budget fields. A known output limit is validated, never clamped.

`budget-blocked` (status 422) carries
`details.{budget,estimatedTokens,tokenCount,sourceRefs,compressibleSourceRefs,blocks}`.
The compiler keeps *all* raw history not replaced by valid folds. Only optional
prompt/lore/derived blocks can be omitted, with a recorded reason. Compression
candidates exclude the last turn, last completed turn and all open tool groups.
No compression, model call, persistence or history deletion happens here.

## Resource formats and UI defaults

Resources use the existing `{id,kind,name,revision,data}` schema. Only resources
selected by snapshot settings are read. Missing selected resources fail. The
exports above are deeply immutable defaults; UI editors should clone them.
These are the new resource **data** formats, with no schema or legacy changes:

```js
// kind: preset
{
    mode: 'chat', // or 'text'
    system: 'You are {{char}}. {{scenario}}',
    blocks: [{
        id: 'author-note', layer: 'L5', role: 'system',
        placement: { type: 'depth', depth: 1 }, priority: 10,
        required: true, content: 'Stay in character. Visits: {{get::visits}}',
        sourceRefs: [],
    }],
    regex: [{
        id: 'clean', enabled: true, stage: 'after-macros',
        pattern: '\\s+$', flags: 'g', replacement: '', roles: ['system'],
    }],
    textTemplate: {
        prefix: '', message: '{{role}}: {{content}}\n',
        separator: '', suffix: 'assistant:',
    },
}

// kind: character / persona; names come from Resource.name
{ description: '...', personality: '...', scenario: '...' }

// kind: worldbook
{
    scanDepth: 20, maxRecursion: 4,
    entries: [{
        id: 'harbor', enabled: true, content: 'The harbor is guarded.',
        keys: ['harbor'], secondaryKeys: ['night'], secondaryMode: 'any',
        constant: false, recursive: true, caseSensitive: false,
        probability: 100, group: 'location', priority: 10,
        required: false, role: 'system', placement: { type: 'prefix' },
        cooldown: 2, duration: 3,
    }],
}
```

`settings` selects `connectionId`, `presetId`, `characterId`, `personaId`, and
`worldbookIds`. Macro values live in `settings.variables`; worldbook state is
`settings.worldInfo = {turnIndex, state: {'bookId:entryId': timing}}`.
The explicit turn index counts successful **parent** turns, not group members.
Without it the compiler counts complete history groups, which is suitable for
stateless previews but not durable cooldown accounting after history edits.

## Defined semantics

- Layers: L1 fixed settings and tools; L2 memory/summaries; L3 lore/retrieval;
  L4 history; L5 current input and notes. L1 above 25% of W adds a warning.
  L2 4K and L3 25% remain advisory design targets, not silent truncation caps.
- Placement is `{type:'prefix'}`, `{type:'tail'}`, or
  `{type:'depth',depth:N}`. Depth 0 is after history; 1 is before its final turn;
  excess depth is before all history. Drafts count as a new turn. Injection never
  splits a tool group. Prefix layers sort L1→L5, then priority descending and
  stable ID ascending. Same depth/tail sorts by priority and ID. History order is
  unchanged. With absent turn IDs, a user message starts a new turn.
- Tool groups use assistant `toolCalls:[{id,name,args}]` and tool messages with
  `toolCallId`. Orphan/duplicate results, duplicate calls and noncontiguous turns
  fail. Open groups are retained and never compression candidates. A fold can
  only replace whole groups. The compiler does not run tools.
- Macros: `{{char}}`, `{{user}}`, `{{scenario}}`, `{{type}}`,
  `{{get::name}}`, `{{set::name::literal}}`, `{{inc::name::number}}`.
  Reads of absent variables yield empty text; increments start at zero.
  Writes expand to empty text and update only the current render's local state.
  Unknown/malformed macros fail. Expansion is one pass: substituted values are
  never evaluated as macros. History and derived text never execute macros.
- Regex order: `before-macros` → macro expansion → `after-macros` on resource
  prompt blocks; `history` on raw history/drafts. `output` runs only via explicit
  `applyRegex(text,rules,{stage:'output',role:'assistant'})` by the runtime.
  Rules execute in array order, `roles:[]` means all, replacements use standard
  JavaScript regex string semantics. They operate on copies only.
- Lore searches plain history text, in complete turn units (`scanDepth:0` scans
  none). Primary keys match any literal substring. Secondary mode is any/all/none;
  empty secondary keys impose no condition. Constant entries bypass keywords.
  Recursion scans content of all previously activated entries, bounded 0..32
  rounds after initial activation. Only recursive entries may activate later.
  Activated text can trigger lore even if it is subsequently omitted by budget.
  Probability is 0..100, deterministic per seed/parent-turn/entry. One winner per
  nonempty group across selected books, priority then stable book/entry ID;
  earlier recursion rounds claim groups first. No ambient randomness or clock.
- Timing: `activeUntil` and `nextEligibleTurn` are exclusive parent-turn bounds.
  Activation at T uses `activeUntil=T+max(1,duration)` and
  `nextEligibleTurn=activeUntil+cooldown`. During duration no keyword/probability
  reroll is needed; group conflicts still apply. Resource revision changes
  invalidate prior timing. An already active entry does not extend its duration.
- Text mode retains typed messages and additionally returns `prompt`. Template
  macros include `role`, `content`, `name` in each message, plus global bindings;
  variable writes in text templates fail. Tool metadata/reasoning is appended as
  explicit JSON inside message content. Text mode rejects media, never drops it.
  An executor must explicitly support this text protocol; this is not proof of
  any provider's tool-text support. Chat mode never flattens roles.
- The runtime provides generation-type-specific frozen history (e.g. exclusion
  of a regenerate target) and continuation prefix blocks. The compiler validates
  type and exposes `{{type}}`; it does not guess a target or remove messages.

## Source validity and effects

Fold format: `{id,revision,status:'valid',sourceRefs,summaryRef:{id,revision}}`.
A fold may instead carry its own `content`/dependencies. Summary dependencies
use `parentSummaryRefs:[{id,revision}]`. All sources, selected candidates,
deletions, parent revisions/status and cycles are revalidated. Fold and summary
must cover exactly the same resolved sources. Expanded/stale/partial folds
restore raw messages. Rolling summaries sort by source coverage descending to
avoid re-injecting their covered chapters. No summary without an effective fold
can hide raw history.

Optional `snapshot.retrieval` entries use
`{id,status:'valid',content,sourceRefs,score?}`. Memories use the existing contract;
source-free manual valid blocks are supported, locked valid blocks are required.
Stale/pending-confirm blocks are excluded even when locked. Source deduplication
is conservative at whole-message-version granularity: if a derived block overlaps
represented raw/folded sources it is omitted entirely. Mixed duplicate/new
fragments are not silently split. Required duplicate prompt sources fail.
UI block IDs must not use reserved `history:`, `summary:`, `derived:`, `world:`,
`character:`, `persona:`, `preset:` prefixes or `draft`.

Effects are **proposals**, never applied by this module:

```js
{ type: 'variable.set', name, previous, value, blockId }
{ type: 'worldbook.activate', key, entryId, bookId, bookRevision, previous,
  value: {bookRevision,activatedTurn,activeUntil,nextEligibleTurn} }
```

Only included blocks contribute effects. Rendering rejected budget candidates
does not leak writes. Repeated estimates return the same proposals. Runtime must
apply the ordered proposals and advance `turnIndex` once in the successful parent
turn's terminal transaction, with revision/attempt/idempotency checks. Failure,
stop, preview and event replay must not commit them. Group members use shared
temporary state/variables and a fixed parent turn index; persistence is not tested
or implemented here.

## Focused unit verification

```sh
node --test tests/conversation/modules/context/*.test.mjs
```

Uses only synthetic in-memory data and injected counters. No network, paid model,
database, integration or browser tests. Provider serialization, actual token
accounting, effect transaction semantics and final integration remain for their
respective owners.
