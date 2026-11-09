/**
 * Journal d'audit des actions d'administration (migrations/0006).
 * Jamais de donnée personnelle : une action, une cible technique, un détail
 * court (ex. « REVIEWING → SHORTLISTED »). Un échec d'écriture du journal ne
 * doit jamais bloquer l'action elle-même : il est ignoré.
 */
export type AuditTarget = "application" | "inquiry" | "contact" | "opportunity";

export function auditStatement(db: D1Database, action: string, targetType: AuditTarget, targetId: string, detail?: string): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO admin_audit (id, created_at, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), new Date().toISOString(), action, targetType, targetId, detail ? detail.slice(0, 200) : null);
}

export async function audit(db: D1Database, action: string, targetType: AuditTarget, targetId: string, detail?: string): Promise<void> {
  try {
    await auditStatement(db, action, targetType, targetId, detail).run();
  } catch {
    // Journal indisponible : l'action reste valable, rien n'est bloqué.
  }
}
