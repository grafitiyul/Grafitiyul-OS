import express, { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import {
  renderFinalPdf,
  looksLikePdf,
  countPdfPages,
} from '../services/pdfRender.js';

const router = Router();

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_OVERRIDE_IMAGE_BYTES = 5 * 1024 * 1024;

function isPng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return false;
  return (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

// ── Upload & sources ─────────────────────────────────────────────────────────
//
// V1: PDF only. Creates source + passthrough snapshot in one atomic pair and
// returns both ids so the client can move straight into the template editor.

router.post(
  '/sources',
  express.raw({ type: '*/*', limit: '30mb' }),
  handle(async (req, res) => {
    const body = req.body;
    const filename = String(req.query.filename || 'document.pdf').slice(0, 200);

    if (!Buffer.isBuffer(body) || body.length === 0) {
      return res.status(400).json({ error: 'empty_body' });
    }
    if (body.length > MAX_PDF_BYTES) {
      return res.status(413).json({ error: 'too_large' });
    }
    if (!looksLikePdf(body)) {
      return res.status(400).json({ error: 'pdf_required' });
    }

    let pageCount;
    try {
      pageCount = await countPdfPages(body);
    } catch {
      return res.status(400).json({ error: 'invalid_pdf' });
    }

    // V1: snapshot = source passthrough. Same bytes stored twice (source is
    // the original; snapshot is the "stable render" we'll never re-derive).
    const { source, snap } = await prisma.$transaction(async (tx) => {
      const src = await tx.documentSource.create({
        data: {
          filename,
          mimeType: 'application/pdf',
          sourceKind: 'pdf',
          bytes: body,
          byteSize: body.length,
        },
      });
      const snp = await tx.documentSnapshot.create({
        data: {
          sourceId: src.id,
          pdfBytes: body,
          pageCount,
          generator: 'passthrough',
          generatorVersion: 'v1',
        },
      });
      return { source: src, snap: snp };
    });
    res.status(201).json({
      source: {
        id: source.id,
        filename: source.filename,
        byteSize: source.byteSize,
      },
      snapshot: { id: snap.id, pageCount: snap.pageCount },
    });
  }),
);

router.get(
  '/snapshots/:id/pdf',
  handle(async (req, res) => {
    const snap = await prisma.documentSnapshot.findUnique({
      where: { id: req.params.id },
    });
    if (!snap) return res.status(404).json({ error: 'not_found' });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Length', String(snap.pdfBytes.length));
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(snap.pdfBytes));
  }),
);

// ── Templates ────────────────────────────────────────────────────────────────

router.get(
  '/templates',
  handle(async (_req, res) => {
    const templates = await prisma.documentTemplate.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        snapshot: { select: { id: true, pageCount: true } },
        _count: { select: { instances: true, fields: true } },
      },
    });
    res.json(templates);
  }),
);

router.post(
  '/templates',
  handle(async (req, res) => {
    const { title, description, snapshotId } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'title_required' });
    }
    if (!snapshotId) return res.status(400).json({ error: 'snapshotId_required' });
    const snap = await prisma.documentSnapshot.findUnique({
      where: { id: snapshotId },
    });
    if (!snap) return res.status(400).json({ error: 'snapshot_not_found' });

    const created = await prisma.documentTemplate.create({
      data: {
        title: String(title).trim(),
        description: description ? String(description) : null,
        snapshotId,
      },
    });
    res.status(201).json(created);
  }),
);

router.get(
  '/templates/:id',
  handle(async (req, res) => {
    const t = await prisma.documentTemplate.findUnique({
      where: { id: req.params.id },
      include: {
        snapshot: { select: { id: true, pageCount: true } },
        fields: { orderBy: { order: 'asc' } },
        _count: { select: { instances: true } },
      },
    });
    if (!t) return res.status(404).json({ error: 'not_found' });
    res.json(t);
  }),
);

