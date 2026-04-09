----------------------------- MODULE ADAPTER_ADMIN_HEALTH_STATE -----------------------------
EXTENDS Naturals, TLC

(***************************************************************************
Adapter admin health model

Goal:
Model internal-only operator health endpoints for system/service/log-pipeline
status. Public access must be denied.
***************************************************************************)

CONSTANTS Users

VARIABLES
  systemHealthState,
  statsPipelineState,
  serviceState,
  operatorAuth,
  publicAccessState,
  lastResult

Vars == << systemHealthState, statsPipelineState, serviceState, operatorAuth, publicAccessState, lastResult >>

TypeInvariant ==
  /\ systemHealthState \in {"healthy", "warning", "critical"}
  /\ statsPipelineState \in {"fresh", "stale", "broken"}
  /\ serviceState \in {"running", "degraded", "down"}
  /\ operatorAuth \in [Users -> BOOLEAN]
  /\ publicAccessState \in {"closed", "attempted"}
  /\ lastResult \in {"none", "operator_ok", "denied"}

Init ==
  /\ systemHealthState = "healthy"
  /\ statsPipelineState = "fresh"
  /\ serviceState = "running"
  /\ operatorAuth = [u \in Users |-> FALSE]
  /\ publicAccessState = "closed"
  /\ lastResult = "none"

AuthorizeOperator(u) ==
  /\ u \in Users
  /\ operatorAuth' = [operatorAuth EXCEPT ![u] = TRUE]
  /\ UNCHANGED << systemHealthState, statsPipelineState, serviceState, publicAccessState, lastResult >>

MarkSystemWarning ==
  /\ systemHealthState' = "warning"
  /\ UNCHANGED << statsPipelineState, serviceState, operatorAuth, publicAccessState, lastResult >>

MarkSystemCritical ==
  /\ systemHealthState' = "critical"
  /\ statsPipelineState' = "stale"
  /\ serviceState' = "degraded"
  /\ UNCHANGED << operatorAuth, publicAccessState, lastResult >>

MarkPipelineStale ==
  /\ statsPipelineState' = "stale"
  /\ UNCHANGED << systemHealthState, serviceState, operatorAuth, publicAccessState, lastResult >>

MarkPipelineBroken ==
  /\ statsPipelineState' = "broken"
  /\ UNCHANGED << systemHealthState, serviceState, operatorAuth, publicAccessState, lastResult >>

MarkServiceDegraded ==
  /\ serviceState' = "degraded"
  /\ statsPipelineState' = IF statsPipelineState = "fresh" THEN "stale" ELSE statsPipelineState
  /\ UNCHANGED << systemHealthState, operatorAuth, publicAccessState, lastResult >>

MarkServiceDown ==
  /\ serviceState' = "down"
  /\ statsPipelineState' = "broken"
  /\ UNCHANGED << systemHealthState, operatorAuth, publicAccessState, lastResult >>

OperatorHealthQuery(u) ==
  /\ u \in Users
  /\ operatorAuth[u]
  /\ publicAccessState = "closed"
  /\ lastResult' = "operator_ok"
  /\ UNCHANGED << systemHealthState, statsPipelineState, serviceState, operatorAuth, publicAccessState >>

DeniedOperatorHealthQuery(u) ==
  /\ u \in Users
  /\ ~operatorAuth[u]
  /\ publicAccessState = "closed"
  /\ lastResult' = "denied"
  /\ UNCHANGED << systemHealthState, statsPipelineState, serviceState, operatorAuth, publicAccessState >>

PublicAdminQueryAttempt ==
  /\ publicAccessState' = "attempted"
  /\ lastResult' = "denied"
  /\ UNCHANGED << systemHealthState, statsPipelineState, serviceState, operatorAuth >>

Reset ==
  /\ lastResult \in {"operator_ok", "denied"}
  /\ publicAccessState' = "closed"
  /\ lastResult' = "none"
  /\ UNCHANGED << systemHealthState, statsPipelineState, serviceState, operatorAuth >>

Next ==
  \/ \E u \in Users : AuthorizeOperator(u)
  \/ MarkSystemWarning
  \/ MarkSystemCritical
  \/ MarkPipelineStale
  \/ MarkPipelineBroken
  \/ MarkServiceDegraded
  \/ MarkServiceDown
  \/ \E u \in Users : OperatorHealthQuery(u)
  \/ \E u \in Users : DeniedOperatorHealthQuery(u)
  \/ PublicAdminQueryAttempt
  \/ Reset

Inv_NoPublicAdminHealthAccess ==
  publicAccessState = "attempted" => lastResult = "denied"

Inv_OperatorHealthRequiresAuth ==
  lastResult = "operator_ok" => \E u \in Users : operatorAuth[u]

Inv_HealthyPipelineRequiresRunningService ==
  statsPipelineState = "fresh" => serviceState = "running"

Inv_CriticalSystemCannotReportHealthyPipelineAndRunningService ==
  systemHealthState = "critical" => ~(statsPipelineState = "fresh" /\ serviceState = "running")

Spec == Init /\ [][Next]_Vars

=============================================================================
