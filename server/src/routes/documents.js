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

// ── Document-first composite upload ──────────────────────────────────────────
//
// Primary entry point for the new UX: raw PDF bytes in → (source + passthrough
// snapshot + silent adhoc template + empty draft instance) out in one atomic
// transaction. Client redirects straight into the instance editor; user never
// sees the template step.
router.post(
  '/new',
  express.raw({ type: '*/*', limit: '30mb' }),
  handle(async (req, res) => {
    const body = req.body;
    const filename = String(req.query.filename || 'document.pdf').slice(0, 200);
    const title = stripPdfExt(filename) || 'מסמך חדש';

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

    // Snapshot business field + signer state at instance-creation time (same
    // logic as POST /instances but inlined for atomicity). Adhoc template is
    // created with origin='adhoc' so it doesn't pollute the library list.
    const businessFields = await prisma.businessField.findMany();
    const businessSnapshot = {};
    for (const bf of businessFields) {
      businessSnapshot[bf.id] = {
        id: bf.id,
        key: bf.key,
        label: bf.label,
        valueHe: bf.valueHe,
        valueEn: bf.valueEn,
      };
    }

    const result = await prisma.$transaction(async (tx) => {
      const src = await tx.documentSource.create({
        data: {
          filename,
          mimeType: 'application/pdf',
          sourceKind: 'pdf',
          bytes: body,
          byteSize: body.length,
        },
      });
      const snap = await tx.documentSnapshot.create({
        data: {
          sourceId: src.id,
          pdfBytes: body,
          pageCount,
          generator: 'passthrough',
          generatorVersion: 'v1',
        },
      });
      const tpl = await tx.documentTemplate.create({
        data: {
          title,
          snapshotId: snap.id,
          origin: 'adhoc',
        },
      });
      const inst = await tx.documentInstance.create({
        data: {
          templateId: tpl.id,
          title,
          status: 'draft',
          fieldsSnapshot: [],
          snapshotPdfBytes: body,
          snapshotPageCount: pageCount,
          businessSnapshot,
          signersSnapshot: [],
        },
        select: { id: true, title: true, status: true, createdAt: true },
      });
      return { instance: inst, templateId: tpl.id };
    });

    res.status(201).json(result);
  }),
);

// ── Templates ────────────────────────────────────────────────────────────────
//
// GET /templates returns library-origin templates only by default. Pass
// `?origin=all` to include adhoc (used nowhere in the UI; diagnostic only).

router.get(
  '/templates',
  handle(async (req, res) => {
    const where = req.query.origin === 'all' ? {} : { origin: 'library' };
    const templates = await prisma.documentTemplate.findMany({
      where,
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
        language: f.language === 'en' ? 'en' : 'he',
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
      valueHe: bf.valueHe,
      valueEn: bf.valueEn,
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
      language: f.language || 'he',
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
      select: { status: true, templateId: true },
    });
    if (!inst) return res.status(404).json({ error: 'not_found' });
    if (inst.status === 'finalized') {
      return res.status(409).json({ error: 'cannot_delete_finalized' });
    }
    // Delete the instance; if it was attached to an adhoc template that has
    // no other instances, drop the adhoc template too (it exists only to
    // support the single instance that just got deleted).
    await prisma.$transaction(async (tx) => {
      await tx.documentInstance.delete({ where: { id: req.params.id } });
      const tpl = await tx.documentTemplate.findUnique({
        where: { id: inst.templateId },
        select: { origin: true, snapshotId: true, _count: { select: { instances: true } } },
      });
      if (tpl && tpl.origin === 'adhoc' && tpl._count.instances === 0) {
        await tx.documentTemplate.delete({ where: { id: inst.templateId } });
        // Snapshot & source cascade via DocumentSnapshot -> DocumentSource FK
        // only if we explicitly delete the snapshot; but DocumentTemplate ->
        // snapshot is RESTRICT, so we must delete it after the template.
        try {
          await tx.documentSnapshot.delete({ where: { id: tpl.snapshotId } });
          // Source cascades from snapshot (CASCADE on sourceId), so no extra work.
        } catch {
          // Another template could be referencing this snapshot — leave it.
        }
      }
    });
    res.status(204).end();
  }),
);

