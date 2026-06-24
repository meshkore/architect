/**
 * genPrompt — produces the "paste this in your coding agent" payload
 * for the Add Project wizard so Claude Code / Cursor / Windsurf can
 * scaffold the new cluster. Pure function — no DOM, no fetch.
 *
 * py-1.27.2 rewrite (2026-06-24). History: the V107.13 prompt hand-wrote
 * the entire .meshkore tree against the standard SCHEMA and DRIFTED (pinned
 * to STANDARD_VERSION=7 vs live v26; `mkdir -p ${name}` broke on spaces;
 * invalid `id`; stopped to ask for a description). The py-1.27.0 fix moved
 * scaffolding into `daemon.py init` — correct, but it made the CODING AGENT
 * run `init`, which is "executing downloaded code" (agents pause on that)
 * AND init refusing to clobber forced a `--force` question. Field report
 * 2026-06-24: still produced questions.
 *
 * This rewrite removes ALL agent execution and ALL agent decisions. The
 * agent ONLY: create the folder → `curl` the daemon + TLS → print the
 * launch command. It writes no .meshkore files and runs no downloaded
 * script. The DAEMON self-scaffolds on first boot (py-1.27.2): the one
 * launch command the operator pastes anyway both scaffolds the v27 tree
 * and starts serving. `curl` + `git init` are the only things the agent
 * runs — neither trips the "run this downloaded script?" safety prompt.
 *
 *   1. Folder name = slug (no spaces). The launch command runs
 *      `init --name "<display>" --id "<slug>"` (the OPERATOR runs it, not
 *      the agent) for a nice display name, then `nohup … daemon.py` serves.
 *      `init` is now a graceful no-op if already scaffolded (no --force
 *      question), and a bare `python3 daemon.py` auto-scaffolds too.
 *   2. The daemon writes the v27 layout + cluster.yaml + AGENT_INSTRUCTIONS
 *      (→ CLAUDE.md/AGENTS.md/GEMINI.md/.cursorrules) + docs + modules
 *      (general+project) + starter task + .gitignore, pinned to the live
 *      published STANDARD_VERSION. No hand-authoring, no schema decisions.
 */

export interface AddProjectAnswers {
  startKind: 'existing' | 'new' | null;
  projectName: string;
  path: string;
  devices: 'single' | 'multi' | null;
  data: 'local' | 'cloud' | null;
}

/** Mirror of the daemon's `slugify_id` (scaffold.py): lowercase, every run
 *  of non-[a-z0-9] → a single '-', trim leading/trailing '-', clamp to 40,
 *  guarantee ≥2 chars (fall back to 'cluster'). Matches the cluster.yaml
 *  `id` schema pattern `^[a-z0-9-]{2,40}$`. */
