//! SQLite CRUD for knowledge_entities, skills, knowledge_sources.

use sqlx::Row;
use tauri::AppHandle;
use uuid::Uuid;

use crate::context_db::ContextDb;
use crate::knowledge::{
    KnowledgeEntityDto, KnowledgeSourceDto, SaveEntityInput, SaveSkillInput, SkillDto,
    SourceInput, STATUS_CONFIRMED, STATUS_DRAFT, TARGET_ENTITY, TARGET_SKILL,
};

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

async fn sources_for(
    pool: &sqlx::SqlitePool,
    target_kind: &str,
    target_id: &str,
) -> Result<Vec<KnowledgeSourceDto>, String> {
    let rows = sqlx::query(
        "SELECT id, target_kind, target_id, source_type, ref_id, snippet
         FROM knowledge_sources
         WHERE target_kind = ? AND target_id = ?",
    )
    .bind(target_kind)
    .bind(target_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("knowledge_sources list: {e}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(KnowledgeSourceDto {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            target_kind: row.try_get("target_kind").map_err(|e| e.to_string())?,
            target_id: row.try_get("target_id").map_err(|e| e.to_string())?,
            source_type: row.try_get("source_type").map_err(|e| e.to_string())?,
            ref_id: row.try_get("ref_id").map_err(|e| e.to_string())?,
            snippet: row.try_get("snippet").map_err(|e| e.to_string())?,
        });
    }
    Ok(out)
}