router.put(
  '/templates/:id',
  handle(async (req, res) => {
    const { title, description, status } = req.body || {};
    const data = {};
    if (title !== undefined) data.title = String(title);
    if (description !== undefined) {
      data.description = description ? String(description) : null;
    }
    if (status !== undefined) data.status = String(status);
    const updated = await prisma.documentTemplate.update({
      where: { id: req.params.id },
      data,
    });
    res.json(updated);
  }),
);

router.delete(
  '/templates/:id',
  handle(async (req, res) => {
    const instances = await prisma.documentInstance.count({
      where: { templateId: req.params.id },
    });
    if (instances > 0) {
      return res.status(409).json({ error: 'template_has_instances', instances });
    }
    await prisma.documentTemplate.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// Atomic replace-all for a template's field list. Blocked if any instance
// exists (per §product-rules: editing a template with existing instances is
// confusing; admins create a new template instead).
router.put(
  '/templates/:id/fields',
  handle(async (req, res) => {
    const templateId = req.params.id;
    const { fields } = req.body || {};
    if (!Array.isArray(fields)) {
      return res.status(400).json({ error: 'fields_array_required' });
    }
    const instances = await prisma.documentInstance.count({ where: { templateId } });
    if (instances > 0) {
      return res.status(409).json({ error: 'template_has_instances', instances });
    }

    // Build create payload — validate minimal shape.
    const creates = [];
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (!f || typeof f !== 'object') continue;
      const page = Math.max(1, Number(f.page || 1));
      const xPct = clamp01to100(f.xPct);
      const yPct = clamp01to100(f.yPct);
      const wPct = clamp01to100(f.wPct);
      const hPct = clamp01to100(f.hPct);
      const fieldType = String(f.fieldType || 'text');
      const valueSource = String(f.valueSource || 'override_only');
      creates.push({
        templateId,
        page,
        xPct,
        yPct,
        wPct,
        hPct,
        fieldType,
        label: f.label ? String(f.label) : '',
        required: !!f.required,
        order: Number.isFinite(f.order) ? f.order : i,
        valueSource,
        businessFieldId: f.businessFieldId || null,
        signerPersonId: f.signerPersonId || null,
        signerFieldKey: f.signerFieldKey || null,
        signerAssetMode: f.signerAssetMode || null,
        staticValue: f.staticValue != null ? String(f.staticValue) : null,
      });
    }

    await prisma.$transaction([
      prisma.documentField.deleteMany({ where: { templateId } }),
      ...(creates.length
        ? [prisma.documentField.createMany({ data: creates })]
        : []),
    ]);

    const after = await prisma.documentField.findMany({
      where: { templateId },
      orderBy: { order: 'asc' },
    });
    res.json(after);
  }),
);

// ── Instances ────────────────────────────────────────────────────────────────

router.get(
  '/instances',
  handle(async (req, res) => {
    const where = {};
    if (req.query.templateId) where.templateId = String(req.query.templateId);
    if (req.query.status) where.status = String(req.query.status);
    const list = await prisma.documentInstance.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        status: true,
        templateId: true,
        createdAt: true,
        updatedAt: true,
        finalizedAt: true,
        snapshotPageCount: true,
      },
    });
    res.json(list);
  }),
);

