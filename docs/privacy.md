# Privacy, data handling, and agent authority

Pi Workspace is a local desktop client for Pi. It has no Pi Workspace account service or hosted data store. Using a
Session is not offline, however: prompts and context are sent to the model provider selected through Pi, and the Agent
can use tools on the local machine.

## Data stored locally

### Pi Workspace application data

Pi Workspace stores application authority and its owned Session history in Electron's per-user application-data
directory, returned by `app.getPath('userData')`:

- `settings.json` contains the appearance preference.
- `application-state.json` identifies the current application-state generation.
- `application-state.sqlite` contains Workspaces, registered Repository paths, memberships, Workstreams, Session
  ownership and access state, and structured Workstream knowledge.
- `application-state-*.sqlite` files are backups created before an application-state reset or through the recovery UI.
- `sessions/*.jsonl` files contain the app-owned Pi Session histories.
- `session-quarantine/*.jsonl` retains conflicting Session files that Pi Workspace will not adopt as an owned Session.
- `session-cwd/` is the app-owned working directory recorded by managed Session files. A Quick Session instead runs
  directly in its selected Repository's current checkout or dedicated worktree.

The exact application-data path is platform-dependent. On supported Debian systems it is normally below the user's
`~/.config/` directory; on macOS it is normally `~/Library/Application Support/Pi Workspace`. Pi Workspace creates or
corrects private application-data directories to mode `0700` and authority, settings, backup, and owned Session files
to mode `0600`. These POSIX modes restrict access from other users but do not encrypt the data or protect it from the
same operating-system account, administrators, backups, malware, or a compromised machine.

Pi Workspace does not copy complete Repository checkouts into its application-data directory. Session history and
structured Workstream knowledge can still contain file contents, paths, commands, tool results, and other Repository data
that entered the Agent conversation or activity record.

### Pi configuration and credentials

Pi Workspace embeds the `@earendil-works/pi-coding-agent` SDK and uses Pi's normal configuration and credential
resolution:

- The default Pi directory is `~/.pi/agent/`, or `PI_CODING_AGENT_DIR` when set.
- Credentials are read from Pi's `auth.json` or provider-specific environment variables. Pi creates `auth.json` with
  mode `0600`.
- Global Pi settings and custom model definitions are read from `settings.json` and `models.json` in the Pi directory.
- Pi Workspace supplies its own app-owned JSONL path when opening a Session; these owned Session files are not stored
  in Pi's default Session directory.

A Session can contain prompts, assistant responses and reasoning, provider and model identifiers, token and cost
metadata, tool calls, tool input and output, command output, errors, summaries, timestamps, absolute paths, and Pi
Workspace Agent Activity metadata. Session history is append-only and tree-shaped; compacting the model context does
not remove earlier records from the Session file.

User-level Pi resources remain available in every Session. Managed Brainstorm and Implement Sessions also aggregate
conventional instruction, extension, skill, prompt-template, and theme paths from every current Workspace Repository.
Because a Workspace can contain multiple Repositories, Pi Workspace does not merge conflicting Repository-local
`.pi/settings.json` files; managed Sessions use global settings plus settings from their app-owned working directory.
Pi Workspace does not currently present Pi's interactive project-trust prompt for these paths. Treat Workspace
membership as trusting each Repository's local Pi resources. Third-party extensions and packages run with the user's
normal local authority and can store data, access files, execute commands, or make network requests independently of
Pi Workspace.

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
and regional-processing terms. Pi Workspace cannot delete provider-side copies. Review those terms and do not submit a
secret unless the chosen provider and account are approved to receive it.

Pi Workspace does not automatically publish Sessions and does not expose Pi's `/share` command. Sharing a Session with
a separate tool is an explicit user action. Installed Pi extensions and packages can make their own network requests,
so review their source and configuration before use.

## Credentials

Pi Workspace does not provide a login flow or store model-provider credentials in its application-state database or
`settings.json`. The embedded Pi SDK resolves credentials from Pi's `auth.json`, provider-specific environment
variables, and other provider mechanisms documented by Pi. The Electron main process inherits the launch environment.

Credentials are available to the process components that need to authenticate provider requests. They can also be
reachable by code or commands running with the same user authority. Do not install an untrusted Pi extension or
package, and do not ask the Agent to print credential files or environment variables.

## Agent and filesystem authority

A Workspace or Workstream is an application routing boundary, not an operating-system sandbox:

- A **Quick Session** in Default mode works directly in its selected Repository's current checkout or dedicated
  worktree with Pi's normal tools.
- A **Brainstorm Session** receives every current Workspace Repository working path and Pi's normal tools. Its system
  prompt instructs the Agent not to modify Repository content, but this is methodology rather than sandbox enforcement.
- An **Implement Session** receives the same Workspace Repository working paths and may use Pi's normal tools to change
  and validate Repository content.
- Managed Sessions expose Workspace metadata and structured Workstream knowledge through Pi Workspace-owned tools. They do
  not add Repository approval prompts or per-operation confirmations before normal Pi tool use.

User-installed extensions remain trusted local code with their normal authority. Their tools and lifecycle hooks are
not confined by Brainstorm mode, Workspace membership, Repository routing, or managed worktrees. An extension can
inspect, create, change, or delete files and run programs with the permissions of the user who launched Pi Workspace.
Only install extensions and packages whose authority is appropriate for the Workspace.

Review prompts and Agent operations as carefully as shell commands. Use an operating-system account, container,
virtual machine, filesystem permissions, and network controls appropriate to the sensitivity of the work. Pi Workspace
does not currently provide per-command approval, repository-only filesystem confinement, process isolation, or network
isolation for the Agent.

Electron's renderer is separately sandboxed with context isolation, no Node integration, restricted navigation, and a
narrow validated IPC bridge. This protects the privileged main process from renderer content; it does **not** sandbox
the Pi Agent or its tools.

## Logging and telemetry

Pi Workspace does not add analytics, usage telemetry, advertising identifiers, or a crash-reporting service. It logs
operational failures to the process console and does not intentionally create a separate application log file. The
operating system, desktop launcher, terminal, or packaging environment may capture console output.

Pi's interactive terminal mode documents update checks and an install/update version ping, but Pi Workspace embeds the
SDK directly and does not start that interactive mode. Pi's `enableInstallTelemetry` setting can still control optional
Pi attribution headers on requests to OpenRouter, Cloudflare, and direct NVIDIA NIM providers; set `PI_TELEMETRY=0` or
disable that setting in Pi's global `settings.json` to omit them. Provider requests still occur for Agent Runs. Pi
resources, extensions, provider SDKs, and external commands may have their own logging or telemetry behavior.

Tool input and output shown in the interface are also persisted in the owned Session file and should not be treated as
transient console output.

## Retention and deletion

Data remains until the user or another local process removes it:

- Back up and then delete Pi Workspace's Electron user-data directory to remove its settings, application authority,
  structured Workstream knowledge, backups, and app-owned Session histories. Pi Workspace currently has no UI for deleting
  an individual Workspace, Workstream, or Session.
- Use Pi's authentication tooling or remove the relevant entry from Pi's `auth.json` to remove a locally stored provider
  credential.
- Remove unwanted Repository-local or user-level Pi resources and any data created by extensions or packages
  separately.

Deleting Pi Workspace data does not undo Repository files changed by the Agent or delete shell history, operating-system
backups, provider-side records, Pi credentials, or data stored by third-party tools. Deleting a Repository does not
delete the copies of its content already recorded in Session or Workstream knowledge. Secure deletion and backup expiry
depend on the operating system and storage environment.