async fn replace_sources(
    pool: &sqlx::SqlitePool,
    target_kind: &str,
    target_id: &str,
    sources: &[SourceInput],
) -> Result<(), String> {
    sqlx::query("DELETE FROM knowledge_sources WHERE target_kind = ? AND target_id = ?")
        .bind(target_kind)
        .bind(target_id)
        .execute(pool)
        .await
        .map_err(|e| format!("knowledge_sources clear: {e}"))?;

    for src in sources {
        let id = Uuid::new_v4().to_string();
        let snippet = src.snippet.clone().unwrap_or_default();
        sqlx::query(
            "INSERT INTO knowledge_sources
             (id, target_kind, target_id, source_type, ref_id, snippet)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(target_kind)
        .bind(target_id)
        .bind(&src.source_type)
        .bind(&src.ref_id)
        .bind(&snippet)
        .execute(pool)
        .await
        .map_err(|e| format!("knowledge_sources insert: {e}"))?;
    }
    Ok(())
}

pub async fn list_entities(
    app: &AppHandle,
    status_filter: Option<String>,
) -> Result<Vec<KnowledgeEntityDto>, String> {
    let db = ContextDb::open(app).await?;
    let pool = db.pool();

    let rows = if let Some(status) = status_filter.filter(|s| !s.is_empty()) {
        sqlx::query(
            "SELECT id, kind, title, body, status, version, created_at, updated_at, last_confirmed_at
             FROM knowledge_entities WHERE status = ? ORDER BY updated_at DESC",
        )
        .bind(status)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query(
            "SELECT id, kind, title, body, status, version, created_at, updated_at, last_confirmed_at
             FROM knowledge_entities ORDER BY updated_at DESC",
        )
        .fetch_all(pool)
        .await
    }
    .map_err(|e| format!("list_entities: {e}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let id: String = row.try_get("id").map_err(|e| e.to_string())?;
        let sources = sources_for(pool, TARGET_ENTITY, &id).await?;
        out.push(KnowledgeEntityDto {
            id,
            kind: row.try_get("kind").map_err(|e| e.to_string())?,
            title: row.try_get("title").map_err(|e| e.to_string())?,
            body: row.try_get("body").map_err(|e| e.to_string())?,
            status: row.try_get("status").map_err(|e| e.to_string())?,
            version: row.try_get("version").map_err(|e| e.to_string())?,
            created_at: row.try_get("created_at").map_err(|e| e.to_string())?,
            updated_at: row.try_get("updated_at").map_err(|e| e.to_string())?,
            last_confirmed_at: row.try_get("last_confirmed_at").ok(),
            sources,
        });
    }
    Ok(out)
}

pub async fn list_skills(
    app: &AppHandle,
    status_filter: Option<String>,
) -> Result<Vec<SkillDto>, String> {
    let db = ContextDb::open(app).await?;
    let pool = db.pool();

    let rows = if let Some(status) = status_filter.filter(|s| !s.is_empty()) {
        sqlx::query(
            "SELECT id, slug, title, yaml_body, status, version, entity_id,
                    created_at, updated_at, last_confirmed_at
             FROM skills WHERE status = ? ORDER BY updated_at DESC",
        )
        .bind(status)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query(
            "SELECT id, slug, title, yaml_body, status, version, entity_id,
                    created_at, updated_at, last_confirmed_at
             FROM skills ORDER BY updated_at DESC",
        )
        .fetch_all(pool)
        .await
    }
    .map_err(|e| format!("list_skills: {e}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let id: String = row.try_get("id").map_err(|e| e.to_string())?;
        let sources = sources_for(pool, TARGET_SKILL, &id).await?;
        out.push(SkillDto {
            id,
            slug: row.try_get("slug").map_err(|e| e.to_string())?,
            title: row.try_get("title").map_err(|e| e.to_string())?,
            yaml_body: row.try_get("yaml_body").map_err(|e| e.to_string())?,
            status: row.try_get("status").map_err(|e| e.to_string())?,
            version: row.try_get("version").map_err(|e| e.to_string())?,
            entity_id: row.try_get("entity_id").ok(),
            created_at: row.try_get("created_at").map_err(|e| e.to_string())?,
            updated_at: row.try_get("updated_at").map_err(|e| e.to_string())?,
            last_confirmed_at: row.try_get("last_confirmed_at").ok(),
            sources,
        });
    }
    Ok(out)
}

pub async fn save_entity(
    app: &AppHandle,
    input: SaveEntityInput,
) -> Result<KnowledgeEntityDto, String> {
    let kind = input.kind.trim().to_lowercase();
    if !matches!(kind.as_str(), "policy" | "process" | "decision") {
        return Err("kind must be policy, process, or decision".into());
    }
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return Err("title is required".into());
    }
    let status = input
        .status
        .unwrap_or_else(|| STATUS_DRAFT.to_string())
        .to_lowercase();
    let now = now_secs();
    let id = Uuid::new_v4().to_string();
    let db = ContextDb::open(app).await?;
    let pool = db.pool();

    sqlx::query(
        "INSERT INTO knowledge_entities
         (id, kind, title, body, status, version, created_at, updated_at, last_confirmed_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, NULL)",
    )
    .bind(&id)
    .bind(&kind)
    .bind(&title)
    .bind(&input.body)
    .bind(&status)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|e| format!("save_entity: {e}"))?;

    let sources = input.sources.unwrap_or_default();
    replace_sources(pool, TARGET_ENTITY, &id, &sources).await?;

    Ok(KnowledgeEntityDto {
        id: id.clone(),
        kind,
        title,
        body: input.body,
        status,
        version: 1,
        created_at: now,
        updated_at: now,
        last_confirmed_at: None,
        sources: sources_for(pool, TARGET_ENTITY, &id).await?,
    })
}

pub async fn save_skill(app: &AppHandle, input: SaveSkillInput) -> Result<SkillDto, String> {
    let slug = input
        .slug
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect::<String>();
    if slug.is_empty() {
        return Err("slug is required".into());
    }
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return Err("title is required".into());
    }
    let status = input
        .status
        .unwrap_or_else(|| STATUS_DRAFT.to_string())
        .to_lowercase();
    let now = now_secs();
    let id = Uuid::new_v4().to_string();
    let db = ContextDb::open(app).await?;
    let pool = db.pool();

    // Upsert by slug — reconnect distillation overwrites drafts with same slug
    let existing = sqlx::query("SELECT id, version FROM skills WHERE slug = ? LIMIT 1")
        .bind(&slug)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("skills lookup: {e}"))?;

    let (id, version, created_at) = if let Some(row) = existing {
        let eid: String = row.try_get("id").map_err(|e| e.to_string())?;
        let ver: i64 = row.try_get("version").map_err(|e| e.to_string())?;
        sqlx::query(
            "UPDATE skills SET title = ?, yaml_body = ?, status = ?, entity_id = ?,
             updated_at = ? WHERE id = ?",
        )
        .bind(&title)
        .bind(&input.yaml_body)
        .bind(&status)
        .bind(&input.entity_id)
        .bind(now)
        .bind(&eid)
        .execute(pool)
        .await
        .map_err(|e| format!("skills update: {e}"))?;
        (eid, ver, now)
    } else {
        sqlx::query(
            "INSERT INTO skills
             (id, slug, title, yaml_body, status, version, entity_id, created_at, updated_at, last_confirmed_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, NULL)",
        )
        .bind(&id)
        .bind(&slug)
        .bind(&title)
        .bind(&input.yaml_body)
        .bind(&status)
        .bind(&input.entity_id)
        .bind(now)
        .bind(now)
        .execute(pool)
        .await
        .map_err(|e| format!("skills insert: {e}"))?;
        (id, 1, now)
    };

    let sources = input.sources.unwrap_or_default();
    replace_sources(pool, TARGET_SKILL, &id, &sources).await?;

    Ok(SkillDto {
        id: id.clone(),
        slug,
        title,
        yaml_body: input.yaml_body,
        status,
        version,
        entity_id: input.entity_id,
        created_at,
        updated_at: now,
        last_confirmed_at: None,
        sources: sources_for(pool, TARGET_SKILL, &id).await?,
    })
}

