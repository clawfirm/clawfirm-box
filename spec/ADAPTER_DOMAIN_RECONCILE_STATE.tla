----------------------------- MODULE ADAPTER_DOMAIN_RECONCILE_STATE -----------------------------
EXTENDS Naturals, TLC

(***************************************************************************
Adapter domain reconcile model

Goal:
Model adapter-side domain readiness reconciliation.

Focus:
- reconciliation requires authorization
- zone, site root, serving config, and HTTPS probes are separate readiness steps
- adapter may repair missing runtime pieces before declaring the domain ready
- a domain is ready only when DNS/runtime/serving/TLS conditions all hold together
- apex and www are validated as separate externally-reachable hosts
***************************************************************************)

CONSTANTS Domains

VARIABLES
  requestState,
  authState,
  zoneState,
  siteRootState,
  servingState,
  caddyConfigState,
  apexTlsState,
  wwwTlsState,
  domainReady,
  lastResult

Vars == << requestState, authState, zoneState, siteRootState, servingState, caddyConfigState, apexTlsState, wwwTlsState, domainReady, lastResult >>

TypeInvariant ==
  /\ requestState \in [Domains -> {"idle", "authorized", "inspecting", "repairing", "verified", "failed"}]
  /\ authState \in [Domains -> {"none", "authorized", "denied"}]
  /\ zoneState \in [Domains -> {"unknown", "missing", "ready"}]
  /\ siteRootState \in [Domains -> {"unknown", "missing", "ready"}]
  /\ servingState \in [Domains -> {"unknown", "missing", "ready"}]
  /\ caddyConfigState \in [Domains -> {"unknown", "ready", "duplicate_host_conflict"}]
  /\ apexTlsState \in [Domains -> {"unknown", "failing", "ready"}]
  /\ wwwTlsState \in [Domains -> {"unknown", "failing", "ready"}]
  /\ domainReady \in [Domains -> BOOLEAN]
  /\ lastResult \in [Domains -> {"none", "ok", "unauthorized", "repair_needed", "verified", "probe_failed", "config_conflict"}]

Init ==
  /\ requestState = [d \in Domains |-> "idle"]
  /\ authState = [d \in Domains |-> "none"]
  /\ zoneState = [d \in Domains |-> "unknown"]
  /\ siteRootState = [d \in Domains |-> "unknown"]
  /\ servingState = [d \in Domains |-> "unknown"]
  /\ caddyConfigState = [d \in Domains |-> "unknown"]
  /\ apexTlsState = [d \in Domains |-> "unknown"]
  /\ wwwTlsState = [d \in Domains |-> "unknown"]
  /\ domainReady = [d \in Domains |-> FALSE]
  /\ lastResult = [d \in Domains |-> "none"]

AuthorizeReconcile(d) ==
  /\ requestState[d] = "idle"
  /\ authState[d] = "none"
  /\ requestState' = [requestState EXCEPT ![d] = "authorized"]
  /\ authState' = [authState EXCEPT ![d] = "authorized"]
  /\ lastResult' = [lastResult EXCEPT ![d] = "ok"]
  /\ UNCHANGED << zoneState, siteRootState, servingState, caddyConfigState, apexTlsState, wwwTlsState, domainReady >>

DenyReconcile(d) ==
  /\ requestState[d] = "idle"
  /\ authState[d] = "none"
  /\ requestState' = [requestState EXCEPT ![d] = "failed"]
  /\ authState' = [authState EXCEPT ![d] = "denied"]
  /\ lastResult' = [lastResult EXCEPT ![d] = "unauthorized"]
  /\ UNCHANGED << zoneState, siteRootState, servingState, caddyConfigState, apexTlsState, wwwTlsState, domainReady >>

InspectRuntime(d, zoneReady, siteReady, servingReady, duplicateHostConflict) ==
  /\ requestState[d] = "authorized"
  /\ zoneReady \in BOOLEAN
  /\ siteReady \in BOOLEAN
  /\ servingReady \in BOOLEAN
  /\ duplicateHostConflict \in BOOLEAN
  /\ requestState' = [requestState EXCEPT ![d] = "inspecting"]
  /\ zoneState' = [zoneState EXCEPT ![d] = IF zoneReady THEN "ready" ELSE "missing"]
  /\ siteRootState' = [siteRootState EXCEPT ![d] = IF siteReady THEN "ready" ELSE "missing"]
  /\ servingState' = [servingState EXCEPT ![d] = IF servingReady THEN "ready" ELSE "missing"]
  /\ caddyConfigState' = [caddyConfigState EXCEPT ![d] = IF duplicateHostConflict THEN "duplicate_host_conflict" ELSE "ready"]
  /\ apexTlsState' = [apexTlsState EXCEPT ![d] = "unknown"]
  /\ wwwTlsState' = [wwwTlsState EXCEPT ![d] = "unknown"]
  /\ domainReady' = [domainReady EXCEPT ![d] = FALSE]
  /\ lastResult' = [lastResult EXCEPT ![d] = IF duplicateHostConflict THEN "config_conflict" ELSE "ok"]
  /\ UNCHANGED authState

