/**
 * Execute a classified custom removal: "the matching flow runs".
 *
 * Classification decides what a user-submitted URL IS; this decides what happens
 * next. Until this existed, a submission routed to `legal_request` only wrote a row
 * saying it should become one, and nothing ever made it -- the safety half of the
 * feature worked and the useful half did not.
 *
 * Four routes, and only one of them sends anything:
 *
 *   legal_request   -> plan and send a statutory request, with the submitted URL
 *                      attached as an observation so the letter cites it
 *   search_delisting-> generate the text for the engine's own form; a human submits
 *   manual_review   -> queue, with the reason the classifier could not route it
 *   rejected        -> nothing, and the user is told why
 */
import type {
  CustomRemovalRequest, Observation, Subject,
} from '../types.ts';
import type { Clock } from '../util/clock.ts';
import type { Store } from '../store/store.ts';
import type { BrokerRegistry } from '../brokers/registry.ts';
import type { Sender } from '../engine/sender.ts';
import { planRequests } from '../engine/planner.ts';
import { renderDelistingRequest } from './delisting.ts';
import { nameMatchesSubject } from './classify.ts';
import { newId } from '../util/ids.ts';
import { log } from '../util/logging.ts';

export interface ExecuteDeps {
  readonly store: Store;
  readonly registry: BrokerRegistry;
  readonly sender: Sender;
  readonly clock: Clock;
  readonly agentName: string;
}

export interface ExecuteResult {
  readonly custom: CustomRemovalRequest;
  /** Present for a search delisting: the text a person must submit. */
  readonly delistingText: string | null;
}

export async function executeCustomRemoval(
  custom: CustomRemovalRequest,
  subject: Subject,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  const now = deps.clock.now();

  switch (custom.routedTo) {
    case 'rejected':
      return finish(deps, { ...custom, status: 'rejected', outcomeNote: custom.reason }, null);

    case 'legal_request':
      return sendForBroker(custom, subject, deps, now);

    case 'search_delisting': {
      const { target, text } = renderDelistingRequest(custom.url, subject, deps.agentName);
      if (!target) {
        return finish(deps, {
          ...custom, status: 'queued_for_review',
          outcomeNote: 'Recognised as a search result, but the engine is not one deletewe ' +
            'has a delisting route for. A human should identify the right form.',
        }, null);
      }
      return finish(deps, {
        ...custom,
        status: 'awaiting_manual_submission',
        outcomeNote: `Delisting text generated for ${target.engine}. ` +
          `Submit it at ${target.formUrl} — ${target.engine} accepts these only through ` +
          'its own form, not by email, so deletewe does not submit it for you.',
      }, text);
    }

    case 'manual_review':
    default:
      return finish(deps, {
        ...custom, status: 'queued_for_review', outcomeNote: custom.reason,
      }, null);
  }
}

async function sendForBroker(
  custom: CustomRemovalRequest, subject: Subject, deps: ExecuteDeps, now: Date,
): Promise<ExecuteResult> {
  const broker = custom.brokerId ? deps.registry.get(custom.brokerId) : undefined;
  if (!broker) {
    // An unknown host that looked like a people-search site reaches here with no
    // broker record. We will not guess a legal contact -- sending a statutory demand
    // to privacy@<whatever> because the pattern usually works is how you send a real
    // person's name and address to a mailbox that may belong to anyone.
    return finish(deps, {
      ...custom,
      status: 'awaiting_broker_contact',
      outcomeNote: 'This host is not in the broker registry, so deletewe has no verified ' +
        'legal contact for it. Add the broker (with its published privacy contact) and ' +
        'resubmit. deletewe will not guess an address for a letter containing your identity.',
    }, null);
  }

  // The user telling us where they saw themselves IS an observation. Recording it
  // means the letter cites the exact URL, which defeats "we cannot locate your
  // record" and makes the result re-verifiable later (ADR-0001 D1).
  const observation: Observation = {
    id: newId('obs'),
    subjectId: subject.id,
    brokerId: broker.id,
    url: custom.url,
    observedAt: now.toISOString(),
    matchedIdentifiers: observedIdentifiers(custom.url, subject),
    present: true,
    snapshotHash: null,
  };
  deps.store.putObservation(observation);

  const plan = planRequests(subject, {
    registry: deps.registry,
    observations: [observation],
    existing: deps.store.requestsForSubject(subject.id),
    only: [broker.id],
    now,
  });

  if (plan.requests.length === 0) {
    const why = plan.skipped[0]?.reason ?? 'no_entitlement';
    return finish(deps, {
      ...custom,
      status: why === 'already_open' || why === 'not_due' ? 'submitted' : 'queued_for_review',
      outcomeNote: why === 'already_open'
        ? `A request to ${broker.name} is already open for you; the URL you submitted has ` +
          'been attached to it as evidence rather than starting a duplicate.'
        : why === 'not_due'
          ? `${broker.name} was dealt with recently and is inside its re-assertion cycle. ` +
            'The URL is recorded and will be cited at the next request.'
          : `No statutory route from ${subject.residence} to ${broker.name} (${why}).`,
    }, null);
  }

  const out = await deps.sender.sendPlan(subject, plan.requests);
  const sent = out.requests.find((r) => r.brokerId === broker.id && r.sentAt !== null);

  if (!sent) {
    return finish(deps, {
      ...custom, status: 'queued_for_review',
      outcomeNote: `Could not send to ${broker.name}: ${out.errors[0]?.error ?? 'unknown error'}.`,
    }, null);
  }

  log.info('custom removal produced a statutory request', {
    customId: custom.id, brokerId: broker.id, requestId: sent.id,
  });

  return finish(deps, {
    ...custom,
    status: 'request_sent',
    requestId: sent.id,
    outcomeNote: `Statutory request sent to ${broker.name} under ${sent.instrument}, ` +
      `citing the URL you submitted. Response due ${(sent.dueAt ?? '').slice(0, 10)}.`,
  }, null);
}

function observedIdentifiers(rawUrl: string, subject: Subject): Observation['matchedIdentifiers'] {
  try {
    return nameMatchesSubject(new URL(rawUrl), subject) ? ['full_name'] : [];
  } catch {
    return [];
  }
}

function finish(
  deps: ExecuteDeps, custom: CustomRemovalRequest, delistingText: string | null,
): ExecuteResult {
  deps.store.putCustomRemoval(custom);
  return { custom, delistingText };
}
