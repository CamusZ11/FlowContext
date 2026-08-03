use anyhow::{Context, Result};
use reqwest::{Client as HttpClient, Method, StatusCode};
use secrecy::{ExposeSecret, SecretString};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::path::Path;
use uuid::Uuid;

#[derive(Clone)]
pub struct FlowContextClient {
    base_url: String,
    token: SecretString,
    http: HttpClient,
}

#[derive(Debug, Deserialize)]
pub struct CreatedRecord {
    pub id: String,
    #[serde(flatten)]
    pub fields: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HandoffCreate {
    pub session_id: String,
    pub topic_card_id: String,
    pub content: String,
    pub idempotency_key: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionStart {
    pub topic_card_id: String,
    pub codex_thread_id: String,
    pub device_id: String,
    pub workspace_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionSnapshot {
    pub schema_version: u8,
    pub date: String,
    pub device_id: String,
    pub projects: Vec<ProjectProjection>,
    pub daily: DailyProjection,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectProjection {
    pub id: Option<String>,
    pub project_key: String,
    pub title: String,
    pub lifecycle_status: String,
    pub summary: String,
    pub next_action: String,
    #[serde(default)]
    pub source_path: Option<String>,
    #[serde(default)]
    pub last_synced_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyProjection {
    pub date: String,
    pub daily_lens: String,
    pub projects: Vec<serde_json::Value>,
    #[serde(default)]
    pub mac_report: Option<String>,
    #[serde(default)]
    pub windows_report: Option<String>,
}

impl FlowContextClient {
    pub fn new(base_url: impl Into<String>, token: SecretString) -> Result<Self> {
        let base_url = base_url.into().trim_end_matches('/').to_owned();
        if base_url.is_empty() {
            anyhow::bail!("FlowContext API URL is required");
        }
        let http = HttpClient::builder()
            .user_agent("flowcontext-cli/0.1")
            .build()
            .context("create HTTP client")?;
        Ok(Self {
            base_url,
            token,
            http,
        })
    }

    pub fn with_http(
        base_url: impl Into<String>,
        token: SecretString,
        http: HttpClient,
    ) -> Result<Self> {
        let base_url = base_url.into().trim_end_matches('/').to_owned();
        if base_url.is_empty() {
            anyhow::bail!("FlowContext API URL is required");
        }
        Ok(Self {
            base_url,
            token,
            http,
        })
    }

    pub async fn create_handoff(&self, input: &HandoffCreate) -> Result<CreatedRecord> {
        self.request(Method::POST, "/v1/handoffs", Some(input))
            .await
    }

    pub async fn start_session(&self, input: &SessionStart) -> Result<CreatedRecord> {
        self.request(Method::POST, "/v1/sessions", Some(input))
            .await
    }

    pub async fn complete_topic(&self, topic_id: &str, explicit: bool) -> Result<CreatedRecord> {
        if !explicit {
            anyhow::bail!("explicit topic completion required");
        }
        let body = serde_json::json!({"explicit": true});
        self.request(
            Method::POST,
            &format!("/v1/topics/{}/complete", encode_path(topic_id)),
            Some(&body),
        )
        .await
    }

    pub async fn push_projection(&self, snapshot: &ProjectionSnapshot) -> Result<Vec<String>> {
        if snapshot.schema_version != 1 {
            anyhow::bail!("unsupported projection snapshot schema");
        }
        let mut ids = Vec::with_capacity(snapshot.projects.len() + 1);
        for project in &snapshot.projects {
            let id = project
                .id
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .context("projection project id required for push")?;
            let result: CreatedRecord = self
                .request(
                    Method::PUT,
                    &format!("/v1/project-projections/{}", encode_path(id)),
                    Some(project),
                )
                .await?;
            ids.push(result.id);
        }
        let _: serde_json::Value = self
            .request(
                Method::PUT,
                &format!("/v1/daily-projections/{}", encode_path(&snapshot.date)),
                Some(&snapshot.daily),
            )
            .await?;
        ids.push(snapshot.date.clone());
        Ok(ids)
    }

    async fn request<T: Serialize, R: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: Option<&T>,
    ) -> Result<R> {
        let mut request = self
            .http
            .request(method, format!("{}{}", self.base_url, path))
            .header("X-FlowContext-Token", self.token.expose_secret())
            .header("X-Request-Id", Uuid::new_v4().to_string());
        if let Some(body) = body {
            request = request.json(body);
        }
        let response = request
            .send()
            .await
            .context("FlowContext API request failed")?;
        let status = response.status();
        if !status.is_success() {
            // Never surface the API response body: it may contain Handoff or
            // provider details. Callers receive only the status class.
            let category = match status {
                StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => "authentication failed",
                StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY => "request rejected",
                StatusCode::CONFLICT => "request conflicted",
                _ => "FlowContext API returned an error",
            };
            anyhow::bail!("{} ({})", category, status.as_u16());
        }
        response
            .json::<R>()
            .await
            .context("decode FlowContext API response")
    }
}

fn encode_path(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

#[allow(dead_code)]
pub async fn read_json_file<T: DeserializeOwned>(path: impl AsRef<Path>) -> Result<T> {
    let text = tokio::fs::read_to_string(path.as_ref())
        .await
        .context("read JSON input")?;
    serde_json::from_str(&text).context("decode JSON input")
}
