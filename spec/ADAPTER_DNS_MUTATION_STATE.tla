----------------------------- MODULE ADAPTER_DNS_MUTATION_STATE -----------------------------
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS Domains, ZoneVersions

VARIABLES dnsState, zoneHistory, liveZoneVersion, pendingMutation

Vars == << dnsState, zoneHistory, liveZoneVersion, pendingMutation >>

NoZone == "NOZONE"
NoAction == "NOACTION"

TypeInvariant ==
  /\ dnsState \in [Domains -> {"absent", "ready", "mutating", "mutation_failed"}]
  /\ zoneHistory \in [Domains -> SUBSET ZoneVersions]
  /\ liveZoneVersion \in [Domains -> ZoneVersions \cup {NoZone}]
  /\ pendingMutation \in [Domains -> {NoAction, "ensure", "replace"}]

Init ==
  /\ dnsState = [d \in Domains |-> "absent"]
  /\ zoneHistory = [d \in Domains |-> {}]
  /\ liveZoneVersion = [d \in Domains |-> NoZone]
  /\ pendingMutation = [d \in Domains |-> NoAction]

RequestEnsure(d) ==
  /\ dnsState[d] \in {"absent", "ready"}
  /\ pendingMutation[d] = NoAction
  /\ dnsState' = [dnsState EXCEPT ![d] = "mutating"]
  /\ pendingMutation' = [pendingMutation EXCEPT ![d] = "ensure"]
  /\ UNCHANGED << zoneHistory, liveZoneVersion >>

EnsureSuccess(d, v) ==
  /\ dnsState[d] = "mutating"
  /\ pendingMutation[d] = "ensure"
  /\ zoneHistory' = [zoneHistory EXCEPT ![d] = @ \cup {v}]
  /\ liveZoneVersion' = [liveZoneVersion EXCEPT ![d] = v]
  /\ dnsState' = [dnsState EXCEPT ![d] = "ready"]
  /\ pendingMutation' = [pendingMutation EXCEPT ![d] = NoAction]

RequestReplace(d) ==
  /\ dnsState[d] = "ready"
  /\ pendingMutation[d] = NoAction
  /\ dnsState' = [dnsState EXCEPT ![d] = "mutating"]
  /\ pendingMutation' = [pendingMutation EXCEPT ![d] = "replace"]
  /\ UNCHANGED << zoneHistory, liveZoneVersion >>

ReplaceSuccess(d, v) ==
  /\ dnsState[d] = "mutating"
  /\ pendingMutation[d] = "replace"
  /\ zoneHistory' = [zoneHistory EXCEPT ![d] = @ \cup {v}]
  /\ liveZoneVersion' = [liveZoneVersion EXCEPT ![d] = v]
  /\ dnsState' = [dnsState EXCEPT ![d] = "ready"]
  /\ pendingMutation' = [pendingMutation EXCEPT ![d] = NoAction]

MutationFailure(d) ==
  /\ dnsState[d] = "mutating"
  /\ pendingMutation[d] # NoAction
  /\ dnsState' = [dnsState EXCEPT ![d] = "mutation_failed"]
  /\ pendingMutation' = [pendingMutation EXCEPT ![d] = NoAction]
  /\ UNCHANGED << zoneHistory, liveZoneVersion >>

RecoverMutationFailure(d) ==
  /\ dnsState[d] = "mutation_failed"
  /\ pendingMutation[d] = NoAction
  /\ dnsState' = [dnsState EXCEPT ![d] = IF liveZoneVersion[d] = NoZone THEN "absent" ELSE "ready"]
  /\ UNCHANGED << zoneHistory, liveZoneVersion, pendingMutation >>

Next ==
  \E d \in Domains, v \in ZoneVersions :
      RequestEnsure(d)
   \/ EnsureSuccess(d, v)
   \/ RequestReplace(d)
   \/ ReplaceSuccess(d, v)
   \/ MutationFailure(d)
   \/ RecoverMutationFailure(d)

Inv_LiveZoneMustExist ==
  \A d \in Domains : liveZoneVersion[d] # NoZone => liveZoneVersion[d] \in zoneHistory[d]

Inv_NoConcurrentDnsMutation ==
  \A d \in Domains : pendingMutation[d] # NoAction => dnsState[d] = "mutating"

Spec == Init /\ [][Next]_Vars

=============================================================================