RepairRuntime(d) ==
  /\ requestState[d] = "inspecting"
  /\ zoneState[d] \in {"missing", "ready"}
  /\ requestState' = [requestState EXCEPT ![d] = "repairing"]
  /\ zoneState' = [zoneState EXCEPT ![d] = "ready"]
  /\ siteRootState' = [siteRootState EXCEPT ![d] = "ready"]
  /\ servingState' = [servingState EXCEPT ![d] = "ready"]
  /\ caddyConfigState' = [caddyConfigState EXCEPT ![d] = "ready"]
  /\ apexTlsState' = [apexTlsState EXCEPT ![d] = "unknown"]
  /\ wwwTlsState' = [wwwTlsState EXCEPT ![d] = "unknown"]
  /\ domainReady' = [domainReady EXCEPT ![d] = FALSE]
  /\ lastResult' = [lastResult EXCEPT ![d] = "repair_needed"]
  /\ UNCHANGED authState

ProbeHostsReady(d) ==
  /\ requestState[d] \in {"inspecting", "repairing"}
  /\ zoneState[d] = "ready"
  /\ siteRootState[d] = "ready"
  /\ servingState[d] = "ready"
  /\ caddyConfigState[d] = "ready"
  /\ requestState' = [requestState EXCEPT ![d] = "verified"]
  /\ apexTlsState' = [apexTlsState EXCEPT ![d] = "ready"]
  /\ wwwTlsState' = [wwwTlsState EXCEPT ![d] = "ready"]
  /\ domainReady' = [domainReady EXCEPT ![d] = TRUE]
  /\ lastResult' = [lastResult EXCEPT ![d] = "verified"]
  /\ UNCHANGED << authState, zoneState, siteRootState, servingState, caddyConfigState >>

ProbeHostsFailed(d, apexOk, wwwOk) ==
  /\ requestState[d] \in {"inspecting", "repairing"}
  /\ zoneState[d] = "ready"
  /\ siteRootState[d] = "ready"
  /\ servingState[d] = "ready"
  /\ caddyConfigState[d] = "ready"
  /\ apexOk \in BOOLEAN
  /\ wwwOk \in BOOLEAN
  /\ ~(apexOk /\ wwwOk)
  /\ requestState' = [requestState EXCEPT ![d] = "failed"]
  /\ apexTlsState' = [apexTlsState EXCEPT ![d] = IF apexOk THEN "ready" ELSE "failing"]
  /\ wwwTlsState' = [wwwTlsState EXCEPT ![d] = IF wwwOk THEN "ready" ELSE "failing"]
  /\ domainReady' = [domainReady EXCEPT ![d] = FALSE]
  /\ lastResult' = [lastResult EXCEPT ![d] = "probe_failed"]
  /\ UNCHANGED << authState, zoneState, siteRootState, servingState, caddyConfigState >>

ResetRequest(d) ==
  /\ requestState[d] \in {"verified", "failed"}
  /\ requestState' = [requestState EXCEPT ![d] = "idle"]
  /\ authState' = [authState EXCEPT ![d] = "none"]
  /\ UNCHANGED << zoneState, siteRootState, servingState, caddyConfigState, apexTlsState, wwwTlsState, domainReady, lastResult >>

Next ==
  \E d \in Domains, zoneReady \in BOOLEAN, siteReady \in BOOLEAN, servingReady \in BOOLEAN, duplicateHostConflict \in BOOLEAN, apexOk \in BOOLEAN, wwwOk \in BOOLEAN :
      AuthorizeReconcile(d)
   \/ DenyReconcile(d)
   \/ InspectRuntime(d, zoneReady, siteReady, servingReady, duplicateHostConflict)
   \/ RepairRuntime(d)
   \/ ProbeHostsReady(d)
   \/ ProbeHostsFailed(d, apexOk, wwwOk)
   \/ ResetRequest(d)

Inv_ReadyRequiresAllSubsystems ==
  \A d \in Domains : domainReady[d] =>
    /\ zoneState[d] = "ready"
    /\ siteRootState[d] = "ready"
    /\ servingState[d] = "ready"
    /\ apexTlsState[d] = "ready"
    /\ wwwTlsState[d] = "ready"

Inv_NoTlsReadyWithoutServing ==
  \A d \in Domains :
    (apexTlsState[d] = "ready" \/ wwwTlsState[d] = "ready") => servingState[d] = "ready"

Inv_VerifiedServingRequiresSiteRoot ==
  \A d \in Domains : requestState[d] = "verified" =>
    /\ servingState[d] = "ready"
    /\ siteRootState[d] = "ready"

Inv_NoVerifiedOrReadyWithCaddyConflict ==
  \A d \in Domains : caddyConfigState[d] = "duplicate_host_conflict" =>
    /\ requestState[d] # "verified"
    /\ domainReady[d] = FALSE

Spec == Init /\ [][Next]_Vars

=============================================================================
