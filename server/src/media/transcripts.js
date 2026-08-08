// Transcript versioning with provenance.
//
// Re-transcribing NEVER overwrites history. A better model, a different
// language hint or a re-recorded source produces a NEW row that becomes
// current, and the one it replaced stays readable forever. Silently destroying
// the previous transcript would make "the transcript got worse" an
// uninvestigable claim.

/**
 * Store a transcript and make it current, demoting the previous one.
 *
 * Both writes happen in ONE transaction: a crash between them would otherwise
 * leave either two current transcripts or none, and every reader assumes
 * exactly one.
 */
export async function saveTranscript(
  client,
  { mediaId, text, segments = null, language = null, provider, model, sourceObjectKey = null, sourceChecksum = null, durationSeconds = null, requestedById = null },
) {
  if (!mediaId || !provider || !model) throw new Error('invalid_transcript');
  return client.$transaction(async (tx) => {
    await tx.mediaTranscript.updateMany({
      where: { mediaId, isCurrent: true },
      data: { isCurrent: false },
    });
    return tx.mediaTranscript.create({
      data: {
        mediaId,
        isCurrent: true,
        text: String(text ?? ''),
        segments: segments || undefined,
        language,
        provider,
        model,
        sourceObjectKey,
        sourceChecksum,
        durationSeconds,
        requestedById,
      },
    });
  });
}

export async function currentTranscript(client, mediaId) {
  if (!mediaId) return null;
  return client.mediaTranscript.findFirst({ where: { mediaId, isCurrent: true } });
}

export async function transcriptHistory(client, mediaId) {
  if (!mediaId) return [];
  return client.mediaTranscript.findMany({
    where: { mediaId },
    orderBy: { generatedAt: 'desc' },
  });
}

/**
 * Archive the CURRENT transcript — the item goes back to having none, but the
 * text survives as history. There is deliberately no hard delete: an operator
 * clearing a bad transcript should not also destroy the evidence of what the
 * provider actually returned.
 */
export async function archiveCurrentTranscript(client, mediaId) {
  const res = await client.mediaTranscript.updateMany({
    where: { mediaId, isCurrent: true },
    data: { isCurrent: false },
  });
  return res.count;
}

/** Promote a historical transcript back to current (an explicit rollback). */
export async function restoreTranscript(client, { mediaId, transcriptId }) {
  return client.$transaction(async (tx) => {
    const target = await tx.mediaTranscript.findFirst({ where: { id: transcriptId, mediaId } });
    if (!target) {
      const err = new Error('not_found');
      err.status = 404;
      throw err;
    }
    await tx.mediaTranscript.updateMany({
      where: { mediaId, isCurrent: true },
      data: { isCurrent: false },
    });
    return tx.mediaTranscript.update({ where: { id: transcriptId }, data: { isCurrent: true } });
  });
}
