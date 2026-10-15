import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

export class RecruitmentError extends Error {}

export type CandidateStage = 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected';

const STAGE_ORDER: CandidateStage[] = ['applied', 'screening', 'interview', 'offer', 'hired'];

// -------------------------------------------------------------- openings

export interface JobOpeningRow {
  id: string;
  title: string;
  department: string | null;
  openings: number;
  description: string | null;
  status: string;
  candidateCount: number;
  hiredCount: number;
  createdAt: Date;
}

export async function listJobOpenings(scope: StoreScope): Promise<JobOpeningRow[]> {
  const rows = await db.jobOpening.findMany({
    where: scopeWhere(scope),
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: { candidates: { select: { stage: true } } },
  });
  return rows.map((r) => ({
    id: r.id, title: r.title, department: r.department, openings: r.openings,
    description: r.description, status: r.status,
    candidateCount: r.candidates.length,
    hiredCount: r.candidates.filter((c) => c.stage === 'hired').length,
    createdAt: r.createdAt,
  }));
}

export interface JobOpeningInput {
  title: string;
  department: string | null;
  openings: number;
  description: string | null;
}

export async function createJobOpening(scope: StoreScope, input: JobOpeningInput, userId: string): Promise<{ id: string }> {
  const storeId = scopeForWrite(scope);
  if (!input.title.trim()) throw new RecruitmentError('Job title is required.');
  if (input.openings < 1) throw new RecruitmentError('At least one opening is required.');

  const opening = await db.jobOpening.create({
    data: {
      storeId, title: input.title.trim(), department: input.department?.trim() || null,
      openings: input.openings, description: input.description?.trim() || null, createdBy: userId,
    },
    select: { id: true },
  });
  return opening;
}

export async function setJobOpeningStatus(scope: StoreScope, id: string, status: 'open' | 'on_hold' | 'closed'): Promise<void> {
  const storeId = scopeForWrite(scope);
  const found = await db.jobOpening.findFirst({ where: { id, storeId } });
  if (!found) throw new RecruitmentError('That opening is not in your scope.');
  await db.jobOpening.update({ where: { id }, data: { status, closedAt: status === 'closed' ? new Date() : null } });
}

// ------------------------------------------------------------- candidates

export interface CandidateRow {
  id: string;
  jobOpeningId: string;
  jobOpeningTitle: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  notes: string | null;
  stage: CandidateStage;
  hiredUserId: string | null;
  createdAt: Date;
}

export async function listCandidates(scope: StoreScope, opts: { jobOpeningId?: string } = {}): Promise<CandidateRow[]> {
  const rows = await db.candidate.findMany({
    where: { ...scopeWhere(scope), ...(opts.jobOpeningId ? { jobOpeningId: opts.jobOpeningId } : {}) },
    orderBy: [{ stage: 'asc' }, { createdAt: 'desc' }],
    include: { jobOpening: { select: { title: true } } },
    take: LIST_MAX_ROWS,
  });
  return rows.map((r) => ({
    id: r.id, jobOpeningId: r.jobOpeningId, jobOpeningTitle: r.jobOpening.title,
    fullName: r.fullName, phone: r.phone, email: r.email, source: r.source, notes: r.notes,
    stage: r.stage as CandidateStage, hiredUserId: r.hiredUserId, createdAt: r.createdAt,
  }));
}

export interface CandidateInput {
  jobOpeningId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  notes: string | null;
}

export async function addCandidate(scope: StoreScope, input: CandidateInput, userId: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!input.fullName.trim()) throw new RecruitmentError('Candidate name is required.');
  const opening = await db.jobOpening.findFirst({ where: { id: input.jobOpeningId, storeId } });
  if (!opening) throw new RecruitmentError('That job opening is not in your scope.');

  await db.candidate.create({
    data: {
      storeId, jobOpeningId: input.jobOpeningId, fullName: input.fullName.trim(),
      phone: input.phone?.trim() || null, email: input.email?.trim() || null,
      source: input.source?.trim() || null, notes: input.notes?.trim() || null,
      activities: { create: { kind: 'note', body: 'Added to the pipeline.', authorId: userId } },
    },
  });
}

function assertForwardOrRejection(from: CandidateStage, to: CandidateStage) {
  if (to === 'rejected') return;
  const fromIdx = STAGE_ORDER.indexOf(from);
  const toIdx = STAGE_ORDER.indexOf(to);
  if (toIdx !== fromIdx + 1) {
    throw new RecruitmentError(`A candidate at "${from}" can only move to the next stage or be rejected, not "${to}".`);
  }
}

