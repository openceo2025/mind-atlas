// MindAtlas β（空間UI）のテーブルを作る。既存テーブルには触れない（create if not exists のみ）。
// デプロイでは本番 DB のバックアップを取ったあとに実行する。
import { pool } from "./service-db.mjs";
import { migrateSpatialDatabase } from "./spatial-service.mjs";

try {
  await migrateSpatialDatabase();
  const { rows } = await pool.query(
    "select table_name from information_schema.tables where table_schema = current_schema() and table_name like 'spatial_%' order by table_name",
  );
  console.log(`spatial migration ok: ${rows.map((r) => r.table_name).join(", ")}`);
} finally {
  await pool.end();
}
