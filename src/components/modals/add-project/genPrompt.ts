/**
 * genPrompt — produces the "paste this in your coding agent" payload
 * for the Add Project wizard so Claude Code / Cursor / Windsurf can
 * scaffold the new cluster. Pure function — no DOM, no fetch.
 *
 * V107.13 — rewrite driven by the 2026-05-30 cavioca bootstrap field
 * report (7 findings, 2 blockers). Concrete changes:
 *   1. .gitignore contract flipped to a deny-list (runtime/credentials/
 *      timeline/log only) so docs, tasks, initiatives are versioned.
 *   2. transport.endpoint uses the canonical https://daemon.meshkore.com:<port>
 *      shape; cluster.yaml advertises `transport.port_preferred` so
 *      future daemon versions can pin a stable port per cluster.
 *      Operator-facing note: cockpit identifies by cluster_id, not by
 *      port — port may shift between restarts.
 *   3. Daemon download step ALSO fetches the TLS bundle. Without it
 *      the daemon starts in HTTP plain mode and the cockpit (HTTPS
 *      only) can't connect. This was the #1 cavioca blocker.
 *   4. Execution step inverted: the prompt assumes the coding agent
 *      will REFUSE to run a long-lived detached script (most do).
 *      Surface the operator-side paste command FIRST with absolute
 *      path, treat agent-side execution as the optional fallback.
 *   5. Optional persistence step added (LaunchAgent on macOS, systemd
 *      user unit on Linux) so reboots don't silently kill the daemon.
 */

export interface AddProjectAnswers {
  startKind: 'existing' | 'new' | null;
  projectName: string;
  path: string;
  devices: 'single' | 'multi' | null;
  data: 'local' | 'cloud' | null;
}

/** Deterministic port preference in 5570-5589 from a cluster id.
 *  Stable across restarts of the same cluster. Daemon-side support
 *  (read `transport.port_preferred` from cluster.yaml on boot) is
 *  scheduled but harmless if absent — the field is forward-compatible
 *  metadata until the daemon honours it. */