// Create instance — freezes fields + snapshot PDF + business values + signers.
// This is the single biggest invariant of the module: once this row exists,
// future template/field edits MUST NOT change what this instance renders.
router.post(
  '/instances',
  handle(async (req, res) => {
    const { templateId, title } = req.body || {};
    if (!templateId) return res.status(400).json({ error: 'templateId_required' });
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'title_required' });
    }

    const template = await prisma.documentTemplate.findUnique({
      where: { id: templateId },
      include: {
        snapshot: true,
        fields: { orderBy: { order: 'asc' } },
      },
    });
    if (!template) return res.status(400).json({ error: 'template_not_found' });

    // Collect business field snapshot (key → value map).
    const businessFields = await prisma.businessField.findMany();
    const businessSnapshot = {};
    for (const bf of businessFields) businessSnapshot[bf.id] = {
      id: bf.id,
      key: bf.key,
      label: bf.label,
      value: bf.value,
    };

    // Collect signer persons referenced by any field. Snapshot per-person
    // identity + extraFields + list of asset ids by mode. The actual asset
    // bytes stay in SignerAsset (immutable-by-convention); we only record
    // the reference so finalize can look up the latest matching asset.
    const signerIds = new Set(
      template.fields
        .filter((f) => f.signerPersonId)
        .map((f) => f.signerPersonId),
    );
    const signers = signerIds.size
      ? await prisma.signerPerson.findMany({
          where: { id: { in: [...signerIds] } },
          include: {
            assets: {
              select: { id: true, assetType: true, label: true, createdAt: true },
              orderBy: { createdAt: 'desc' },
            },
          },
        })
      : [];

    const signersSnapshot = signers.map((s) => ({
      id: s.id,
      displayName: s.displayName,
      role: s.role,
      email: s.email,
      phone: s.phone,
      extraFields: s.extraFields,
      assets: s.assets.map((a) => ({
        id: a.id,
        assetType: a.assetType,
        label: a.label,
        createdAt: a.createdAt,
      })),
    }));

    const fieldsSnapshot = template.fields.map((f) => ({
      id: f.id,
      page: f.page,
      xPct: f.xPct,
      yPct: f.yPct,
      wPct: f.wPct,
      hPct: f.hPct,
      fieldType: f.fieldType,
      label: f.label,
      required: f.required,
      order: f.order,
      valueSource: f.valueSource,
      businessFieldId: f.businessFieldId,
      signerPersonId: f.signerPersonId,
      signerFieldKey: f.signerFieldKey,
      signerAssetMode: f.signerAssetMode,
      staticValue: f.staticValue,
    }));

    const created = await prisma.documentInstance.create({
      data: {
        templateId: template.id,
        title: String(title).trim(),
        status: 'draft',
        fieldsSnapshot,
        snapshotPdfBytes: Buffer.from(template.snapshot.pdfBytes),
        snapshotPageCount: template.snapshot.pageCount,
        businessSnapshot,
        signersSnapshot,
      },
      select: {
        id: true,
        title: true,
        status: true,
        templateId: true,
        createdAt: true,
      },
    });
    res.status(201).json(created);
  }),
);

router.get(
  '/instances/:id',
  handle(async (req, res) => {
    const inst = await prisma.documentInstance.findUnique({
      where: { id: req.params.id },
      include: {
        overrides: true,
        finalDocuments: {
          orderBy: { generatedAt: 'desc' },
          select: { id: true, pdfSize: true, generatedAt: true },
        },
      },
    });
    if (!inst) return res.status(404).json({ error: 'not_found' });
    // Don't ship the heavy snapshotPdfBytes column back as base64 — client
    // fetches it separately from /instances/:id/pdf.
    const { snapshotPdfBytes, ...rest } = inst;
    res.json({ ...rest, snapshotByteSize: snapshotPdfBytes?.length ?? 0 });
  }),
);

router.get(
  '/instances/:id/pdf',
  handle(async (req, res) => {
    const inst = await prisma.documentInstance.findUnique({
      where: { id: req.params.id },
      select: { snapshotPdfBytes: true },
    });
    if (!inst) return res.status(404).json({ error: 'not_found' });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Length', String(inst.snapshotPdfBytes.length));
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(inst.snapshotPdfBytes));
  }),
);

