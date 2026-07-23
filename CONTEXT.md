# Pi Workspace

Pi Workspace is a desktop application for navigating Pi sessions by the local directories they belong to.

## Language

**Pi Workspace**:
The desktop application that lets a user work across Workspaces, their Repositories, and their Sessions.

**Workspace**:
A persistent collection of related Repositories registered with Pi Workspace.

**Repository**:
A local Git repository registered with Pi Workspace. A Repository can belong to one or more Workspaces.
_Avoid_: Project

**Workstream**:
A persistent container for Sessions in a Workspace. A Brainstorm or Implement Workstream has a goal and retains Workstream Knowledge used to pursue it. A goal-less Workstream owns one Quick Session.

**Workstream Knowledge**:
The durable aggregate of structured records owned by a goal-based Workstream. It includes evidence, findings, decisions, assumptions, open questions, Repository impacts, plan steps, validation requirements, and execution progress. It is revised over time and can produce approved immutable Specification Versions.

**Knowledge Record**:
One durable structured record within Workstream Knowledge. Knowledge Records are the unit of evidence, reasoning, planning, validation, and execution progress retained by a Workstream.

**Specification Version**:
An approved immutable snapshot of the Workstream Knowledge records relevant to a specification at one point in its revision history. It is a versioned snapshot, not a second editable aggregate.

**Execution Progress**:
Knowledge Records describing implementation progress against plan steps. Execution Progress remains part of Workstream Knowledge after a Specification Version is approved; it is excluded from the source records of a Specification Version.

**Context**:
Transient presentation context or model input. It is not the domain term for durable Workstream Knowledge.

**Activity Layer**:
A retained technical persistence term for the internal Session activity-record format. It is not a domain term and does not name Workstream Knowledge; user-facing language uses Agent Activity and Activity Artifact.

**Default**:
The standard Pi Session mode used by a Quick Session. Default works directly in one selected Repository working location—either its current checkout or a dedicated worktree—with Pi’s normal tools and does not use Workspace-wide Repository routing.

**Quick Session**:
A low-friction, goal-less Session in Default mode. It belongs to its own Workstream and works directly in one selected Repository working location, which defaults to the current checkout and can instead be a dedicated worktree.

**Brainstorm**:
The Session mode for investigating every Repository in its Workspace, asking questions, recording structured knowledge, and producing an implementation-ready specification. Brainstorm uses Pi's normal tools across supplied Repository working paths and is instructed not to modify Repository content; this is methodology, not sandbox enforcement. User-installed Pi extensions remain trusted local code with their normal authority.
_Avoid_: Research Mode

**Implement**:
The Session mode for changing and validating Workspace Repositories with Pi's normal tools. It can inspect every current Workspace Repository checkout and lazily creates an isolated Implement Session Worktree before changing a Repository.
_Avoid_: Implementation Mode, Execution Mode

**Implement Session Worktree**:
An ordinary Git worktree owned by one Implement Session for one Repository. It is created only when that Session prepares to modify the Repository, starts from the Repository's current local `HEAD`, and is never shared with another Session.

**Session**:
A persistent Pi interaction associated with one Workstream. Each Session has an immutable mode and Repository access: direct access to one selected Repository working location for Default or automatic access to every current Workspace Repository for Brainstorm and Implement. Implement changes use that Session's lazily created Implement Session Worktrees.
_Avoid_: Chat, thread

**Changelog**:
The complete chronological collection shown by the Changelog page.

**Release Note**:
The entry describing one released version of Pi Workspace.

**Latest Release Note**:
The newest bundled Release Note, which must match the current application version.

**Agent Run**:
The user-facing work cycle that begins when an idle Session accepts a user submission and ends when Pi settles.

**Agent Activity**:
One user-understandable outcome within an Agent Run.

**Tool Execution**:
The normalized record of one ordinary Pi tool call assigned to an Agent Activity.

**Activity Artifact**:
A structured, user-facing summary derived from a Tool Execution and owned by an Agent Activity.