// Replace the instance's fieldsSnapshot (draft-only). This is the new
// instance-first placement save — placements live on the instance, not the
// template, so edits cannot retroactively affect other instances.
router.put(
  '/instances/:id/fields',
  handle(async (req, res) => {
    const { fields } = req.body || {};
    if (!Array.isArray(fields)) {
      return res.status(400).json({ error: 'fields_array_required' });
    }
    const inst = await prisma.documentInstance.findUnique({
      where: { id: req.params.id },
      select: { status: true, templateId: true },
    });
    if (!inst) return res.status(404).json({ error: 'not_found' });
    if (inst.status === 'finalized') {
      return res.status(409).json({ error: 'instance_finalized' });
    }

    const normalised = fields.map((f, i) => normalisePlacement(f, i));

    // Refresh the signers snapshot in case new signer bindings were added.
    // Business snapshot is refreshed too — values may have changed since
    // the instance was created, and the user expects live preview to show
    // the current business field value while the instance is still draft.
    const signerIds = new Set(
      normalised.filter((f) => f.signerPersonId).map((f) => f.signerPersonId),
    );
    const signers = signerIds.size
      ? await prisma.signerPerson.findMany({
          where: { id: { in: [...signerIds] } },
          include: {
            assets: {
              select: {
                id: true,
                assetType: true,
                label: true,
                createdAt: true,
              },
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
      assets: s.assets,
    }));

    const businessFields = await prisma.businessField.findMany();
    const businessSnapshot = {};
    for (const bf of businessFields) {
      businessSnapshot[bf.id] = {
        id: bf.id,
        key: bf.key,
        label: bf.label,
        valueHe: bf.valueHe,
        valueEn: bf.valueEn,
      };
    }

    await prisma.documentInstance.update({
      where: { id: req.params.id },
      data: {
        fieldsSnapshot: normalised,
        signersSnapshot,
        businessSnapshot,
      },
    });
    res.json({ fields: normalised });
  }),
);

// Replace the instance's annotationsSnapshot (draft-only). Annotations are
// purely visual markup — no value resolution, no bindings. Stored separately
// from fieldsSnapshot.
router.put(
  '/instances/:id/annotations',
  handle(async (req, res) => {
    const { annotations } = req.body || {};
    if (!Array.isArray(annotations)) {
      return res.status(400).json({ error: 'annotations_array_required' });
    }
    const inst = await prisma.documentInstance.findUnique({
      where: { id: req.params.id },
      select: { status: true },
    });
    if (!inst) return res.status(404).json({ error: 'not_found' });
    if (inst.status === 'finalized') {
      return res.status(409).json({ error: 'instance_finalized' });
    }
    const normalised = annotations.map((a, i) => normaliseAnnotation(a, i));
    await prisma.documentInstance.update({
      where: { id: req.params.id },
      data: { annotationsSnapshot: normalised },
    });
    res.json({ annotations: normalised });
  }),
);

// Save the current instance placements as a new library template.
// Creates: DocumentTemplate (origin='library') + DocumentField rows that
// mirror the instance's fieldsSnapshot + reuses the instance's snapshot.
router.post(
  '/instances/:id/save-as-template',
  handle(async (req, res) => {
    const { title, description } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'title_required' });
    }
    const inst = await prisma.documentInstance.findUnique({
      where: { id: req.params.id },
      include: { template: { select: { snapshotId: true } } },
    });
    if (!inst) return res.status(404).json({ error: 'not_found' });
    const fieldsSnapshot = Array.isArray(inst.fieldsSnapshot) ? inst.fieldsSnapshot : [];
    const snapshotId = inst.template?.snapshotId;
    if (!snapshotId) return res.status(500).json({ error: 'snapshot_missing' });

    const tpl = await prisma.$transaction(async (tx) => {
      const t = await tx.documentTemplate.create({
        data: {
          title: String(title).trim(),
          description: description ? String(description) : null,
          snapshotId,
          origin: 'library',
        },
      });
      if (fieldsSnapshot.length > 0) {
        await tx.documentField.createMany({
          data: fieldsSnapshot.map((f, i) => ({
            templateId: t.id,
            page: f.page,
            xPct: f.xPct,
            yPct: f.yPct,
            wPct: f.wPct,
            hPct: f.hPct,
            fieldType: f.fieldType,
            label: f.label || '',
            required: !!f.required,
            order: Number.isFinite(f.order) ? f.order : i,
            valueSource: f.valueSource,
            businessFieldId: f.businessFieldId || null,
            signerPersonId: f.signerPersonId || null,
            signerFieldKey: f.signerFieldKey || null,
            signerAssetMode: f.signerAssetMode || null,
            staticValue: f.staticValue || null,
            language: f.language === 'en' ? 'en' : 'he',
          })),
        });
      }
      return t;
    });
    res.status(201).json(tpl);
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
      let textValue = '';
      if (ov && ov.textValue != null) textValue = ov.textValue;
      else if (f.valueSource === 'static') textValue = f.staticValue || '';
      else if (f.valueSource === 'business_field' && f.businessFieldId) {
        const bf = businessSnapshot[f.businessFieldId];
        textValue = resolveBusinessFieldValue(bf, f.language);
      } else if (
        f.valueSource === 'signer_field' &&
        f.signerPersonId &&
        f.signerFieldKey
      ) {
        const signer = signersSnapshot.find((s) => s.id === f.signerPersonId);
        if (signer) {
          const direct = signer[f.signerFieldKey];
          if (typeof direct === 'string' || typeof direct === 'number') {
            textValue = String(direct);
          } else {
            const extra = (signer.extraFields || {})[f.signerFieldKey];
            textValue = extra != null ? String(extra) : '';
          }
        }
      }
      // Date fallback: empty date fields auto-fill with today's date so a
      // placed date never renders blank. Overrides / bound values take
      // precedence if present.
      if (f.fieldType === 'date' && !String(textValue).trim()) {
        textValue = todayIso();
      }
      return { ...f, textValue };
    });

    const annotationsSnapshot = Array.isArray(inst.annotationsSnapshot)
      ? inst.annotationsSnapshot
      : [];

    const sourcePdf = Buffer.from(inst.snapshotPdfBytes);
    const pdfBytes = await renderFinalPdf(sourcePdf, resolved, annotationsSnapshot);

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

