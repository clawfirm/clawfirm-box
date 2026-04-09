----------------------------- MODULE ADAPTER_PUBLISH_API_STATE -----------------------------
EXTENDS Naturals, FiniteSets, TLC

(***************************************************************************
Adapter publish API model

Goal:
Model the adapter-side publish contract for website release ingress.

Focus:
- publish requires authorization before artifact ingress is accepted
- ingress may be direct file-bundle or zip archive
- adapter normalizes either ingress mode before validation
- release creation only happens from a validated normalized artifact
- publish creates a staged release by default and does not switch serving
- explicit activation is required before a staged release becomes current
- once a release becomes current, it must exist in release history
***************************************************************************)

CONSTANTS Domains, Releases

VARIABLES
  requestState,
  ingressMode,
  authState,
  indexState,
  releaseHistory,
  stagedReleases,
  currentRelease,
  lastResult

Vars == << requestState, ingressMode, authState, indexState, releaseHistory, stagedReleases, currentRelease, lastResult >>

NoRelease == "NORELEASE"
NoIngress == "NOINGRESS"

TypeInvariant ==
  /\ requestState \in [Domains -> {"idle", "authorized", "received", "normalized", "validated", "failed"}]
  /\ ingressMode \in [Domains -> {NoIngress, "direct_files", "zip_archive"}]
  /\ authState \in [Domains -> {"none", "authorized", "denied"}]
  /\ indexState \in [Domains -> {"unknown", "present", "missing"}]
  /\ releaseHistory \in [Domains -> SUBSET Releases]
  /\ stagedReleases \in [Domains -> SUBSET Releases]
  /\ currentRelease \in [Domains -> Releases \cup {NoRelease}]
  /\ lastResult \in [Domains -> {"none", "ok", "staged", "activated", "unauthorized", "missing_index", "invalid_artifact", "publish_failed", "activation_failed"}]

Init ==
  /\ requestState = [d \in Domains |-> "idle"]
  /\ ingressMode = [d \in Domains |-> NoIngress]
  /\ authState = [d \in Domains |-> "none"]
  /\ indexState = [d \in Domains |-> "unknown"]
  /\ releaseHistory = [d \in Domains |-> {}]
  /\ stagedReleases = [d \in Domains |-> {}]
  /\ currentRelease = [d \in Domains |-> NoRelease]
  /\ lastResult = [d \in Domains |-> "none"]

AuthorizePublish(d) ==
  /\ requestState[d] = "idle"
  /\ authState[d] = "none"
  /\ requestState' = [requestState EXCEPT ![d] = "authorized"]
  /\ authState' = [authState EXCEPT ![d] = "authorized"]
  /\ lastResult' = [lastResult EXCEPT ![d] = "ok"]
  /\ UNCHANGED << ingressMode, indexState, releaseHistory, stagedReleases, currentRelease >>

DenyPublish(d) ==
  /\ requestState[d] = "idle"
  /\ authState[d] = "none"
  /\ requestState' = [requestState EXCEPT ![d] = "failed"]
  /\ authState' = [authState EXCEPT ![d] = "denied"]
  /\ lastResult' = [lastResult EXCEPT ![d] = "unauthorized"]
  /\ UNCHANGED << ingressMode, indexState, releaseHistory, stagedReleases, currentRelease >>

ReceiveDirectFiles(d, hasIndex) ==
  /\ requestState[d] = "authorized"
  /\ authState[d] = "authorized"
  /\ hasIndex \in BOOLEAN
  /\ requestState' = [requestState EXCEPT ![d] = "received"]
  /\ ingressMode' = [ingressMode EXCEPT ![d] = "direct_files"]
  /\ indexState' = [indexState EXCEPT ![d] = IF hasIndex THEN "present" ELSE "missing"]
  /\ lastResult' = [lastResult EXCEPT ![d] = "ok"]
  /\ UNCHANGED << authState, releaseHistory, stagedReleases, currentRelease >>

ReceiveZipArchive(d, hasIndex) ==
  /\ requestState[d] = "authorized"
  /\ authState[d] = "authorized"
  /\ hasIndex \in BOOLEAN
  /\ requestState' = [requestState EXCEPT ![d] = "received"]
  /\ ingressMode' = [ingressMode EXCEPT ![d] = "zip_archive"]
  /\ indexState' = [indexState EXCEPT ![d] = IF hasIndex THEN "present" ELSE "missing"]
  /\ lastResult' = [lastResult EXCEPT ![d] = "ok"]
  /\ UNCHANGED << authState, releaseHistory, stagedReleases, currentRelease >>

NormalizeIngress(d) ==
  /\ requestState[d] = "received"
  /\ ingressMode[d] \in {"direct_files", "zip_archive"}
  /\ requestState' = [requestState EXCEPT ![d] = "normalized"]
  /\ lastResult' = [lastResult EXCEPT ![d] = "ok"]
  /\ UNCHANGED << ingressMode, authState, indexState, releaseHistory, stagedReleases, currentRelease >>

ValidateNormalizedArtifact(d) ==
  /\ requestState[d] = "normalized"
  /\ ingressMode[d] \in {"direct_files", "zip_archive"}
  /\ indexState[d] = "present"
  /\ requestState' = [requestState EXCEPT ![d] = "validated"]
  /\ lastResult' = [lastResult EXCEPT ![d] = "ok"]
  /\ UNCHANGED << ingressMode, authState, indexState, releaseHistory, stagedReleases, currentRelease >>