pub async fn set_entity_status(
    app: &AppHandle,
    id: &str,
    status: &str,
) -> Result<KnowledgeEntityDto, String> {
    let status = status.to_lowercase();
    if !matches!(status.as_str(), "draft" | "confirmed" | "rejected") {
        return Err("invalid status".into());
    }
    let now = now_secs();
    let db = ContextDb::open(app).await?;
    let pool = db.pool();
    let confirmed_at = if status == STATUS_CONFIRMED {
        Some(now)
    } else {
        None
    };

    if status == STATUS_CONFIRMED {
        sqlx::query(
            "UPDATE knowledge_entities SET status = ?, updated_at = ?, last_confirmed_at = ?,
             version = version + 1 WHERE id = ?",
        )
        .bind(&status)
        .bind(now)
        .bind(confirmed_at)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| format!("set_entity_status: {e}"))?;
    } else {
        sqlx::query(
            "UPDATE knowledge_entities SET status = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&status)
        .bind(now)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| format!("set_entity_status: {e}"))?;
    }

    list_entities(app, None)
        .await?
        .into_iter()
        .find(|e| e.id == id)
        .ok_or_else(|| format!("entity not found: {id}"))
}

pub async fn set_skill_status(
    app: &AppHandle,
    id: &str,
    status: &str,
) -> Result<SkillDto, String> {
    let status = status.to_lowercase();
    if !matches!(status.as_str(), "draft" | "confirmed" | "rejected") {
        return Err("invalid status".into());
    }
    let now = now_secs();
    let db = ContextDb::open(app).await?;
    let pool = db.pool();

    if status == STATUS_CONFIRMED {
        sqlx::query(
            "UPDATE skills SET status = ?, updated_at = ?, last_confirmed_at = ?,
             version = version + 1 WHERE id = ?",
        )
        .bind(&status)
        .bind(now)
        .bind(now)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| format!("set_skill_status: {e}"))?;
    } else {
        sqlx::query("UPDATE skills SET status = ?, updated_at = ? WHERE id = ?")
            .bind(&status)
            .bind(now)
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| format!("set_skill_status: {e}"))?;
    }

    list_skills(app, None)
        .await?
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| format!("skill not found: {id}"))
}

pub async fn export_confirmed_json(app: &AppHandle) -> Result<String, String> {
    let entities = list_entities(app, Some(STATUS_CONFIRMED.to_string())).await?;
    let skills = list_skills(app, Some(STATUS_CONFIRMED.to_string())).await?;
    serde_json::to_string_pretty(&serde_json::json!({
        "exportedAt": now_secs(),
        "entities": entities,
        "skills": skills,
    }))
    .map_err(|e| format!("export json: {e}"))
}