/** Move a candidate through the pipeline - forward one stage at a time, or straight to rejected from anywhere. */
export async function moveCandidateStage(
  scope: StoreScope, candidateId: string, toStage: CandidateStage, userId: string, note: string | null,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const candidate = await db.candidate.findFirst({ where: { id: candidateId, storeId } });
  if (!candidate) throw new RecruitmentError('That candidate is not in your scope.');
  const fromStage = candidate.stage as CandidateStage;
  if (fromStage === 'hired' || fromStage === 'rejected') {
    throw new RecruitmentError(`This candidate is already ${fromStage} - nothing further to decide.`);
  }
  assertForwardOrRejection(fromStage, toStage);

  await db.$transaction([
    db.candidate.update({ where: { id: candidateId }, data: { stage: toStage } }),
    db.candidateActivity.create({
      data: { candidateId, kind: 'stage_change', stageFrom: fromStage, stageTo: toStage, body: note?.trim() || null, authorId: userId },
    }),
  ]);
}

export async function addCandidateNote(scope: StoreScope, candidateId: string, body: string, userId: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!body.trim()) throw new RecruitmentError('Note cannot be empty.');
  const candidate = await db.candidate.findFirst({ where: { id: candidateId, storeId } });
  if (!candidate) throw new RecruitmentError('That candidate is not in your scope.');
  await db.candidateActivity.create({ data: { candidateId, kind: 'note', body: body.trim(), authorId: userId } });
}

export interface CandidateActivityRow {
  id: string;
  kind: string;
  body: string | null;
  stageFrom: string | null;
  stageTo: string | null;
  authorName: string | null;
  createdAt: Date;
}

export async function listCandidateActivity(scope: StoreScope, candidateId: string): Promise<CandidateActivityRow[]> {
  const storeId = scopeForWrite(scope);
  const candidate = await db.candidate.findFirst({ where: { id: candidateId, storeId } });
  if (!candidate) throw new RecruitmentError('That candidate is not in your scope.');

  const rows = await db.candidateActivity.findMany({ where: { candidateId }, orderBy: { createdAt: 'asc' } });
  const authorIds = [...new Set(rows.map((r) => r.authorId).filter((x): x is string => !!x))];
  const authors = authorIds.length
    ? await db.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, fullName: true } })
    : [];
  const nameById = new Map(authors.map((a) => [a.id, a.fullName]));
  return rows.map((r) => ({
    id: r.id, kind: r.kind, body: r.body, stageFrom: r.stageFrom, stageTo: r.stageTo,
    authorName: r.authorId ? nameById.get(r.authorId) ?? null : null, createdAt: r.createdAt,
  }));
}

/**
 * Link a hired candidate to the real login an admin creates for them via
 * Users & Roles - a deliberate manual step, not automatic provisioning.
 * The candidate must already be at `hired` before this can be recorded.
 */
export async function linkHiredCandidate(scope: StoreScope, candidateId: string, userId: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const candidate = await db.candidate.findFirst({ where: { id: candidateId, storeId } });
  if (!candidate) throw new RecruitmentError('That candidate is not in your scope.');
  if (candidate.stage !== 'hired') throw new RecruitmentError('Only a hired candidate can be linked to a user account.');

  const alreadyLinked = await db.candidate.findFirst({ where: { hiredUserId: userId } });
  if (alreadyLinked) throw new RecruitmentError('That user is already linked to a hired candidate.');

  await db.candidate.update({ where: { id: candidateId }, data: { hiredUserId: userId } });
}

/** Everyone holding a role in this store - who a hired candidate can be linked to, or who can interview one. */
export async function listLinkableUsers(scope: StoreScope) {
  const storeId = scopeForWrite(scope);
  const roles = await db.userStoreRole.findMany({
    where: { storeId },
    distinct: ['userId'],
    select: { user: { select: { id: true, fullName: true } } },
  });
  return roles.map((r) => r.user).sort((a, b) => a.fullName.localeCompare(b.fullName));
}

// -------------------------------------------------------------- interviews

export interface InterviewRow {
  id: string;
  candidateId: string;
  candidateName: string;
  jobOpeningTitle: string;
  scheduledAt: Date;
  description: string | null;
  completed: boolean;
  feedback: string | null;
  interviewers: { id: string; fullName: string }[];
}