RejectMissingIndex(d) ==
  /\ requestState[d] \in {"received", "normalized"}
  /\ indexState[d] = "missing"
  /\ requestState' = [requestState EXCEPT ![d] = "failed"]
  /\ lastResult' = [lastResult EXCEPT ![d] = "missing_index"]
  /\ UNCHANGED << ingressMode, authState, indexState, releaseHistory, stagedReleases, currentRelease >>

RejectInvalidArtifact(d) ==
  /\ requestState[d] \in {"received", "normalized"}
  /\ ingressMode[d] \in {"direct_files", "zip_archive"}
  /\ requestState' = [requestState EXCEPT ![d] = "failed"]
  /\ lastResult' = [lastResult EXCEPT ![d] = "invalid_artifact"]
  /\ UNCHANGED << ingressMode, authState, indexState, releaseHistory, stagedReleases, currentRelease >>

CreateStagedRelease(d, r) ==
  /\ requestState[d] = "validated"
  /\ r \in Releases
  /\ r \notin releaseHistory[d]
  /\ releaseHistory' = [releaseHistory EXCEPT ![d] = @ \cup {r}]
  /\ stagedReleases' = [stagedReleases EXCEPT ![d] = @ \cup {r}]
  /\ currentRelease' = currentRelease
  /\ requestState' = [requestState EXCEPT ![d] = "idle"]
  /\ ingressMode' = [ingressMode EXCEPT ![d] = NoIngress]
  /\ authState' = [authState EXCEPT ![d] = "none"]
  /\ indexState' = [indexState EXCEPT ![d] = "unknown"]
  /\ lastResult' = [lastResult EXCEPT ![d] = "staged"]

ActivateRelease(d, r) ==
  /\ requestState[d] = "idle"
  /\ r \in stagedReleases[d]
  /\ stagedReleases' = [stagedReleases EXCEPT ![d] = (@ \ {r}) \cup IF currentRelease[d] = NoRelease THEN {} ELSE {currentRelease[d]}]
  /\ currentRelease' = [currentRelease EXCEPT ![d] = r]
  /\ lastResult' = [lastResult EXCEPT ![d] = "activated"]
  /\ UNCHANGED << requestState, ingressMode, authState, indexState, releaseHistory >>

ActivationFailure(d) ==
  /\ requestState[d] = "idle"
  /\ stagedReleases[d] # {}
  /\ lastResult' = [lastResult EXCEPT ![d] = "activation_failed"]
  /\ UNCHANGED << requestState, ingressMode, authState, indexState, releaseHistory, stagedReleases, currentRelease >>

PublishFailure(d) ==
  /\ requestState[d] = "validated"
  /\ requestState' = [requestState EXCEPT ![d] = "failed"]
  /\ lastResult' = [lastResult EXCEPT ![d] = "publish_failed"]
  /\ UNCHANGED << ingressMode, authState, indexState, releaseHistory, stagedReleases, currentRelease >>

RecoverFailedRequest(d) ==
  /\ requestState[d] = "failed"
  /\ requestState' = [requestState EXCEPT ![d] = "idle"]
  /\ ingressMode' = [ingressMode EXCEPT ![d] = NoIngress]
  /\ authState' = [authState EXCEPT ![d] = "none"]
  /\ indexState' = [indexState EXCEPT ![d] = "unknown"]
  /\ lastResult' = [lastResult EXCEPT ![d] = "none"]
  /\ UNCHANGED << releaseHistory, stagedReleases, currentRelease >>

Next ==
  \E d \in Domains, r \in Releases, hasIndex \in BOOLEAN :
      AuthorizePublish(d)
   \/ DenyPublish(d)
   \/ ReceiveDirectFiles(d, hasIndex)
   \/ ReceiveZipArchive(d, hasIndex)
   \/ NormalizeIngress(d)
   \/ ValidateNormalizedArtifact(d)
   \/ RejectMissingIndex(d)
   \/ RejectInvalidArtifact(d)
   \/ CreateStagedRelease(d, r)
   \/ ActivateRelease(d, r)
   \/ ActivationFailure(d)
   \/ PublishFailure(d)
   \/ RecoverFailedRequest(d)

Inv_CurrentReleaseMustExist ==
  \A d \in Domains : currentRelease[d] # NoRelease => currentRelease[d] \in releaseHistory[d]

Inv_StagedReleasesMustExist ==
  \A d \in Domains : stagedReleases[d] \subseteq releaseHistory[d]

Inv_CurrentReleaseNotStaged ==
  \A d \in Domains : currentRelease[d] # NoRelease => currentRelease[d] \notin stagedReleases[d]

Inv_IdleReleaseHasNoActiveIngressState ==
  \A d \in Domains :
    requestState[d] = "idle" /\ currentRelease[d] # NoRelease =>
      /\ ingressMode[d] = NoIngress
      /\ indexState[d] = "unknown"

Inv_NoValidationWithoutIngress ==
  \A d \in Domains :
    requestState[d] \in {"normalized", "validated"} => ingressMode[d] \in {"direct_files", "zip_archive"}

Inv_NoValidatedStateWithoutIndex ==
  \A d \in Domains : requestState[d] = "validated" => indexState[d] = "present"

Inv_NoIngressWithoutAuthorization ==
  \A d \in Domains : ingressMode[d] \in {"direct_files", "zip_archive"} => authState[d] = "authorized" \/ requestState[d] = "idle"

Spec == Init /\ [][Next]_Vars

=============================================================================
