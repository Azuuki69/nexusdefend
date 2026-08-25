---
name: deploy
description: Ship NexusDefend to the live site - merge the current branch into main, verify the game actually loads, push to origin/main, and confirm local and remote match. Use this whenever the user says deploy, ship it, push it live, release, publish, update the live site, or make the repo match, and whenever they want work that is sitting in the working tree to reach https://azuuki69.github.io/nexusdefend/.
---

# Deploy NexusDefend

Take whatever is in the working tree, get it onto `origin/main`, and confirm the live
site will serve it.

## What makes this repo different

- **The game is one file.** `index.html` holds all markup, styles and game code. There
  is no bundler, no `package.json`, no build output.
- **Pushing *is* publishing.** GitHub Pages serves `main` directly at
  <https://azuuki69.github.io/nexusdefend/>, usually within a minute of the push. There
  is no staging step and no deploy gate.
- **Nothing catches a broken file but you.** With no build, a stray syntax error in
  `index.html` reaches the public URL as a blank page. That is why step 5 exists and
  why it blocks the push.

Repo: `github.com/Azuuki69/nexusdefend` · working dir: `C:\Users\azuuk\Desktop\Claude`

## Invoking /deploy is the permission to push

The standing rule in this project is to never commit or push unless asked. Running
`/deploy` **is** that ask — don't stop and re-confirm "shall I push?" at the end. Go.

What it does *not* authorize is publishing work the user hasn't accounted for. That is
the one decision still worth surfacing, and it's step 2.

---

## 1. Preflight

```bash
git fetch origin && git status -sb && git branch --show-current
```

Report the branch, how far ahead or behind `origin/main` it is, and anything dirty.
If the working tree is clean and `main` is already level with `origin/main`, say so —
there may be nothing to deploy, and that's a fine outcome.

## 2. Uncommitted work — ask before including it

If anything is modified or untracked, list it and ask with `AskUserQuestion`:

- **Include it** — stage and commit it as part of this deploy
- **Deploy without it** — leave it in the working tree, ship only what's committed
- **Cancel**

Ask rather than assume, because loose files in this repo are usually work in progress
rather than finished work. Art has landed in `assets/textures/` more than once before
anything referenced it; sweeping that into a deploy publishes a half-finished change.

When staging, run `git status` again after `git add` and read what's actually included.
Check the contents of anything you didn't create yourself before it goes to a public
repo — an innocuous filename is not evidence of innocuous contents.

## 3. Get the work onto main

Already on `main`: continue.

On another branch, merge it in — this is the "merge main" half of the job:

```bash
git checkout main && git merge --no-ff <branch>
```

`--no-ff` keeps the branch's shape visible in history.

**On conflict, stop.** Report the conflicting files and hand it back. Resolving a merge
you don't understand, in a file this large, is how a working game becomes a broken one.

## 4. Integrate anything already on the remote

If local `main` is behind or has diverged:

```bash
git pull --rebase origin main
```

Rebase rather than merge so history stays linear. Conflicts here get the same treatment
as step 3 — stop and report.

## 5. Verify the game loads (this is the build step)

There's no build to run, so the equivalent is proving the file executes before it
reaches a public URL. There is no Node or Python in this environment; use the in-app
browser, which needs no dependencies.

**a.** Load it fresh — `force: true` matters, or you'll validate a cached copy:

```
mcp__Claude_Browser__navigate  url: file:///C:/Users/azuuk/Desktop/Claude/index.html  force: true
```

**b.** Check for load-time errors:

```
mcp__Claude_Browser__read_console_messages  onlyErrors: true
```

**c.** Prove it actually runs, not just parses. A file can load clean and still throw
the moment a game starts, so start one and tick the loop:

```js
(function(){
  var probes = {
    startGame:  typeof startGame,
    update:     typeof update,
    draw:       typeof draw,
    talentData: typeof talentData,
    BUILDINGS:  typeof BUILDINGS
  };
  var missing = Object.keys(probes).filter(function(k){ return probes[k] === 'undefined'; });
  if (missing.length) return 'MISSING: ' + missing.join(', ');
  var errs = [];
  try { startGame('warrior'); } catch(e) { return 'START FAILED: ' + e.message; }
  for (var i = 0; i < 180; i++) {
    try { update(1/60); } catch(e) { errs.push('update@' + i + ': ' + e.message); break; }
  }
  try { draw(); } catch(e) { errs.push('draw: ' + e.message); }
  return JSON.stringify({ ok: errs.length === 0, level: player.level,
                          nexus: base.maxHp, enemies: entities.enemies.length, errors: errs });
})()
```

Expect `ok: true` with no console errors. A healthy run reports level 1 and the wave-1
nexus HP.

Probe each name with a bare `typeof X`, the way the script above does, and resist
"tidying" it into `typeof window['X']`. Most of this game's top-level state is declared
with `const` and `let`, which are scoped bindings and never become properties of
`window` — checking through `window` reports `talentData` and `BUILDINGS` as missing on
a perfectly healthy file and fails every deploy for no reason.

**If anything fails, stop and do not push.** Report exactly what broke. A failed
verification is this skill working, not this skill malfunctioning — the whole reason
the step exists is that the alternative is finding out from the live site.

If the change touched a specific class, ability or building, start that class instead
of `warrior`, or exercise the thing that changed. The script above is a floor, not a
ceiling.

## 6. Push

```bash
git push origin main
```

Never `--force`. If the push is rejected, someone else pushed in the meantime: fetch,
rebase onto the new tip, **re-run step 5** (you're now shipping a combination neither
side verified), and retry once. If it's rejected again, stop and report.

## 7. Confirm the repos match

```bash
git fetch origin && git rev-parse HEAD origin/main && git status -sb
```

Both hashes must be identical and `git status -sb` must show no ahead/behind. That
equality *is* "the repos match" — assert it, don't assume the push implied it.

Leave `assets-wip` alone. It's a separate line of work and nothing here should touch it.

## 8. Report

Give the user:

- The commit range pushed (e.g. `45ace8a..1fff1a1`)
- Confirmation that local and `origin/main` are equal
- The live URL, noting Pages takes about a minute
- Anything deliberately left behind in step 2, so it isn't forgotten

## Commit messages

Match the repo's existing style — read `git log` if unsure. Sentence-case subject line
in the imperative, blank line, then a body explaining *why* rather than restating the
diff, and:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

## When to stop rather than push through

Stop and hand back to the user on: a merge or rebase conflict, any verification failure,
a second rejected push, or a `git status` that doesn't look like what the earlier steps
led you to expect. The live site is public and the game has no test suite — an honest
"this stopped here, and why" is always cheaper than a broken deploy.