function stripPdfExt(name) {
  return String(name || '').replace(/\.pdf$/i, '').trim();
}

// Normalise a raw placement object into the shape we persist in fieldsSnapshot
// (same shape as DocumentField rows). Used by both PUT /instances/:id/fields
// and save-as-template. Client-assigned ids (e.g. local_xyz) are preserved so
// overrides keep resolving across saves.
function normalisePlacement(f, i) {
  return {
    id: String(f.id || `local_${Math.random().toString(36).slice(2, 10)}`),
    page: Math.max(1, Number(f.page || 1)),
    xPct: clamp01to100(f.xPct),
    yPct: clamp01to100(f.yPct),
    wPct: clamp01to100(f.wPct),
    hPct: clamp01to100(f.hPct),
    fieldType: String(f.fieldType || 'text'),
    label: f.label ? String(f.label) : '',
    required: !!f.required,
    order: Number.isFinite(f.order) ? f.order : i,
    valueSource: String(f.valueSource || 'override_only'),
    businessFieldId: f.businessFieldId || null,
    signerPersonId: f.signerPersonId || null,
    signerFieldKey: f.signerFieldKey || null,
    signerAssetMode: f.signerAssetMode || null,
    staticValue: f.staticValue != null ? String(f.staticValue) : null,
    language: f.language === 'en' ? 'en' : 'he',
  };
}

// Resolve a business field's display value given a language selector.
// Accepts both shapes: new bilingual { valueHe, valueEn } and pre-migration
// { value } (back-compat for finalized instances whose businessSnapshot was
// frozen before the bilingual change).
//
// HE → EN fallback: if the selected language is Hebrew but valueHe is empty
// and valueEn has content, fall back to valueEn. This prevents silently-empty
// fields for business values that only have English text. The fallback is
// one-way: English with empty valueEn stays empty (strict, per spec).
function resolveBusinessFieldValue(bf, language) {
  if (!bf) return '';
  if (bf.valueHe !== undefined || bf.valueEn !== undefined) {
    const he = bf.valueHe || '';
    const en = bf.valueEn || '';
    if (language === 'en') return en;
    return he || en; // HE default with EN fallback when HE is empty
  }
  return bf.value ?? '';
}

// Today's date in ISO (YYYY-MM-DD). Used as an auto-default for date fields
// that have no override and no static/bound value — so the placed field
// shows a real date instead of an empty box.
// Normalise a raw annotation into the shape we persist. Keeps only the
// fields we recognise per-kind, drops anything else (defence in depth).
// Client-generated ids are preserved (needed to keep selection stable
// across saves; same pattern as field placements).
const ANN_KINDS = new Set(['check', 'x', 'highlight', 'line', 'note']);
function normaliseAnnotation(a, i) {
  const kind = ANN_KINDS.has(a?.kind) ? a.kind : 'check';
  const base = {
    id: String(a.id || `ann_${Math.random().toString(36).slice(2, 10)}`),
    kind,
    page: Math.max(1, Number(a.page || 1)),
    xPct: clamp01to100(a.xPct),
    yPct: clamp01to100(a.yPct),
    wPct: clamp01to100(a.wPct),
    hPct: clamp01to100(a.hPct),
    order: Number.isFinite(a.order) ? a.order : i,
  };
  if (kind === 'highlight') {
    return {
      ...base,
      color: typeof a.color === 'string' ? a.color : '#fde047',
      opacity: Number.isFinite(a.opacity) ? clamp01(a.opacity) : 0.35,
    };
  }
  if (kind === 'line') {
    return {
      ...base,
      color: typeof a.color === 'string' ? a.color : '#111827',
      thickness: Number.isFinite(a.thickness) ? Math.max(0.5, Math.min(10, a.thickness)) : 2,
      orientation: a.orientation === 'vertical' ? 'vertical' : 'horizontal',
    };
  }
  if (kind === 'note') {
    return {
      ...base,
      text: a.text != null ? String(a.text) : '',
      fontSize: Number.isFinite(a.fontSize) ? Math.max(8, Math.min(48, a.fontSize)) : 12,
      color: typeof a.color === 'string' ? a.color : '#111827',
    };
  }
  // check / x
  return {
    ...base,
    color: typeof a.color === 'string' ? a.color : kind === 'x' ? '#b91c1c' : '#111827',
    thickness: Number.isFinite(a.thickness) ? Math.max(1, Math.min(10, a.thickness)) : 3,
  };
}

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default router;
