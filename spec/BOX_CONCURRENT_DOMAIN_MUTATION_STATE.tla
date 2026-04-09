----------------------------- MODULE BOX_CONCURRENT_DOMAIN_MUTATION_STATE -----------------------------
EXTENDS Naturals, FiniteSets, TLC

(***************************************************************************
Box concurrent domain mutation model

Goal:
Model multiple agents trying to mutate the same domain so the box daemon can
serialize conflicting work instead of interleaving dangerous transitions.

Focus:
- only one active mutation per domain
- extra requests wait or are rejected
- completed work releases the lock
***************************************************************************)

CONSTANTS Domains, Agents

VARIABLES
  domainLock,
  activeMutation,
  queuedAgents,
  lastMutationResult

Vars == << domainLock, activeMutation, queuedAgents, lastMutationResult >>

NoAgent == "NOAGENT"
NoMutation == "NOMUTATION"

MutationKinds == {"publish", "rollback", "reconcile", "dns"}

TypeInvariant ==
  /\ domainLock \in [Domains -> Agents \cup {NoAgent}]
  /\ activeMutation \in [Domains -> MutationKinds \cup {NoMutation}]
  /\ queuedAgents \in [Domains -> SUBSET Agents]
  /\ lastMutationResult \in [Domains -> {"none", "started", "queued", "completed", "rejected", "failed"}]

Init ==
  /\ domainLock = [d \in Domains |-> NoAgent]
  /\ activeMutation = [d \in Domains |-> NoMutation]
  /\ queuedAgents = [d \in Domains |-> {}]
  /\ lastMutationResult = [d \in Domains |-> "none"]

AcquireMutation(d, a, m) ==
  /\ domainLock[d] = NoAgent
  /\ a \in Agents
  /\ a \notin queuedAgents[d]
  /\ m \in MutationKinds
  /\ domainLock' = [domainLock EXCEPT ![d] = a]
  /\ activeMutation' = [activeMutation EXCEPT ![d] = m]
  /\ lastMutationResult' = [lastMutationResult EXCEPT ![d] = "started"]
  /\ UNCHANGED queuedAgents

QueueMutation(d, a) ==
  /\ domainLock[d] # NoAgent
  /\ a \in Agents
  /\ a # domainLock[d]
  /\ queuedAgents' = [queuedAgents EXCEPT ![d] = @ \cup {a}]
  /\ lastMutationResult' = [lastMutationResult EXCEPT ![d] = "queued"]
  /\ UNCHANGED << domainLock, activeMutation >>

RejectDuplicateQueue(d, a) ==
  /\ a \in queuedAgents[d]
  /\ lastMutationResult' = [lastMutationResult EXCEPT ![d] = "rejected"]
  /\ UNCHANGED << domainLock, activeMutation, queuedAgents >>

CompleteMutation(d) ==
  /\ domainLock[d] # NoAgent
  /\ activeMutation[d] # NoMutation
  /\ domainLock' = [domainLock EXCEPT ![d] = NoAgent]
  /\ activeMutation' = [activeMutation EXCEPT ![d] = NoMutation]
  /\ lastMutationResult' = [lastMutationResult EXCEPT ![d] = "completed"]
  /\ UNCHANGED queuedAgents

FailMutation(d) ==
  /\ domainLock[d] # NoAgent
  /\ activeMutation[d] # NoMutation
  /\ domainLock' = [domainLock EXCEPT ![d] = NoAgent]
  /\ activeMutation' = [activeMutation EXCEPT ![d] = NoMutation]
  /\ lastMutationResult' = [lastMutationResult EXCEPT ![d] = "failed"]
  /\ UNCHANGED queuedAgents

PromoteQueuedAgent(d, a, m) ==
  /\ domainLock[d] = NoAgent
  /\ a \in queuedAgents[d]
  /\ m \in MutationKinds
  /\ domainLock' = [domainLock EXCEPT ![d] = a]
  /\ activeMutation' = [activeMutation EXCEPT ![d] = m]
  /\ queuedAgents' = [queuedAgents EXCEPT ![d] = @ \ {a}]
  /\ lastMutationResult' = [lastMutationResult EXCEPT ![d] = "started"]

Next ==
  \E d \in Domains, a \in Agents, m \in MutationKinds :
      AcquireMutation(d, a, m)
   \/ QueueMutation(d, a)
   \/ RejectDuplicateQueue(d, a)
   \/ CompleteMutation(d)
   \/ FailMutation(d)
   \/ PromoteQueuedAgent(d, a, m)

Inv_LockMatchesActiveMutation ==
  \A d \in Domains : (domainLock[d] = NoAgent) <=> (activeMutation[d] = NoMutation)

Inv_QueuedAgentNotLockHolder ==
  \A d \in Domains : domainLock[d] # NoAgent => domainLock[d] \notin queuedAgents[d]

Inv_AtMostOneActiveMutationPerDomain ==
  \A d \in Domains : activeMutation[d] \in MutationKinds \cup {NoMutation}

Spec == Init /\ [][Next]_Vars

=============================================================================
