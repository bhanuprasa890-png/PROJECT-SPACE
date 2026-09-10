import { Router } from 'express';
import { getDb } from '../db/client';
import {
  fetchDatasetPage,
  listDatasetColumns,
  listDatasetTables,
  refreshDataset,
} from '../repositories/dataset.repo';
import { findDatasetTable } from '../../shared/dataset';
import type { DatasetOverview } from '../../shared/types';

export const datasetRouter = Router();

/**
 * Canonical demo dataset — the tables a client, analyst or BI tool reads
 * directly. Everything here is generated DEMO / SIMULATED data, reconstructed
 * from the network model by `fn_refresh_demo_dataset()`.
 */

/** Every published table with its live row count. */
datasetRouter.get('/dataset/tables', async (_req, res) => {
  const db = await getDb();
  const tables = await listDatasetTables(db);

  const payload: DatasetOverview = {
    driver: db.kind,
    schemaVersion: null,
    source: db.kind,
    dataClassification: 'demo-simulated',
    generatedAt: new Date().toISOString(),
    tables,
    totals: {
      tables: tables.filter((table) => table.kind === 'table').length,
      views: tables.filter((table) => table.kind === 'view').length,
      rows: tables.filter((table) => table.kind === 'table').reduce((sum, t) => sum + t.rowCount, 0),
    },
  };

  res.json(payload);
});

/** Records for one table, paginated and sorted. */
datasetRouter.get('/dataset/tables/:table', async (req, res) => {
  const db = await getDb();
  const name = String(req.params.table ?? '');
  const def = findDatasetTable(name);

  if (!def) {
    res.status(404).json({
      error: {
        message: `Unknown dataset table '${name}'`,
        code: 'DATASET_TABLE_NOT_FOUND',
      },
    });
    return;
  }

  const limit = Number(req.query.limit ?? 25);
  const offset = Number(req.query.offset ?? 0);
  const orderBy = req.query.orderBy ? String(req.query.orderBy) : undefined;
  const direction = req.query.direction === 'desc' ? 'desc' : undefined;

  try {
    const page = await fetchDatasetPage(db, { table: name, limit, offset, orderBy, direction });
    res.json(page);
  } catch (error) {
    const message = (error as Error).message;
    const isBadColumn = message.startsWith('Unknown or unsortable column');
    res.status(isBadColumn ? 400 : 500).json({
      error: {
        message,
        code: isBadColumn ? 'DATASET_BAD_COLUMN' : 'DATASET_QUERY_FAILED',
        details: { table: name, orderBy: orderBy ?? null },
      },
    });
  }
});

/** Column definitions only — handy for schema clients. */
datasetRouter.get('/dataset/schema/:table', async (req, res) => {
  const db = await getDb();
  const name = String(req.params.table ?? '');
  const def = findDatasetTable(name);

  if (!def) {
    res.status(404).json({
      error: { message: `Unknown dataset table '${name}'`, code: 'DATASET_TABLE_NOT_FOUND' },
    });
    return;
  }

  res.json({ table: def.name, requestedAs: def.requestedAs, columns: await listDatasetColumns(db, def.name) });
});

/** Rebuild the canonical dataset from the current network state. */
datasetRouter.post('/dataset/refresh', async (_req, res) => {
  const db = await getDb();
  const counts = await refreshDataset(db);
  res.json({ refreshedAt: new Date().toISOString(), counts });
});
