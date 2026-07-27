# Railyard

Railyard is a desktop application for navigating Pi sessions by the local directories they belong to.

## Language

**Railyard**:
The desktop application that lets a user work across Workspaces, their Repositories, and their Sessions.

**Workspace**:
A persistent collection of related Repositories registered with Railyard.

**Repository**:
A local Git repository registered with Railyard. A Repository can belong to one or more Workspaces.
_Avoid_: Project

**Workstream**:
A persistent, goal-oriented container for multiple Sessions in a Workspace. A Workstream selects one or more Repositories; their names, working locations, roles, relationships, validation commands, and other routing metadata become context for every Session in the Workstream.

**Context**:
Repository metadata, paths, instructions, conversation history, and other transient model input supplied to a Session.

**Activity Layer**:
A retained technical persistence term for the internal Session activity-record format. It is not a domain term; user-facing language uses Agent Activity and Activity Artifact.

**Quick Session**:
A low-friction, goal-less Session that works directly in one selected Repository working location. It defaults to the current checkout and can instead use a dedicated worktree.

**Session Worktree**:
An ordinary Git worktree explicitly created by a user for one Session and one Repository. It starts from the Repository's current local `HEAD` and is never shared with another Session.

**Session**:
A persistent Pi interaction associated with one Workstream. A Workstream Session receives the Workstream goal and selected Repository context, uses current checkouts by default, and can use a user-created Session Worktree for an individual Repository. Sessions do not have modes.
_Avoid_: Chat, thread

**Session Fork**:
A new Session whose history is copied through the response before one selected user message from a source Session. The selected message becomes an editable draft, the source remains unchanged, and Repository state is not rewound. A Workstream Session Fork remains in its Workstream. A Quick Session Fork owns a new internal goal-less container and preserves the source working-location policy without sharing a dedicated worktree.

**Session Description**:
One or two concise, agent-authored sentences that summarize a Session's current focus for navigation. Pi can revise it as the focus materially changes.

**Changelog**:
The complete chronological collection shown by the Changelog page.

**Release Note**:
The entry describing one released version of Railyard.

**Latest Release Note**:
The newest bundled Release Note, which must match the current application version.

**Agent Run**:
The user-facing work cycle that begins when an idle Session accepts a user submission and ends when Pi settles.

**Queued Follow-up**:
A durable user message held for a working Session after its current Agent Run. Live Queued Follow-ups begin automatically when Pi settles. Queued Follow-ups restored after an application restart remain visible, removable, and paused until the user resumes them.

**Agent Activity**:
One user-understandable outcome within an Agent Run.

**Tool Execution**:
The normalized record of one ordinary Pi tool call assigned to an Agent Activity.

**Activity Artifact**:
A structured, user-facing summary derived from a Tool Execution and owned by an Agent Activity.
