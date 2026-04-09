----------------------------- MODULE BOX_AGENT_COMMAND_IDEMPOTENCY_STATE -----------------------------
EXTENDS Naturals, Sequences, FiniteSets, TLC

(***************************************************************************
Box agent command idempotency model

Goal:
Model typical agent-issued commands with request ids so retries and duplicate
submissions do not create duplicate side effects.

Focus:
- every command carries a command id
- the first successful execution records a durable result
- duplicate retries return the recorded result
- conflicting reuse of a command id is rejected
***************************************************************************)

CONSTANTS CommandIds, Domains, ReleaseIds

VARIABLES
  commandStatus,
  commandDomain,
  commandRelease,
  domainLive,
  publishCount,
  lastResult

Vars == << commandStatus, commandDomain, commandRelease, domainLive, publishCount, lastResult >>

NoRelease == "NORELEASE"

TypeInvariant ==
  /\ commandStatus \in [CommandIds -> {"new", "running", "recorded", "replayed", "conflict", "failed"}]
  /\ commandDomain \in [CommandIds -> Domains \cup {"none"}]
  /\ commandRelease \in [CommandIds -> ReleaseIds \cup {NoRelease}]
  /\ domainLive \in [Domains -> ReleaseIds \cup {NoRelease}]
  /\ publishCount \in [Domains -> Nat]
  /\ lastResult \in [CommandIds -> {"none", "accepted", "recorded", "replayed", "conflict", "failed"}]

Init ==
  /\ commandStatus = [c \in CommandIds |-> "new"]
  /\ commandDomain = [c \in CommandIds |-> "none"]
  /\ commandRelease = [c \in CommandIds |-> NoRelease]
  /\ domainLive = [d \in Domains |-> NoRelease]
  /\ publishCount = [d \in Domains |-> 0]
  /\ lastResult = [c \in CommandIds |-> "none"]

AcceptNewCommand(c, d) ==
  /\ commandStatus[c] = "new"
  /\ d \in Domains
  /\ commandStatus' = [commandStatus EXCEPT ![c] = "running"]
  /\ commandDomain' = [commandDomain EXCEPT ![c] = d]
  /\ lastResult' = [lastResult EXCEPT ![c] = "accepted"]
  /\ UNCHANGED << commandRelease, domainLive, publishCount >>

RecordPublish(c, r) ==
  /\ commandStatus[c] = "running"
  /\ commandDomain[c] \in Domains
  /\ r \in ReleaseIds
  /\ commandStatus' = [commandStatus EXCEPT ![c] = "recorded"]
  /\ commandRelease' = [commandRelease EXCEPT ![c] = r]
  /\ domainLive' = [domainLive EXCEPT ![commandDomain[c]] = r]
  /\ publishCount' = [publishCount EXCEPT ![commandDomain[c]] = @ + 1]
  /\ lastResult' = [lastResult EXCEPT ![c] = "recorded"]
  /\ UNCHANGED commandDomain

ReplaySameCommand(c) ==
  /\ commandStatus[c] = "recorded"
  /\ commandStatus' = [commandStatus EXCEPT ![c] = "replayed"]
  /\ lastResult' = [lastResult EXCEPT ![c] = "replayed"]
  /\ UNCHANGED << commandDomain, commandRelease, domainLive, publishCount >>

ReplayAgain(c) ==
  /\ commandStatus[c] = "replayed"
  /\ UNCHANGED Vars

RejectConflictingReuse(c, d, r) ==
  /\ commandStatus[c] \in {"recorded", "replayed"}
  /\ d \in Domains
  /\ r \in ReleaseIds
  /\ (d # commandDomain[c]) \/ (r # commandRelease[c])
  /\ commandStatus' = [commandStatus EXCEPT ![c] = "conflict"]
  /\ lastResult' = [lastResult EXCEPT ![c] = "conflict"]
  /\ UNCHANGED << commandDomain, commandRelease, domainLive, publishCount >>

FailRunningCommand(c) ==
  /\ commandStatus[c] = "running"
  /\ commandStatus' = [commandStatus EXCEPT ![c] = "failed"]
  /\ lastResult' = [lastResult EXCEPT ![c] = "failed"]
  /\ UNCHANGED << commandDomain, commandRelease, domainLive, publishCount >>

RecoverFailedCommand(c) ==
  /\ commandStatus[c] = "failed"
  /\ commandStatus' = [commandStatus EXCEPT ![c] = "new"]
  /\ commandDomain' = [commandDomain EXCEPT ![c] = "none"]
  /\ commandRelease' = [commandRelease EXCEPT ![c] = NoRelease]
  /\ lastResult' = [lastResult EXCEPT ![c] = "none"]
  /\ UNCHANGED << domainLive, publishCount >>

Next ==
  \E c \in CommandIds, d \in Domains, r \in ReleaseIds :
      AcceptNewCommand(c, d)
   \/ RecordPublish(c, r)
   \/ ReplaySameCommand(c)
   \/ ReplayAgain(c)
   \/ RejectConflictingReuse(c, d, r)
   \/ FailRunningCommand(c)
   \/ RecoverFailedCommand(c)

Inv_RecordedCommandHasStableBinding ==
  \A c \in CommandIds : commandStatus[c] \in {"recorded", "replayed", "conflict"} =>
    /\ commandDomain[c] \in Domains
    /\ commandRelease[c] # NoRelease

Inv_ReplayDoesNotIncreasePublishCount ==
  \A d \in Domains : publishCount[d] <= Cardinality(CommandIds)

Inv_LiveReleaseComesFromRecordedCommand ==
  \A d \in Domains : domainLive[d] # NoRelease =>
    \E c \in CommandIds :
      /\ commandDomain[c] = d
      /\ commandRelease[c] = domainLive[d]
      /\ commandStatus[c] \in {"recorded", "replayed", "conflict"}

Spec == Init /\ [][Next]_Vars

=============================================================================
