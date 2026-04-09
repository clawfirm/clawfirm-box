----------------------------- MODULE BOX_DEPLOY_RECONCILE_WORKFLOW_STATE -----------------------------
EXTENDS Naturals, TLC

(***************************************************************************
Box deploy + reconcile workflow model

Goal:
Model a typical agentic deploy flow that chains publish, optional promotion,
reconcile, and external verification.

Focus:
- publish and reconcile are separate steps
- verification only happens after runtime reconciliation
- failures leave the workflow resumable instead of silently succeeding
***************************************************************************)

CONSTANTS Domains, Releases

VARIABLES
  workflowState,
  stagedRelease,
  liveRelease,
  runtimeReady,
  verificationState,
  lastOutcome

Vars == << workflowState, stagedRelease, liveRelease, runtimeReady, verificationState, lastOutcome >>

NoRelease == "NORELEASE"

TypeInvariant ==
  /\ workflowState \in [Domains -> {"idle", "publishing", "staged", "activating", "reconciling", "verifying", "done", "failed"}]
  /\ stagedRelease \in [Domains -> Releases \cup {NoRelease}]
  /\ liveRelease \in [Domains -> Releases \cup {NoRelease}]
  /\ runtimeReady \in [Domains -> BOOLEAN]
  /\ verificationState \in [Domains -> {"none", "pending", "passed", "failed"}]
  /\ lastOutcome \in [Domains -> {"none", "published", "activated", "reconciled", "verified", "failed"}]

Init ==
  /\ workflowState = [d \in Domains |-> "idle"]
  /\ stagedRelease = [d \in Domains |-> NoRelease]
  /\ liveRelease = [d \in Domains |-> NoRelease]
  /\ runtimeReady = [d \in Domains |-> FALSE]
  /\ verificationState = [d \in Domains |-> "none"]
  /\ lastOutcome = [d \in Domains |-> "none"]

StartPublish(d) ==
  /\ workflowState[d] = "idle"
  /\ workflowState' = [workflowState EXCEPT ![d] = "publishing"]
  /\ verificationState' = [verificationState EXCEPT ![d] = "none"]
  /\ runtimeReady' = [runtimeReady EXCEPT ![d] = FALSE]
  /\ UNCHANGED << stagedRelease, liveRelease, lastOutcome >>

PublishStaged(d, r) ==
  /\ workflowState[d] = "publishing"
  /\ r \in Releases
  /\ stagedRelease' = [stagedRelease EXCEPT ![d] = r]
  /\ workflowState' = [workflowState EXCEPT ![d] = "staged"]
  /\ lastOutcome' = [lastOutcome EXCEPT ![d] = "published"]
  /\ UNCHANGED << liveRelease, runtimeReady, verificationState >>

ActivateStaged(d) ==
  /\ workflowState[d] = "staged"
  /\ stagedRelease[d] # NoRelease
  /\ workflowState' = [workflowState EXCEPT ![d] = "activating"]
  /\ UNCHANGED << stagedRelease, liveRelease, runtimeReady, verificationState, lastOutcome >>

ActivationDone(d) ==
  /\ workflowState[d] = "activating"
  /\ stagedRelease[d] # NoRelease
  /\ liveRelease' = [liveRelease EXCEPT ![d] = stagedRelease[d]]
  /\ workflowState' = [workflowState EXCEPT ![d] = "reconciling"]
  /\ lastOutcome' = [lastOutcome EXCEPT ![d] = "activated"]
  /\ verificationState' = [verificationState EXCEPT ![d] = "pending"]
  /\ UNCHANGED << stagedRelease, runtimeReady >>

ReconcileSuccess(d) ==
  /\ workflowState[d] = "reconciling"
  /\ liveRelease[d] # NoRelease
  /\ runtimeReady' = [runtimeReady EXCEPT ![d] = TRUE]
  /\ workflowState' = [workflowState EXCEPT ![d] = "verifying"]
  /\ lastOutcome' = [lastOutcome EXCEPT ![d] = "reconciled"]
  /\ UNCHANGED << stagedRelease, liveRelease, verificationState >>

VerifySuccess(d) ==
  /\ workflowState[d] = "verifying"
  /\ runtimeReady[d] = TRUE
  /\ verificationState' = [verificationState EXCEPT ![d] = "passed"]
  /\ workflowState' = [workflowState EXCEPT ![d] = "done"]
  /\ lastOutcome' = [lastOutcome EXCEPT ![d] = "verified"]
  /\ UNCHANGED << stagedRelease, liveRelease, runtimeReady >>

StepFailure(d) ==
  /\ workflowState[d] \in {"publishing", "activating", "reconciling", "verifying"}
  /\ workflowState' = [workflowState EXCEPT ![d] = "failed"]
  /\ verificationState' = [verificationState EXCEPT ![d] = IF workflowState[d] = "verifying" THEN "failed" ELSE verificationState[d]]
  /\ lastOutcome' = [lastOutcome EXCEPT ![d] = "failed"]
  /\ UNCHANGED << stagedRelease, liveRelease, runtimeReady >>

ResumeAfterFailure(d) ==
  /\ workflowState[d] = "failed"
  /\ liveRelease[d] # NoRelease
  /\ workflowState' = [workflowState EXCEPT ![d] = "reconciling"]
  /\ verificationState' = [verificationState EXCEPT ![d] = "pending"]
  /\ UNCHANGED << stagedRelease, liveRelease, runtimeReady, lastOutcome >>

Next ==
  \E d \in Domains, r \in Releases :
      StartPublish(d)
   \/ PublishStaged(d, r)
   \/ ActivateStaged(d)
   \/ ActivationDone(d)
   \/ ReconcileSuccess(d)
   \/ VerifySuccess(d)
   \/ StepFailure(d)
   \/ ResumeAfterFailure(d)

Inv_DoneRequiresRuntimeReady ==
  \A d \in Domains : workflowState[d] = "done" =>
    /\ runtimeReady[d] = TRUE
    /\ verificationState[d] = "passed"
    /\ liveRelease[d] # NoRelease

Inv_VerificationOnlyAfterReconcile ==
  \A d \in Domains : workflowState[d] = "verifying" => runtimeReady[d] = TRUE

Inv_NoSilentSuccess ==
  \A d \in Domains : lastOutcome[d] = "verified" => workflowState[d] = "done"

Spec == Init /\ [][Next]_Vars

=============================================================================