router.delete(
  '/instances/:id',
  handle(async (req, res) => {
    const inst = await prisma.documentInstance.findUnique({
      where: { id: req.params.id },
      select: { status: true },
    });
    if (!inst) return res.status(404).json({ error: 'not_found' });
    if (inst.status === 'finalized') {
      return res.status(409).json({ error: 'cannot_delete_finalized' });
    }
    await prisma.documentInstance.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// Upsert a text override for a single field on an instance.
router.put(
  '/instances/:id/overrides/:snapshotFieldId',
  handle(async (req, res) => {
    const { id, snapshotFieldId } = req.params;
    const { textValue } = req.body || {};
    const inst = await prisma.documentInstance.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!inst) return res.status(404).json({ error: 'not_found' });
    if (inst.status === 'finalized') {
      return res.status(409).json({ error: 'instance_finalized' });
    }
    const clean = textValue == null ? null : String(textValue);
    const row = await prisma.documentInstanceOverride.upsert({
      where: { instanceId_snapshotFieldId: { instanceId: id, snapshotFieldId } },
      create: { instanceId: id, snapshotFieldId, textValue: clean },
      update: { textValue: clean, assetBytes: null },
      select: {
        id: true,
        instanceId: true,
        snapshotFieldId: true,
        textValue: true,
        updatedAt: true,
      },
    });
    res.json(row);
  }),
);

// Upload a PNG asset override for a single field on an instance.
router.put(
  '/instances/:id/overrides/:snapshotFieldId/image',
  express.raw({ type: '*/*', limit: '6mb' }),
  handle(async (req, res) => {
    const { id, snapshotFieldId } = req.params;
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return res.status(400).json({ error: 'empty_body' });
    }
    if (!isPng(body)) return res.status(400).json({ error: 'png_required' });
    if (body.length > MAX_OVERRIDE_IMAGE_BYTES) {
      return res.status(413).json({ error: 'too_large' });
    }
    const inst = await prisma.documentInstance.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!inst) return res.status(404).json({ error: 'not_found' });
    if (inst.status === 'finalized') {
      return res.status(409).json({ error: 'instance_finalized' });
    }
    await prisma.documentInstanceOverride.upsert({
      where: { instanceId_snapshotFieldId: { instanceId: id, snapshotFieldId } },
      create: { instanceId: id, snapshotFieldId, assetBytes: body },
      update: { assetBytes: body, textValue: null },
    });
    res.status(204).end();
  }),
);

router.delete(
  '/instances/:id/overrides/:snapshotFieldId',
  handle(async (req, res) => {
    const { id, snapshotFieldId } = req.params;
    const inst = await prisma.documentInstance.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!inst) return res.status(404).json({ error: 'not_found' });
    if (inst.status === 'finalized') {
      return res.status(409).json({ error: 'instance_finalized' });
    }
    await prisma.documentInstanceOverride.deleteMany({
      where: { instanceId: id, snapshotFieldId },
    });
    res.status(204).end();
  }),
);

// ── Finalize ─────────────────────────────────────────────────────────────────
//
// Resolves every field → (text value | image bytes), calls renderFinalPdf,
// saves a FinalDocument row, flips instance status to 'finalized'. Once
// finalized, the instance is immutable: no further overrides, no re-finalize.

