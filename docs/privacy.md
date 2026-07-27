# Privacy, data handling, and agent authority

Railyard is a local desktop client for Pi. It has no Railyard account service or hosted data store. Using a
Session is not offline, however: prompts and context are sent to the model provider selected through Pi, and the Agent
can use tools on the local machine.

## Data stored locally

### Railyard application data

Railyard stores application authority and its owned Session history in Electron's per-user application-data
directory, returned by `app.getPath('userData')`:

- `settings.json` contains the appearance preference.
- `application-state.json` identifies the current application-state generation.
- `application-state.sqlite` contains Workspaces, registered Repository paths, memberships, Workstreams, Session
  ownership and access state, and legacy structured Workstream records retained for compatibility.
- `application-state-*.sqlite` files are backups created before an application-state reset or through the recovery UI.
- `sessions/*.jsonl` files contain the app-owned Pi Session histories.
- `session-quarantine/*.jsonl` retains conflicting Session files that Railyard will not adopt as an owned Session.
- `session-cwd/` is the app-owned working directory recorded by Workstream Session files. A Quick Session instead
  runs directly in its selected Repository's current checkout or dedicated worktree.

The exact application-data path is platform-dependent. On supported Debian systems it is normally
`~/.config/Railyard`; on macOS it is normally `~/Library/Application Support/Railyard`. Railyard creates or corrects
private application-data directories to mode `0700` and authority, settings, backup, and owned Session files to mode
`0600`. These POSIX modes restrict access from other users but do not encrypt the data or protect it from the same
operating-system account, administrators, backups, malware, or a compromised machine.

On first launch, Railyard copies legacy Pi Workspace application data into the Railyard directory only when no
Railyard directory already exists. It updates app-owned Session and database paths in the copy, never merges two
non-empty application-data directories, and leaves the legacy directory in place. Keep the legacy directory until you
have confirmed that the copied Workspaces and Sessions open correctly.

Railyard does not copy complete Repository checkouts into its application-data directory. Session history and
legacy structured Workstream records can still contain file contents, paths, commands, tool results, and other Repository data
that entered the Agent conversation or activity record.

### Pi configuration and credentials

Railyard embeds the `@earendil-works/pi-coding-agent` SDK and uses Pi's normal configuration and credential
resolution:

- The default Pi directory is `~/.pi/agent/`, or `PI_CODING_AGENT_DIR` when set.
- Credentials are read from Pi's `auth.json` or provider-specific environment variables. Pi creates `auth.json` with
  mode `0600`.
- Global Pi settings and custom model definitions are read from `settings.json` and `models.json` in the Pi directory.
- Railyard supplies its own app-owned JSONL path when opening a Session; these owned Session files are not stored
  in Pi's default Session directory.

A Session can contain prompts, assistant responses and reasoning, provider and model identifiers, token and cost
metadata, tool calls, tool input and output, command output, errors, summaries, timestamps, absolute paths, and Pi
Workspace Agent Activity metadata. Session history is append-only and tree-shaped; compacting the model context does
not remove earlier records from the Session file.

User-level Pi resources remain available in every Session. Workstream Sessions also aggregate conventional
instruction, extension, skill, prompt-template, and theme paths from the Repositories selected for that Workstream.
Because a Workstream can contain multiple Repositories, Railyard does not merge conflicting Repository-local
`.pi/settings.json` files; Workstream Sessions use global settings plus settings from their app-owned working directory.
Railyard does not currently present Pi's interactive project-trust prompt for these paths. Treat Workspace
membership as trusting each Repository's local Pi resources. Third-party extensions and packages run with the user's
normal local authority and can store data, access files, execute commands, or make network requests independently of
Railyard.

## Data sent over the network

When a message is submitted, Pi sends the configured model provider the material needed for the Agent Run. Depending
on the Session and what the Agent does, this can include:

- the system prompt and discovered Repository instructions;
- conversation messages and compacted or branch summaries;
- the user's prompt;
- relevant tool definitions, tool calls, and tool results;
- file contents, command output, errors, or other local data returned by tools; and
- provider, model, and request configuration metadata.

The model provider receives this data under the provider account and the provider's own privacy, retention, training,
and regional-processing terms. Railyard cannot delete provider-side copies. Review those terms and do not submit a
secret unless the chosen provider and account are approved to receive it.