export async function listInterviews(scope: StoreScope, opts: { candidateId?: string } = {}): Promise<InterviewRow[]> {
  const rows = await db.interviewSchedule.findMany({
    where: { ...scopeWhere(scope), ...(opts.candidateId ? { candidateId: opts.candidateId } : {}) },
    orderBy: { scheduledAt: 'desc' },
    include: {
      candidate: { select: { fullName: true, jobOpening: { select: { title: true } } } },
      interviewers: { include: { user: { select: { id: true, fullName: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id, candidateId: r.candidateId, candidateName: r.candidate.fullName,
    jobOpeningTitle: r.candidate.jobOpening.title, scheduledAt: r.scheduledAt,
    description: r.description, completed: r.completed, feedback: r.feedback,
    interviewers: r.interviewers.map((i) => i.user),
  }));
}

export interface ScheduleInterviewInput {
  candidateId: string;
  scheduledAt: Date;
  interviewerUserIds: string[];
  description: string | null;
}

export async function scheduleInterview(scope: StoreScope, input: ScheduleInterviewInput, userId: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const candidate = await db.candidate.findFirst({ where: { id: input.candidateId, storeId } });
  if (!candidate) throw new RecruitmentError('That candidate is not in your scope.');
  if (candidate.stage === 'hired' || candidate.stage === 'rejected') {
    throw new RecruitmentError(`This candidate is already ${candidate.stage} - nothing left to interview.`);
  }
  if (input.interviewerUserIds.length === 0) throw new RecruitmentError('Pick at least one interviewer.');

  await db.interviewSchedule.create({
    data: {
      storeId, candidateId: input.candidateId, scheduledAt: input.scheduledAt,
      description: input.description?.trim() || null, createdBy: userId,
      interviewers: { create: input.interviewerUserIds.map((interviewerId) => ({ userId: interviewerId })) },
    },
  });
}

export async function markInterviewCompleted(
  scope: StoreScope, id: string, feedback: string | null,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const interview = await db.interviewSchedule.findFirst({ where: { id, storeId } });
  if (!interview) throw new RecruitmentError('That interview is not in your scope.');
  await db.interviewSchedule.update({
    where: { id }, data: { completed: true, feedback: feedback?.trim() || null },
  });
}

// ------------------------------------------------------------- talent pool

export interface SkillZoneRow {
  id: string;
  title: string;
  description: string | null;
  activeCandidateCount: number;
  createdAt: Date;
}

export async function listSkillZones(scope: StoreScope): Promise<SkillZoneRow[]> {
  const rows = await db.skillZone.findMany({
    where: scopeWhere(scope),
    orderBy: { createdAt: 'desc' },
    include: { candidates: { where: { isActive: true }, select: { id: true } } },
  });
  return rows.map((r) => ({
    id: r.id, title: r.title, description: r.description,
    activeCandidateCount: r.candidates.length, createdAt: r.createdAt,
  }));
}

export async function createSkillZone(
  scope: StoreScope, input: { title: string; description: string | null },
): Promise<{ id: string }> {
  const storeId = scopeForWrite(scope);
  if (!input.title.trim()) throw new RecruitmentError('Talent pool name is required.');
  const zone = await db.skillZone.create({
    data: { storeId, title: input.title.trim(), description: input.description?.trim() || null },
    select: { id: true },
  });
  return zone;
}

export interface SkillZoneCandidateRow {
  id: string;
  candidateId: string;
  candidateName: string;
  jobOpeningTitle: string;
  reason: string;
  isActive: boolean;
  addedOn: Date;
}

export async function listSkillZoneCandidates(scope: StoreScope, skillZoneId: string): Promise<SkillZoneCandidateRow[]> {
  const storeId = scopeForWrite(scope);
  const zone = await db.skillZone.findFirst({ where: { id: skillZoneId, storeId } });
  if (!zone) throw new RecruitmentError('That talent pool is not in your scope.');

  const rows = await db.skillZoneCandidate.findMany({
    where: { skillZoneId },
    orderBy: { addedOn: 'desc' },
    include: { candidate: { select: { fullName: true, jobOpening: { select: { title: true } } } } },
  });
  return rows.map((r) => ({
    id: r.id, candidateId: r.candidateId, candidateName: r.candidate.fullName,
    jobOpeningTitle: r.candidate.jobOpening.title, reason: r.reason, isActive: r.isActive, addedOn: r.addedOn,
  }));
}

export async function addCandidateToSkillZone(
  scope: StoreScope, input: { skillZoneId: string; candidateId: string; reason: string },
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!input.reason.trim()) throw new RecruitmentError('Say why this candidate is being kept for later.');

  const [zone, candidate] = await Promise.all([
    db.skillZone.findFirst({ where: { id: input.skillZoneId, storeId } }),
    db.candidate.findFirst({ where: { id: input.candidateId, storeId } }),
  ]);
  if (!zone) throw new RecruitmentError('That talent pool is not in your scope.');
  if (!candidate) throw new RecruitmentError('That candidate is not in your scope.');

  const existing = await db.skillZoneCandidate.findUnique({
    where: { skillZoneId_candidateId: { skillZoneId: input.skillZoneId, candidateId: input.candidateId } },
  });
  if (existing) {
    if (existing.isActive) throw new RecruitmentError(`${candidate.fullName} is already in this talent pool.`);
    await db.skillZoneCandidate.update({ where: { id: existing.id }, data: { isActive: true, reason: input.reason.trim() } });
    return;
  }

  await db.skillZoneCandidate.create({
    data: { skillZoneId: input.skillZoneId, candidateId: input.candidateId, reason: input.reason.trim() },
  });
}

export async function removeCandidateFromSkillZone(scope: StoreScope, id: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const entry = await db.skillZoneCandidate.findFirst({ where: { id, skillZone: { storeId } } });
  if (!entry) throw new RecruitmentError('That talent pool entry is not in your scope.');
  await db.skillZoneCandidate.update({ where: { id }, data: { isActive: false } });
}