router.post(
  '/instances/:id/finalize',
  handle(async (req, res) => {
    const inst = await prisma.documentInstance.findUnique({
      where: { id: req.params.id },
      include: { overrides: true },
    });
    if (!inst) return res.status(404).json({ error: 'not_found' });
    if (inst.status === 'finalized') {
      return res.status(409).json({ error: 'already_finalized' });
    }

    const fieldsSnapshot = Array.isArray(inst.fieldsSnapshot) ? inst.fieldsSnapshot : [];
    const businessSnapshot = inst.businessSnapshot || {};
    const signersSnapshot = Array.isArray(inst.signersSnapshot) ? inst.signersSnapshot : [];
    const overridesByField = new Map(
      inst.overrides.map((o) => [o.snapshotFieldId, o]),
    );

    // Precompute asset id → bytes lookups. We touch the live SignerAsset rows
    // (not the instance snapshot) because bytes are not JSON-friendly, but
    // the PER-PERSON asset identity is locked by the snapshot. If an admin
    // later deletes an asset, finalize will fall back to override or fail
    // that field (rendering skips fields with missing image bytes silently).
    const assetIdsNeeded = new Set();
    for (const f of fieldsSnapshot) {
      if (!f.signerPersonId || !f.signerAssetMode) continue;
      if (overridesByField.get(f.id)?.assetBytes) continue;
      const signer = signersSnapshot.find((s) => s.id === f.signerPersonId);
      if (!signer) continue;
      const match = signer.assets.find((a) => a.assetType === f.signerAssetMode);
      if (match) assetIdsNeeded.add(match.id);
    }
    const assetRows = assetIdsNeeded.size
      ? await prisma.signerAsset.findMany({
          where: { id: { in: [...assetIdsNeeded] } },
          select: { id: true, renderedBytes: true },
        })
      : [];
    const assetBytesById = new Map(
      assetRows.map((r) => [r.id, Buffer.from(r.renderedBytes)]),
    );

    // Resolve each field → either textValue or imageBytes.
    const resolved = fieldsSnapshot.map((f) => {
      const ov = overridesByField.get(f.id);
      const isImageField =
        f.fieldType === 'signature' ||
        f.fieldType === 'stamp' ||
        f.fieldType === 'combined';

      if (isImageField) {
        if (ov?.assetBytes && ov.assetBytes.length > 0) {
          return { ...f, imageBytes: Buffer.from(ov.assetBytes) };
        }
        if (f.valueSource === 'signer_asset' && f.signerPersonId && f.signerAssetMode) {
          const signer = signersSnapshot.find((s) => s.id === f.signerPersonId);
          const asset = signer?.assets?.find((a) => a.assetType === f.signerAssetMode);
          const bytes = asset ? assetBytesById.get(asset.id) : null;
          if (bytes) return { ...f, imageBytes: bytes };
        }
        // Nothing to draw — the render loop will skip this field.
        return { ...f, imageBytes: null };
      }

      // Text field → resolve text value by source.
      if (ov && ov.textValue != null) return { ...f, textValue: ov.textValue };
      if (f.valueSource === 'static') return { ...f, textValue: f.staticValue || '' };
      if (f.valueSource === 'business_field' && f.businessFieldId) {
        const bf = businessSnapshot[f.businessFieldId];
        return { ...f, textValue: bf?.value ?? '' };
      }
      if (f.valueSource === 'signer_field' && f.signerPersonId && f.signerFieldKey) {
        const signer = signersSnapshot.find((s) => s.id === f.signerPersonId);
        if (!signer) return { ...f, textValue: '' };
        const direct = signer[f.signerFieldKey];
        if (typeof direct === 'string' || typeof direct === 'number') {
          return { ...f, textValue: String(direct) };
        }
        const extra = (signer.extraFields || {})[f.signerFieldKey];
        return { ...f, textValue: extra != null ? String(extra) : '' };
      }
      return { ...f, textValue: '' };
    });

    const sourcePdf = Buffer.from(inst.snapshotPdfBytes);
    const pdfBytes = await renderFinalPdf(sourcePdf, resolved);

    const final = await prisma.$transaction(async (tx) => {
      const fd = await tx.finalDocument.create({
        data: {
          instanceId: inst.id,
          pdfBytes,
          pdfSize: pdfBytes.length,
          generatorVersion: 'v1',
        },
        select: { id: true, pdfSize: true, generatedAt: true },
      });
      await tx.documentInstance.update({
        where: { id: inst.id },
        data: { status: 'finalized', finalizedAt: new Date() },
      });
      return fd;
    });

    res.json({ instanceId: inst.id, finalDocument: final });
  }),
);

router.get(
  '/instances/:id/final',
  handle(async (req, res) => {
    // Latest final document for this instance (V1 has only one).
    const fd = await prisma.finalDocument.findFirst({
      where: { instanceId: req.params.id },
      orderBy: { generatedAt: 'desc' },
    });
    if (!fd) return res.status(404).json({ error: 'not_found' });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Length', String(fd.pdfSize));
    res.set(
      'Content-Disposition',
      `attachment; filename="document-${fd.id}.pdf"`,
    );
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(fd.pdfBytes));
  }),
);

function clamp01to100(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

export default router;
