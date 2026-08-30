//! Tauri IPC for the Company Brain knowledge layer.

use tauri::AppHandle;

use crate::knowledge::store;
use crate::knowledge::{
    KnowledgeEntityDto, SaveEntityInput, SaveSkillInput, SkillDto,
};

#[tauri::command]
pub async fn list_knowledge_entities(
    app: AppHandle,
    status: Option<String>,
) -> Result<Vec<KnowledgeEntityDto>, String> {
    store::list_entities(&app, status).await
}

#[tauri::command]
pub async fn list_skills(
    app: AppHandle,
    status: Option<String>,
) -> Result<Vec<SkillDto>, String> {
    store::list_skills(&app, status).await
}

#[tauri::command]
pub async fn list_confirmed_skills(app: AppHandle) -> Result<Vec<SkillDto>, String> {
    store::list_skills(&app, Some("confirmed".into())).await
}

#[tauri::command]
pub async fn save_knowledge_entity(
    app: AppHandle,
    input: SaveEntityInput,
) -> Result<KnowledgeEntityDto, String> {
    store::save_entity(&app, input).await
}

#[tauri::command]
pub async fn save_skill(app: AppHandle, input: SaveSkillInput) -> Result<SkillDto, String> {
    store::save_skill(&app, input).await
}

#[tauri::command]
pub async fn set_knowledge_entity_status(
    app: AppHandle,
    id: String,
    status: String,
) -> Result<KnowledgeEntityDto, String> {
    store::set_entity_status(&app, &id, &status).await
}

#[tauri::command]
pub async fn set_skill_status(
    app: AppHandle,
    id: String,
    status: String,
) -> Result<SkillDto, String> {
    store::set_skill_status(&app, &id, &status).await
}

#[tauri::command]
pub async fn export_confirmed_knowledge(app: AppHandle) -> Result<String, String> {
    store::export_confirmed_json(&app).await
}
