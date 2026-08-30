//! Local Company Brain knowledge layer — entities, skills, provenance.

pub mod commands;
pub mod store;

use serde::{Deserialize, Serialize};

pub const KIND_POLICY: &str = "policy";
pub const KIND_PROCESS: &str = "process";
pub const KIND_DECISION: &str = "decision";

pub const STATUS_DRAFT: &str = "draft";
pub const STATUS_CONFIRMED: &str = "confirmed";
pub const STATUS_REJECTED: &str = "rejected";

pub const TARGET_ENTITY: &str = "entity";
pub const TARGET_SKILL: &str = "skill";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeEntityDto {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub status: String,
    pub version: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_confirmed_at: Option<i64>,
    pub sources: Vec<KnowledgeSourceDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDto {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub yaml_body: String,
    pub status: String,
    pub version: i64,
    pub entity_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_confirmed_at: Option<i64>,
    pub sources: Vec<KnowledgeSourceDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSourceDto {
    pub id: String,
    pub target_kind: String,
    pub target_id: String,
    pub source_type: String,
    pub ref_id: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEntityInput {
    pub kind: String,
    pub title: String,
    pub body: String,
    pub status: Option<String>,
    pub sources: Option<Vec<SourceInput>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSkillInput {
    pub slug: String,
    pub title: String,
    pub yaml_body: String,
    pub status: Option<String>,
    pub entity_id: Option<String>,
    pub sources: Option<Vec<SourceInput>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInput {
    pub source_type: String,
    pub ref_id: String,
    pub snippet: Option<String>,
}