function preferredPort(clusterId: string): number {
  let h = 0;
  for (const ch of clusterId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 5570 + (h % 20);
}

export function genPrompt(answers: AddProjectAnswers): string {
  const name = (answers.projectName || '').trim() || 'my-project';
  const isExisting = answers.startKind === 'existing';
  const isMulti = answers.devices === 'multi';
  const isCloud = answers.data === 'cloud';
  const path = (answers.path || '').trim();
  const portPref = preferredPort(name);

  const L: string[] = [];
  L.push(`Help me set up a new local MeshKore project ("${name}").`);
  L.push('');
  L.push('MeshKore is my local-first multi-agent cockpit. The folder layout,');
  L.push('file schemas and conventions are documented at:');
  L.push('  · https://meshkore.com/standard         (human)');
  L.push('  · https://api.meshkore.com/v1/standard.json    (machine-readable schema)');
  L.push('Use those as the source of truth for what to write where. Below');
  L.push('are the concrete actions; the URLs above are just for verifying');
  L.push('field names and folder structure.');
  L.push('');
  L.push(
    `Parameters:  name=${name}  ·  kind=${isExisting ? 'existing folder' : 'new folder'}` +
    `  ·  data=${isCloud ? 'cloud-sync' : 'local-only'}  ·  devices=${isMulti ? 'multi' : 'single'}`,
  );
  L.push('');

  if (isExisting) {
    L.push('1. Go to my existing folder.');
    if (path) L.push(`     cd ${path}`);
    else L.push('     (ask me for the absolute path, then cd there)');
    L.push('     git init   # only if not already a git repo');
  } else {
    L.push('1. Create the project folder.');
    if (path) {
      L.push(`     cd ${path}`);
      L.push(`     mkdir -p ${name}`);
      L.push(`     cd ${name}`);
    } else {
      L.push(`     (ask me for the parent path, then mkdir + cd ${name})`);
    }
    L.push('     git init');
  }
  L.push('');

  L.push("2. Apply the standard's folder layout (`folder_layout` in the JSON).");
  L.push('   Create the directories:');
  L.push('     .meshkore/{public,scripts,docs,log,timeline,credentials,modules,roadmap}');
  L.push('     .meshkore/scripts/tls');
  L.push('     .meshkore/modules/general/{tasks,log}');
  L.push('     .meshkore/roadmap/initiatives');
  L.push('   chmod 700 .meshkore/credentials');
  L.push("   printf '7' > .meshkore/STANDARD_VERSION");
  L.push('');

  L.push("3. Write .gitignore at the repo root. CONTRACT (V107.13):");
  L.push('   commit docs / modules / roadmap / public / STANDARD_VERSION;');
  L.push('   gitignore ONLY runtime state, credentials, timeline, log,');
  L.push('   and python caches. Append (or merge) into your existing .gitignore:');
  L.push('     # MeshKore — runtime state (do not commit)');
  L.push('     .meshkore/.runtime/');
  L.push('     .meshkore/credentials/');
  L.push('     .meshkore/timeline/');
  L.push('     .meshkore/log/');
  L.push('     .meshkore/state.json');
  L.push('     .meshkore/scripts/__pycache__/');
  L.push('     .meshkore/scripts/tls/privkey.pem');
  L.push('   Everything else under .meshkore/ — docs, modules, roadmap,');
  L.push('   public, agents, protocols — IS versioned. The TLS public');
  L.push('   cert can be committed (or not — your call); the privkey.pem');
  L.push("   must NEVER be committed (it's in the gitignore above).");
  L.push('');

  L.push('4. Write .meshkore/public/cluster.yaml matching the `cluster_yaml`');
  L.push(`   schema. Required fields: version (=1), id (=${name}),`);
  L.push('   type (=dev), name, modules (at least one entry');
  L.push('   {id: general, kind: area}). Add storage.mode:');
  L.push(`   ${isCloud ? 'remote' : 'local'}.`);
  L.push('   ');
  L.push('   For transport, write:');
  L.push('     transport:');
  L.push('       endpoint: "https://daemon.meshkore.com:<port>"   # <port> is dynamic, see below');
  L.push(`       port_preferred: ${portPref}                              # stable hash-derived preference`);
  L.push('   ');
  L.push('   IMPORTANT — port behaviour:');
  L.push('   · The daemon binds the first free port in 5570-5589.');
  L.push('     port_preferred is forward-compatible metadata (current');
  L.push('     daemon ignores it; future versions will honour it).');
  L.push('   · The endpoint field is informational. The cockpit reads');
  L.push('     the actual live endpoint from /health.endpoint, and');
  L.push('     identifies the cluster by cluster_id, NOT by port.');
  L.push('     The port can shift between restarts — that is normal.');
  L.push('   ');
  L.push('   Standard v7 (§10.4) — also add a `daemon` block with');
  L.push('     daemon:');
  L.push('       auto_update: true');
  L.push('       auto_update_source: https://architect.meshkore.com/reference/cluster/scripts/daemon.py');
  L.push('   (or omit; the daemon writes the defaults on first boot).');
  L.push('   Ask me for cluster_description.');
  L.push('');

  L.push("5. Write the three small text files that don't have inline content:");
  L.push('     .meshkore/public/README.md       — one paragraph: this is a');
  L.push('                                        MeshKore cluster, daemon URL,');
  L.push('                                        how to join.');
  L.push('     .meshkore/docs/governance.md     — one paragraph: pointer to');
  L.push('                                        https://meshkore.com/standard');
  L.push('                                        (R5 link-don\'t-copy).');
  L.push('     CLAUDE.md (or .cursorrules/.windsurfrules) at repo root — short');
  L.push('                                        editor boot block pointing at');
  L.push('                                        the same standard URL.');
  L.push('');

  L.push('6. Write a starter task at .meshkore/modules/general/tasks/T1-hello.md.');
  L.push('   Frontmatter MUST match the `task_frontmatter` schema (id, title,');
  L.push('   status, priority, owner, category, created, updated). Body can be a');
  L.push('   one-liner.');
  L.push('');

  L.push('7. Download the local daemon AND its TLS bundle. The bundle is');
  L.push('   REQUIRED — the cockpit only connects over');
  L.push('   `https://daemon.meshkore.com:<port>`. Without the cert+key the');
  L.push('   daemon falls back to HTTP plain and the cockpit cannot reach it');
  L.push("   (the browser sees a TLS error and can't tell the difference");
  L.push('   between "missing TLS" and "daemon not running"):');
  L.push('     mkdir -p .meshkore/scripts/tls');
  L.push('     curl -fsSL https://architect.meshkore.com/reference/cluster/scripts/daemon.py \\');
  L.push('       -o .meshkore/scripts/daemon.py');
  L.push('     curl -fsSL https://architect.meshkore.com/reference/cluster/scripts/tls/fullchain.pem \\');
  L.push('       -o .meshkore/scripts/tls/fullchain.pem');
  L.push('     curl -fsSL https://architect.meshkore.com/reference/cluster/scripts/tls/privkey.pem \\');
  L.push('       -o .meshkore/scripts/tls/privkey.pem');
  L.push('     chmod 600 .meshkore/scripts/tls/privkey.pem');
  L.push('   Verify all three landed (not HTML error pages):');
  L.push('     head -1 .meshkore/scripts/daemon.py    # → #!/usr/bin/env python3');
  L.push('     head -1 .meshkore/scripts/tls/fullchain.pem  # → -----BEGIN CERTIFICATE-----');
  L.push('     head -1 .meshkore/scripts/tls/privkey.pem    # → -----BEGIN PRIVATE KEY-----');
  L.push('');

  L.push('8. Give me the exact command to launch the daemon myself.');
  L.push('   ');
  L.push("   You (the coding agent) MOST LIKELY can't run a long-lived");
  L.push('   detached script — your safety policy refuses it. That is');
  L.push('   fine and the EXPECTED default for this step. Print the');
  L.push('   command with the FULL absolute folder path so I can paste');
  L.push('   it in my own terminal:');
  L.push('   ');
  L.push('     cd <ABSOLUTE-FOLDER-PATH> && \\');
  L.push('       mkdir -p .meshkore/.runtime/logs && \\');
  L.push('       nohup python3 .meshkore/scripts/daemon.py \\');
  L.push('         > .meshkore/.runtime/logs/daemon.log 2>&1 & \\');
  L.push('       disown ; sleep 2 ; \\');
  L.push('       cat .meshkore/.runtime/port 2>/dev/null && \\');
  L.push(
    "       echo '✓ MeshKore daemon launched on the port above. Open https://architect.meshkore.com — it will auto-detect this project (identified by cluster_id, not by port). Logs: tail -f .meshkore/.runtime/logs/daemon.log'",
  );
  L.push('   ');
  L.push('   If — and ONLY if — your sandbox / permission policy allows');
  L.push('   running a detached long-lived process (uncommon), you may');
  L.push('   execute the command above yourself instead. Either way, end');
  L.push('   the response by quoting the absolute path of the project');
  L.push('   folder so I have it handy.');
  L.push('');

  L.push('9. (OPTIONAL — only if I explicitly ask) Install a system-level');
  L.push('   service so the daemon survives reboots, not just terminal');
  L.push('   close. Without this, `nohup ... & disown` keeps the daemon');
  L.push('   alive when I close the shell but it dies on machine restart.');
  L.push('   ');
  L.push('   macOS — LaunchAgent at ~/Library/LaunchAgents/com.meshkore.<id>.plist:');
  L.push('     - Label: com.meshkore.<id>');
  L.push('     - ProgramArguments: [/usr/bin/python3, <ABS_PATH>/.meshkore/scripts/daemon.py]');
  L.push('     - WorkingDirectory: <ABS_PATH>');
  L.push('     - RunAtLoad: true, KeepAlive: true');
  L.push('     - StandardOutPath / StandardErrorPath: <ABS_PATH>/.meshkore/.runtime/logs/launchd.log');
  L.push('     Then: launchctl load ~/Library/LaunchAgents/com.meshkore.<id>.plist');
  L.push('   ');
  L.push('   Linux — systemd user unit at ~/.config/systemd/user/meshkore-<id>.service:');
  L.push('     - ExecStart=/usr/bin/python3 <ABS_PATH>/.meshkore/scripts/daemon.py');
  L.push('     - WorkingDirectory=<ABS_PATH>');
  L.push('     - Restart=always');
  L.push('     Then: systemctl --user daemon-reload && systemctl --user enable --now meshkore-<id>');
  L.push("   ");
  L.push("   Default: SKIP this step on the first run — don't pre-install");
  L.push('   anything. The plain `nohup` path is what I usually want.');
  L.push('');
  L.push('My architect at https://architect.meshkore.com auto-detects the');
  L.push("daemon once it's up (identifies by cluster_id, not port). Nothing");
  L.push('else needed from us today.');

  if (isCloud || isMulti) {
    L.push('');
    L.push("Notes for LATER (after daemon is up — don't do these now):");
    if (isCloud) L.push("  · Cloud sync at cluster.meshkore.com (I'll sign up myself).");
    if (isMulti) L.push('  · Multi-device admission flow.');
  }

  return L.join('\n');
}

export function basename(p: string): string {
  return (p || '').replace(/[/\\]+$/, '').split(/[/\\]/).pop() || '';
}