export function slugify(name: string): string {
  let s = (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  s = s.slice(0, 40).replace(/^-+|-+$/g, '');
  if (s.length < 2) s = 'cluster';
  return s;
}

const DAEMON = 'https://architect.meshkore.com/reference/cluster/scripts';

export function genPrompt(answers: AddProjectAnswers): string {
  const name = (answers.projectName || '').trim() || 'My MeshKore Project';
  const slug = slugify(name);
  const isExisting = answers.startKind === 'existing';
  const isMulti = answers.devices === 'multi';
  const isCloud = answers.data === 'cloud';
  const path = (answers.path || '').trim();

  const L: string[] = [];
  L.push(`Help me set up a new local MeshKore project ("${name}").`);
  L.push('');
  L.push('MeshKore is my local-first multi-agent cockpit. Your job: create the');
  L.push('folder, download the daemon + its TLS bundle, scaffold the project,');
  L.push('and then give me the one command that starts the long-lived daemon');
  L.push('(see "How to run this" — that last step may need my explicit OK).');
  L.push('');
  L.push('SECURITY (quick, honest read): MeshKore is a local tool. The daemon');
  L.push('binds to 127.0.0.1 only and gates every write/exec endpoint behind a');
  L.push('bearer token in .meshkore/credentials/; its localhost shell-job');
  L.push('endpoint is driven by the cockpit web app (architect.meshkore.com) —');
  L.push("that's the product's purpose, not a backdoor. The bundled TLS key is a");
  L.push('shared localhost cert (browser-compat, not secrecy); it also talks to');
  L.push('*.meshkore.com and may download Chrome-for-Testing on first /verify.');
  L.push('Full disclosure: once running it SELF-UPDATES from that CDN');
  L.push('(cluster.yaml `auto_update: true`) — but every release is Ed25519-');
  L.push('signed and the daemon VERIFIES that signature against a public key');
  L.push('pinned in its own source (RELEASE_PUBKEY_HEX) before swapping, and');
  L.push('refuses any build whose `<url>.sig` does not verify. So a CDN');
  L.push('compromise / MITM cannot push code that runs as me. You can confirm');
  L.push('that in daemon.py. To pin the exact build you audited regardless, set');
  L.push('`auto_update: false` (optional line in the step-4 block below).');
  L.push('Verdict: normal, low-risk for a tool I am installing on purpose — the');
  L.push('ONE action worth a deliberate decision is starting the daemon (step 4).');
  L.push('You may inspect .meshkore/scripts/daemon.py first if you want; fine by me.');
  L.push('');
  L.push('HOW TO RUN THIS: steps 1-3 are reversible and safe (make a folder,');
  L.push('download files, and run the SHORT-LIVED scaffolder that writes text');
  L.push('files and exits — it opens no port, starts no server). Do 1-3');
  L.push('autonomously, no need to ask. Step 4 starts a long-lived local server.');
  L.push('· If you are in an auto-approve / bypass / "automode" that runs commands');
  L.push('  WITHOUT me confirming each one: do NOT auto-run step 4 — pause and ask');
  L.push('  me to confirm it, or tell me to turn automode off for that one step.');
  L.push('· If you already pause for approval: just hand me the step-4 command.');
  L.push('Either way, never silently start the daemon. Everything before step 4,');
  L.push('run straight through without stopping.');
  L.push('Reference (you should not need it — the daemon owns the schema):');
  L.push('  · https://meshkore.com/standard         (human)');
  L.push('  · https://api.meshkore.com/v1/standard.json    (machine-readable)');
  L.push('');
  L.push(
    `Parameters:  name=${name}  ·  id=${slug}` +
      `  ·  kind=${isExisting ? 'existing folder' : 'new folder'}` +
      `  ·  data=${isCloud ? 'cloud-sync' : 'local-only'}  ·  devices=${isMulti ? 'multi' : 'single'}`,
  );
  L.push('');

  if (isExisting) {
    L.push('1. Go to my existing folder.');
    if (path) L.push(`     cd "${path}"`);
    else L.push('     (ask me ONCE for the absolute path if I gave none, then cd there)');
    L.push('     git init   # only if not already a git repo');
  } else {
    L.push('1. Create the project folder (the folder name is the slug — no spaces).');
    if (path) {
      // The path field is meant to be the PARENT dir (we append the slug),
      // but operators routinely paste the FULL intended path (parent + the
      // project name). Detect that — if the path already ends in the slug,
      // it IS the project folder; don't nest a second <slug>/ inside it.
      const target = basename(path) === slug ? path : `${path}/${slug}`;
      L.push(`     mkdir -p "${target}"`);
      L.push(`     cd "${target}"`);
    } else {
      L.push(`     (ask me ONCE for the absolute path if I gave none, then mkdir -p "<path>/${slug}" && cd into it)`);
    }
    L.push('     git init');
  }
  L.push('');

  L.push('2. Download the daemon AND its TLS bundle (curl only, no execution');
  L.push('   here). All three files are REQUIRED — without the cert+key the daemon');
  L.push('   falls back to plain HTTP and the cockpit (HTTPS-only) cannot reach it:');
  L.push('     mkdir -p .meshkore/scripts/tls');
  L.push(`     curl -fsSL ${DAEMON}/daemon.py \\`);
  L.push('       -o .meshkore/scripts/daemon.py');
  L.push(`     curl -fsSL ${DAEMON}/tls/fullchain.pem \\`);
  L.push('       -o .meshkore/scripts/tls/fullchain.pem');
  L.push(`     curl -fsSL ${DAEMON}/tls/privkey.pem \\`);
  L.push('       -o .meshkore/scripts/tls/privkey.pem');
  L.push('     chmod 600 .meshkore/scripts/tls/privkey.pem');
  L.push('   Verify all three landed (not HTML error pages):');
  L.push('     head -1 .meshkore/scripts/daemon.py          # → #!/usr/bin/env python3');
  L.push('     head -1 .meshkore/scripts/tls/fullchain.pem  # → -----BEGIN CERTIFICATE-----');
  L.push('     head -1 .meshkore/scripts/tls/privkey.pem    # → -----BEGIN PRIVATE KEY-----');
  L.push('');

  L.push('3. Scaffold the project — run the SHORT-LIVED scaffolder (safe: it');
  L.push('   writes text files and EXITS immediately; it opens no port and starts');
  L.push('   no server). This produces the full standard tree at the live standard');
  L.push('   version — folder layout, public/cluster.yaml, AGENT_INSTRUCTIONS.md');
  L.push('   plus the rendered CLAUDE.md / AGENTS.md / GEMINI.md / .cursor rules /');
  L.push('   .clinerules, docs, modules general+project, a starter task, and the');
  L.push('   repo-root .gitignore — nothing for you to hand-author or decide:');
  L.push(`     python3 .meshkore/scripts/daemon.py init --name "${name}" --id "${slug}"`);
  L.push('   (Idempotent: a safe no-op if already scaffolded. If your policy will');
  L.push('   not run downloaded code at all, skip this — step 4 also auto-scaffolds');
  L.push('   on first boot; the folder just stays empty until then.)');
  L.push('');

  L.push('4. YOUR TURN — I run this myself; you do NOT. Starting the long-lived');
  L.push('   server is mine to do by design (it opens a bearer-gated localhost');
  L.push('   port the cockpit drives). Even in automode/bypass, do NOT run it —');
  L.push('   instead present it to me CLEANLY as a copy-paste block labelled');
  L.push('   "paste this in your terminal", with the FULL absolute path filled in,');
  L.push('   and stop. (If I would rather you ran it, I will say so / disable');
  L.push('   automode myself — your job is to hand it over, not to start it.)');
  L.push('   ');
  L.push('   ▶ PASTE THIS IN YOUR TERMINAL:');
  L.push('   ');
  L.push('     cd <ABSOLUTE-FOLDER-PATH> && \\');
  L.push('       mkdir -p .meshkore/.runtime/logs && \\');
  L.push('       nohup python3 .meshkore/scripts/daemon.py \\');
  L.push('         > .meshkore/.runtime/logs/daemon.log 2>&1 & \\');
  L.push('       disown ; sleep 2 ; \\');
  L.push('       PORT=$(cat .meshkore/.runtime/port 2>/dev/null) ; \\');
  L.push('       TOKEN=$(cat .meshkore/credentials/portal-token 2>/dev/null) ; \\');
  L.push("       CID=$(sed -n 's/^id:[[:space:]]*//p' .meshkore/public/cluster.yaml | head -1) ; \\");
  L.push('       echo "" ; echo "✓ MeshKore daemon running on port $PORT." ; \\');
  L.push('       echo "→ Open the cockpit (auto-unlocks this project — no token to paste):" ; \\');
  L.push('       echo "  https://architect.meshkore.com/?mk_adopt=$PORT&mk_cluster=$CID&mk_token=$TOKEN" ; \\');
  L.push('       echo "  (logs: tail -f .meshkore/.runtime/logs/daemon.log)"');
  L.push('   ');
  L.push('   The auto-unlock link carries my LOCAL daemon token (read from the');
  L.push('   mode-600 file) straight to my own browser, which stores it for this');
  L.push('   cluster and strips it from the URL — so I never paste a token for my');
  L.push('   own machine. Plain https://architect.meshkore.com works too (asks for');
  L.push('   the token once). Remote/hub clusters keep the explicit token flow.');
  L.push('   ');
  L.push('   ▷ OPTIONAL, run FIRST if you want to pin the exact build you audited');
  L.push('     (turns off the CDN self-update — see the Security note):');
  L.push("       sed -i '' 's/^  auto_update: true/  auto_update: false/' .meshkore/public/cluster.yaml   # macOS");
  L.push("       # Linux: sed -i 's/^  auto_update: true/  auto_update: false/' .meshkore/public/cluster.yaml");
  L.push('   ');
  L.push('   End your reply by quoting the absolute project path so I have it handy.');
  L.push('');

  L.push('5. (OPTIONAL — only if I explicitly ask) Install a system-level service');
  L.push('   so the daemon survives reboots, not just terminal close.');
  L.push('   ');
  L.push('   macOS — LaunchAgent at ~/Library/LaunchAgents/com.meshkore.<id>.plist');
  L.push('     (Label com.meshkore.<id>; ProgramArguments [/usr/bin/python3,');
  L.push('     <ABS>/.meshkore/scripts/daemon.py]; WorkingDirectory <ABS>;');
  L.push('     RunAtLoad+KeepAlive true), then launchctl load …');
  L.push('   Linux — systemd user unit at ~/.config/systemd/user/meshkore-<id>.service');
  L.push('     (ExecStart=/usr/bin/python3 <ABS>/.meshkore/scripts/daemon.py;');
  L.push('     WorkingDirectory=<ABS>; Restart=always), then');
  L.push('     systemctl --user enable --now meshkore-<id>');
  L.push('   ');
  L.push("   Default: SKIP on first run. The plain `nohup` path is what I usually want.");
  L.push('');
  L.push('My architect at https://architect.meshkore.com auto-detects the daemon');
  L.push("once it's up (identifies by cluster_id, not port). Nothing else needed.");

  if (isCloud || isMulti) {
    L.push('');
    L.push("Notes for LATER (after the daemon is up — don't do these now):");
    if (isCloud) L.push("  · Cloud sync at cluster.meshkore.com (I'll sign up myself).");
    if (isMulti) L.push('  · Multi-device admission flow.');
  }

  return L.join('\n');
}

export function basename(p: string): string {
  return (p || '').replace(/[/\\]+$/, '').split(/[/\\]/).pop() || '';
}
