/**
 * genPrompt — produces the "paste this in your coding agent" payload
 * for the Add Project wizard so Claude Code / Cursor / Windsurf can
 * scaffold the new cluster. Pure function — no DOM, no fetch.
 */

export interface AddProjectAnswers {
  startKind: 'existing' | 'new' | null;
  projectName: string;
  path: string;
  devices: 'single' | 'multi' | null;
  data: 'local' | 'cloud' | null;
}

export function genPrompt(answers: AddProjectAnswers): string {
  const name = (answers.projectName || '').trim() || 'my-project';
  const isExisting = answers.startKind === 'existing';
  const isMulti = answers.devices === 'multi';
  const isCloud = answers.data === 'cloud';
  const path = (answers.path || '').trim();

  const L: string[] = [];
  L.push(`Help me set up a new local MeshKore project ("${name}").`);
  L.push('');
  L.push('MeshKore is my local-first multi-agent cockpit. The folder layout,');
  L.push('file schemas and conventions are documented at:');
  L.push('  · https://meshkore.com/standard         (human)');
  L.push('  · https://meshkore.com/standard.json    (machine-readable schema)');
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
  L.push('     .meshkore/{public,scripts,docs,log,timeline,credentials}');
  L.push('     .meshkore/modules/general/{tasks,log}');
  L.push('   chmod 700 .meshkore/credentials');
  L.push("   printf '7' > .meshkore/STANDARD_VERSION");
  L.push('');

  L.push("3. Write .gitignore at the repo root with the standard's");
  L.push('   two-line contract:');
  L.push('     .meshkore/*');
  L.push('     !.meshkore/public/');
  L.push('');

  L.push('4. Write .meshkore/public/cluster.yaml matching the `cluster_yaml`');
  L.push(`   schema. Required fields: version (=1), id (=${name}),`);
  L.push('   type (=dev), name, transport.endpoint (=ws://localhost:5570/events),');
  L.push('   modules (at least one entry {id: general, kind: area}). Add');
  L.push(`   storage.mode: ${isCloud ? 'remote' : 'local'}.`);
  L.push('   Standard v7 (§10.4) — also add a `daemon` block with');
  L.push('     daemon:');
  L.push('       auto_update: true');
  L.push('       auto_update_source: https://meshkore.com/reference/cluster/scripts/daemon.py');
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

  L.push('7. Download the local daemon (single Python stdlib file, ~600 lines —');
  L.push('   no pip install needed):');
  L.push('     curl -fsSL https://meshkore.com/reference/cluster/scripts/daemon.py \\');
  L.push('       -o .meshkore/scripts/daemon.py');
  L.push('');

  L.push('8. Start the daemon FULLY DETACHED so it survives terminal close');
  L.push("   and doesn't hold a prompt. Pipe stdout/stderr to a log file");
  L.push('   AND print a confirmation line at the end so the operator');
  L.push('   knows the daemon is up + what to do next:');
  L.push('     mkdir -p .meshkore/.runtime && \\');
  L.push('     nohup python3 .meshkore/scripts/daemon.py \\');
  L.push('       > .meshkore/.runtime/daemon.log 2>&1 & \\');
  L.push('     disown ; sleep 1 ; \\');
  L.push(
    "     echo '✓ MeshKore daemon launched. Open https://architect.meshkore.com — it will auto-detect this project. Logs: tail -f .meshkore/.runtime/daemon.log'",
  );
  L.push('   Plain `python3 ... &` is NOT enough — that one stays tied to the');
  L.push('   current shell and dies when the terminal closes.');
  L.push('');
  L.push('   If your security policy prevents you from running a long-lived');
  L.push('   downloaded script (most coding agents do refuse this — totally');
  L.push('   fine), just print me the exact command to paste in my own');
  L.push('   terminal, with the FULL absolute path, like this:');
  L.push('');
  L.push('     cd <absolute-folder-path> && \\');
  L.push('       mkdir -p .meshkore/.runtime && \\');
  L.push('       nohup python3 .meshkore/scripts/daemon.py \\');
  L.push('         > .meshkore/.runtime/daemon.log 2>&1 & \\');
  L.push('       disown ; sleep 1 ; \\');
  L.push(
    "       echo '✓ MeshKore daemon launched. Open https://architect.meshkore.com — it will auto-detect this project. Logs: tail -f .meshkore/.runtime/daemon.log'",
  );
  L.push('');
  L.push("   I'll run it myself. The echo prints the confirmation so I know");
  L.push('   exactly when to switch to the architect cockpit.');
  L.push('');
  L.push('My architect at https://architect.meshkore.com auto-detects the');
  L.push("daemon once it's up. Nothing else needed from us today.");

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
