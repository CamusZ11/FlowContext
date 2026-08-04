use flowcontext_cli::client::{FlowContextClient, HandoffCreate, HandoffTopicUpdate, TodoCreate};
use reqwest::Client as HttpClient;
use secrecy::SecretString;
use serde_json::json;
use wiremock::matchers::{body_json, header_exists, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn handoff_sends_idempotency_key_without_logging_content() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/handoffs"))
        .and(header_exists("x-flowcontext-token"))
        .and(body_json(json!({
            "sessionId": "s1",
            "topicCardId": "t1",
            "content": "handoff",
            "idempotencyKey": "s1:abc",
            "topicUpdate": {
                "currentState": "完成窗口改动",
                "nextAction": "验证全屏覆盖",
                "openQuestions": ["是否保持当前 Space？"]
            }
        })))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({ "id": "h1" })))
        .mount(&server)
        .await;

    let http = HttpClient::new();
    let client = FlowContextClient::with_http(
        &server.uri(),
        SecretString::from("device-token".to_string()),
        http,
    )
    .unwrap();
    let result = client
        .create_handoff(&HandoffCreate {
            session_id: "s1".into(),
            topic_card_id: "t1".into(),
            content: "handoff".into(),
            idempotency_key: "s1:abc".into(),
            topic_update: Some(HandoffTopicUpdate {
                current_state: Some("完成窗口改动".into()),
                next_action: Some("验证全屏覆盖".into()),
                open_questions: Some(vec!["是否保持当前 Space？".into()]),
            }),
        })
        .await
        .unwrap();
    assert_eq!(result.id, "h1");
}

#[tokio::test]
async fn failed_response_does_not_include_response_body_in_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/handoffs"))
        .respond_with(ResponseTemplate::new(422).set_body_string("private handoff body"))
        .mount(&server)
        .await;
    let client =
        FlowContextClient::new(&server.uri(), SecretString::from("token".to_string())).unwrap();
    let error = client
        .create_handoff(&HandoffCreate {
            session_id: "s1".into(),
            topic_card_id: "t1".into(),
            content: "secret".into(),
            idempotency_key: "s1:abc".into(),
            topic_update: None,
        })
        .await
        .unwrap_err()
        .to_string();
    assert!(!error.contains("private handoff body"));
    assert!(!error.contains("secret"));
}

#[tokio::test]
async fn todo_create_sends_only_the_priming_fields() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/todos"))
        .and(header_exists("x-flowcontext-token"))
        .and(body_json(json!({
            "title": "验证 macOS 全屏覆盖",
            "plannedDate": "2026-08-04",
            "plannedTime": "09:30"
        })))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({ "id": "todo-1" })))
        .mount(&server)
        .await;

    let client = FlowContextClient::with_http(
        server.uri(),
        SecretString::from("device-token".to_string()),
        HttpClient::new(),
    )
    .unwrap();
    let result = client
        .create_todo(&TodoCreate {
            title: "验证 macOS 全屏覆盖".into(),
            planned_date: "2026-08-04".into(),
            planned_time: Some("09:30".into()),
        })
        .await
        .unwrap();

    assert_eq!(result.id, "todo-1");
}