Railyard does not automatically publish Sessions and does not expose Pi's `/share` command. Sharing a Session with
a separate tool is an explicit user action. Installed Pi extensions and packages can make their own network requests,
so review their source and configuration before use.

## Credentials

Railyard does not provide a login flow or store model-provider credentials in its application-state database or
`settings.json`. The embedded Pi SDK resolves credentials from Pi's `auth.json`, provider-specific environment
variables, and other provider mechanisms documented by Pi. The Electron main process inherits the launch environment.

Credentials are available to the process components that need to authenticate provider requests. They can also be
reachable by code or commands running with the same user authority. Do not install an untrusted Pi extension or
package, and do not ask the Agent to print credential files or environment variables.

## Agent and filesystem authority

A Workspace or Workstream is an application routing boundary, not an operating-system sandbox:

- A **Quick Session** works directly in its selected Repository's current checkout or dedicated worktree with Pi's
  normal tools.
- A **Workstream Session** receives the Workstream goal plus the selected Repositories' names, working locations,
  roles, relationships, validation commands, and related metadata in its system prompt. It can inspect and modify
  those Repository checkouts with Pi's normal tools.
- A user can explicitly create a dedicated worktree for one Session and Repository from the Repository's current local
  `HEAD`; subsequent Agent changes for that Repository are routed there. This routing is instructed rather than
  filesystem-enforced.
- Workstream Sessions expose current Repository metadata and selected working locations through Railyard-owned tools.
  They do not add Repository approval prompts or per-operation confirmations before normal Pi tool use.

User-installed extensions remain trusted local code with their normal authority. Their tools and lifecycle hooks are
not confined by Workspace membership, Workstream Repository selection, Repository routing, or Session worktrees. An extension can
inspect, create, change, or delete files and run programs with the permissions of the user who launched Railyard.
Only install extensions and packages whose authority is appropriate for the Workspace.

Review prompts and Agent operations as carefully as shell commands. Use an operating-system account, container,
virtual machine, filesystem permissions, and network controls appropriate to the sensitivity of the work. Railyard
does not currently provide per-command approval, repository-only filesystem confinement, process isolation, or network
isolation for the Agent.

Electron's renderer is separately sandboxed with context isolation, no Node integration, restricted navigation, and a
narrow validated IPC bridge. This protects the privileged main process from renderer content; it does **not** sandbox
the Pi Agent or its tools.

## Logging and telemetry

Railyard does not add analytics, usage telemetry, advertising identifiers, or a crash-reporting service. It logs
operational failures to the process console and does not intentionally create a separate application log file. The
operating system, desktop launcher, terminal, or packaging environment may capture console output.

Pi's interactive terminal mode documents update checks and an install/update version ping, but Railyard embeds the
SDK directly and does not start that interactive mode. Pi's `enableInstallTelemetry` setting can still control optional
Pi attribution headers on requests to OpenRouter, Cloudflare, and direct NVIDIA NIM providers; set `PI_TELEMETRY=0` or
disable that setting in Pi's global `settings.json` to omit them. Provider requests still occur for Agent Runs. Pi
resources, extensions, provider SDKs, and external commands may have their own logging or telemetry behavior.

Tool input and output shown in the interface are also persisted in the owned Session file and should not be treated as
transient console output.

## Retention and deletion

Data remains until the user or another local process removes it:

- Back up and then delete Railyard's Electron user-data directory to remove its settings, application authority,
  legacy structured Workstream records, backups, and app-owned Session histories. If Railyard copied legacy Pi Workspace
  data, delete that legacy directory separately after confirming the copied data. Railyard currently has no UI for
  deleting an individual Workspace, Workstream, or Session.
- Use Pi's authentication tooling or remove the relevant entry from Pi's `auth.json` to remove a locally stored provider
  credential.
- Remove unwanted Repository-local or user-level Pi resources and any data created by extensions or packages
  separately.

Deleting Railyard data does not undo Repository files changed by the Agent or delete shell history, operating-system
backups, provider-side records, Pi credentials, or data stored by third-party tools. Deleting a Repository does not
delete the copies of its content already recorded in Session or Workstream knowledge. Secure deletion and backup expiry
depend on the operating system and storage environment.
