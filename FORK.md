# This fork

`vdsmon/prismantis` is a personal fork of [NahumLitvin/prismantis](https://github.com/NahumLitvin/prismantis). It follows upstream and adds features on top. It is installed from its own marketplace, under the same names as upstream: `prismantis@prismantis`.

Upstream's rules in AGENTS.md still apply to the code (no comments, `$` only in `register.tsx` and only through top-level functions, pure helper files), because following them keeps upstream merges small. Fork features are not sent upstream unless we decide to.

## Fork features

Each feature keeps its logic in its own file and adds only thin hooks to `register.tsx`, which is where merges conflict.

| Feature | Own files | Added to `register.tsx` | `$.state` keys (`types/index.d.ts`) |
| --- | --- | --- | --- |
| `clock`: when each prompt was sent and each turn finished (also offered upstream as NahumLitvin/prismantis#74) | `hooks/clock.ts`; the `time` parameter of `renderUserPrompt` and `renderTurnDuration` in `hooks/render.tsx`; the `clock` option in `plugin.json` and `hooks/theme.ts` | `firstDrawn`; recording in `prompt.submit` and `turn.complete`; the `TurnDuration` and `UserMessage` hooks read the records | `sent`, `turnEnds`, `drawn` |
| Tables in tool output | `hooks/tables.ts`, `tests/tables.test.tsx` | `toolTableView`; inside the `toolRows` block, a `tool.call` hook that times shell and MCP calls, the tables appended under `renderToolGroup`, and the table branch in the `ToolResult` hook | `took` |
| Look options: `promptAlign`, `turnLine`, `copyReply`, `diffTint`, `treeMark` | `diffTints` and `treeMark` in `hooks/render.tsx`, which replace the `⎿` marks there; the options in `plugin.json` and `hooks/theme.ts` | the `copyReply` check on the reply button in `drawMarkdown`; the `turnLine: claude` branch of the `TurnDuration` hook | none |

## Pulling upstream

A clean merge is not required. Take upstream's change, then put each fork feature back on top of it.

```
git fetch upstream
git switch -c sync/<upstream version> main
git merge upstream/main
```

1. Resolve the conflicts. They usually land in `hooks/register.tsx` (new atoms and hooks beside ours), `types/index.d.ts` (`PluginState` keys: keep both sides), `docs/CHANGELOG.md` and the version fields.
2. Check each row of the table above still holds: the files exist, the hooks still run, and upstream did not start drawing the same row a different way. If upstream reworked a hook we extend, rebuild our addition on its new shape.
3. Run `claude plugin validate .`, `claude plugin test .`, `tsc`, `npm --prefix scripts run snapshot` and `npm --prefix scripts run bench:check -- --no-time`.
4. Release: set the version in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, and head the CHANGELOG section with it.
5. Open a PR into this fork's `main`, merge it, then `claude plugin marketplace update prismantis && claude plugin update prismantis@prismantis`, and `/reload-plugins` in a running session.

## Versions

A fork release takes the higher of upstream's latest version and the fork's last, plus one patch, so `claude plugin update` always sees a newer version.
