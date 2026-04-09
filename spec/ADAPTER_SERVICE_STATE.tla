----------------------------- MODULE ADAPTER_SERVICE_STATE -----------------------------
EXTENDS Naturals, FiniteSets, TLC

(***************************************************************************
Adapter service model

Goal:
Model the internal adapter's publish/list/rollback service guarantees.

This expanded model separates:
- release creation and staging
- explicit activation of a staged release into current serving
- rollback/promotion as serving-pointer changes over existing releases
***************************************************************************)

CONSTANTS Domains, Releases

VARIABLES releaseHistory, stagedReleases, currentRelease, requestState

Vars == << releaseHistory, stagedReleases, currentRelease, requestState >>

NoRelease == "NORELEASE"

TypeInvariant ==
  /\ releaseHistory \in [Domains -> SUBSET Releases]
  /\ stagedReleases \in [Domains -> SUBSET Releases]
  /\ currentRelease \in [Domains -> Releases \cup {NoRelease}]
  /\ requestState \in [Domains -> {"idle", "publishing", "activating", "rolling_back", "failed"}]

Init ==
  /\ releaseHistory = [d \in Domains |-> {}]
  /\ stagedReleases = [d \in Domains |-> {}]
  /\ currentRelease = [d \in Domains |-> NoRelease]
  /\ requestState = [d \in Domains |-> "idle"]

RequestPublish(d) ==
  /\ requestState[d] = "idle"
  /\ requestState' = [requestState EXCEPT ![d] = "publishing"]
  /\ UNCHANGED << releaseHistory, stagedReleases, currentRelease >>

PublishSuccess(d, r) ==
  /\ requestState[d] = "publishing"
  /\ r \in Releases
  /\ r \notin releaseHistory[d]
  /\ releaseHistory' = [releaseHistory EXCEPT ![d] = @ \cup {r}]
  /\ stagedReleases' = [stagedReleases EXCEPT ![d] = @ \cup {r}]
  /\ currentRelease' = currentRelease
  /\ requestState' = [requestState EXCEPT ![d] = "idle"]

PublishFailure(d) ==
  /\ requestState[d] = "publishing"
  /\ requestState' = [requestState EXCEPT ![d] = "failed"]
  /\ UNCHANGED << releaseHistory, stagedReleases, currentRelease >>

RequestPromote(d) ==
  /\ requestState[d] = "idle"
  /\ stagedReleases[d] # {}
  /\ requestState' = [requestState EXCEPT ![d] = "activating"]
  /\ UNCHANGED << releaseHistory, stagedReleases, currentRelease >>

PromoteSuccess(d, r) ==
  /\ requestState[d] = "activating"
  /\ r \in stagedReleases[d]
  /\ stagedReleases' = [stagedReleases EXCEPT ![d] = (@ \ {r}) \cup IF currentRelease[d] = NoRelease THEN {} ELSE {currentRelease[d]}]
  /\ currentRelease' = [currentRelease EXCEPT ![d] = r]
  /\ requestState' = [requestState EXCEPT ![d] = "idle"]
  /\ UNCHANGED releaseHistory

PromoteFailure(d) ==
  /\ requestState[d] = "activating"
  /\ requestState' = [requestState EXCEPT ![d] = "failed"]
  /\ UNCHANGED << releaseHistory, stagedReleases, currentRelease >>

RequestRollback(d) ==
  /\ requestState[d] = "idle"
  /\ currentRelease[d] # NoRelease
  /\ requestState' = [requestState EXCEPT ![d] = "rolling_back"]
  /\ UNCHANGED << releaseHistory, stagedReleases, currentRelease >>

RollbackSuccess(d, r) ==
  /\ requestState[d] = "rolling_back"
  /\ r \in releaseHistory[d]
  /\ r # currentRelease[d]
  /\ stagedReleases' = [stagedReleases EXCEPT ![d] = (@ \ {r}) \cup {currentRelease[d]}]
  /\ currentRelease' = [currentRelease EXCEPT ![d] = r]
  /\ requestState' = [requestState EXCEPT ![d] = "idle"]
  /\ UNCHANGED releaseHistory

RollbackFailure(d) ==
  /\ requestState[d] = "rolling_back"
  /\ requestState' = [requestState EXCEPT ![d] = "failed"]
  /\ UNCHANGED << releaseHistory, stagedReleases, currentRelease >>

RecoverFailure(d) ==
  /\ requestState[d] = "failed"
  /\ requestState' = [requestState EXCEPT ![d] = "idle"]
  /\ UNCHANGED << releaseHistory, stagedReleases, currentRelease >>

Next ==
  \E d \in Domains, r \in Releases :
      RequestPublish(d)
   \/ PublishSuccess(d, r)
   \/ PublishFailure(d)
   \/ RequestPromote(d)
   \/ PromoteSuccess(d, r)
   \/ PromoteFailure(d)
   \/ RequestRollback(d)
   \/ RollbackSuccess(d, r)
   \/ RollbackFailure(d)
   \/ RecoverFailure(d)

Inv_CurrentReleaseMustExist ==
  \A d \in Domains : currentRelease[d] # NoRelease => currentRelease[d] \in releaseHistory[d]

Inv_StagedReleasesMustExist ==
  \A d \in Domains : stagedReleases[d] \subseteq releaseHistory[d]

Inv_CurrentReleaseNotStaged ==
  \A d \in Domains : currentRelease[d] # NoRelease => currentRelease[d] \notin stagedReleases[d]

Inv_NoConcurrentMutation ==
  \A d \in Domains : requestState[d] \in {"publishing", "activating", "rolling_back"} => requestState[d] # "idle"

Spec == Init /\ [][Next]_Vars

=============================================================================
