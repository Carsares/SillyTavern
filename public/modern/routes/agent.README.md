# Agent workspace in Modern

Open `/modern/?view=agent`, or select **Agent 会话** from the Modern sidebar or
command palette. The existing dashboard, chat, characters, groups, worldbooks,
presets, personas, assets, remote resources, API, extensions, activity and settings
routes remain registered. Their renderers and the original chat actions are not
replaced. The initial default page is unchanged.

`routes/agent.js` registers an additional route. The component uses a visible
same-origin iframe for the complete `/modern/conversation/` client, including its
resource, memory, retrieval, tool, group, usage, trace, media, job and maintenance
screens. The Modern navigation remains outside that frame. A separate-tab link
provides a full-window alternative; the client HTML links back to the Modern
Agent route. No legacy data is imported or silently mapped by this UI host.

`shell/renderer.js` mounts the Agent host as a sibling of the original content
element. The connected iframe is hidden rather than removed when leaving the
route, so drafts, selected conversation, active streams and in-frame navigation
survive normal shell rerenders and page switches. Other pages keep their existing
render path. Agent can mount while unrelated Modern initial data is loading.
Reloading the browser still reloads the client normally. No extra model or tool
request is issued by the host.

`/modern/?view=agent&cid=<encoded conversation id>` forwards `cid` to the iframe
and separate-tab link. At client startup, after the authenticated conversation
list loads, an explicit ID takes precedence over the session's previous selection.
Unknown or empty IDs show an error without creating a conversation or falling
back to another one. Opening still fetches and validates the conversation snapshot.
Without `cid`, the existing saved-selection behavior remains unchanged. This is
initial navigation only: shell rerenders never reset in-frame user navigation.

## Server integration boundary

The parent server owns authentication, the user's directories, CSRF and mounting
`/api/conversation/v1`. The iframe uses the same origin and existing session; this
component does not inject credentials, rewrite endpoints or launch a standalone
Agent server. Main-server static responses must allow same-origin framing
(`frame-ancestors 'self'` / `X-Frame-Options: SAMEORIGIN`, if configured). Do not
serve this embedded page through the isolated standalone server's
`frame-ancestors 'none'` policy. Keep cross-origin framing denied.

## Focused verification

`node --test tests/modern-agent-workspace.test.mjs` checks all original route
identities, Agent registration and links, actual shell renderer lifecycle, iframe
identity across navigation, visible load failure, and the existing router's
Agent/dashboard navigation without invoking chat preparation. These are unit
checks with an in-memory DOM, not browser/authentication/server integration proof.
