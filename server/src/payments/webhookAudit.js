// Rejected-webhook audit — turns an invisible failure into a diagnosable one.
//
// Both provider receivers answer 200 to a bad-secret call (providers must not
// retry forever) and previously left NO trace, so "the callback never arrives"
// and "the callback arrives but we reject it" looked identical. This records a
// bounded, BODY-FREE marker: enough to prove the provider is calling and why we
// refused, with nothing an unauthenticated caller could use to flood the table
// or inject content.

const MAX_PER_HOUR = 50;

/** Never throws — auditing must not affect the webhook response. */
export async function logRejectedWebhook(prisma, provider, req, reason) {
  try {
    const model = provider === 'cardcom' ? prisma.cardcomWebhookLog : prisma.icountWebhookLog;
    const since = new Date(Date.now() - 60 * 60_000);
    // Rate cap: the endpoint is unauthenticated by definition, so a flood must
    // never grow the table without bound.
    const recent = await model.count({
      where: { createdAt: { gte: since }, payload: { path: ['__rejected'], equals: true } },
    });
    if (recent >= MAX_PER_HOUR) return;
    await model.create({
      data: {
        ...(provider === 'cardcom' ? { token: null } : { dealId: null }),
        payload: {
          __rejected: true,
          reason,
          at: new Date().toISOString(),
          // Metadata only — never the request body.
          ip: String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim().slice(0, 45) || null,
          userAgent: String(req.headers['user-agent'] || '').slice(0, 120) || null,
          secretLength: String(req.params?.secret || '').length,
          hasBody: !!req.body && Object.keys(req.body).length > 0,
        },
      },
    });
  } catch {
    /* auditing is best-effort */
  }
}
