import { type FormEvent, useState } from "react";
import type { PlatformPort } from "../../platform/PlatformPort";
import { createHttpAuth, type PasswordlessAuthPort } from "./useAuth";

export interface DeviceEnrollmentFormProps {
  apiUrl: string;
  enrollmentCode: string;
  platform: PlatformPort;
  auth?: PasswordlessAuthPort;
}

function currentDevicePlatform(): "macos" | "windows" {
  return typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)
    ? "windows"
    : "macos";
}

export function DeviceEnrollmentForm({
  apiUrl,
  enrollmentCode,
  platform,
  auth,
}: DeviceEnrollmentFormProps) {
  const [currentEnrollmentCode, setCurrentEnrollmentCode] = useState(enrollmentCode);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrolled, setEnrolled] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setEnrolled(false);
    try {
      const enrollmentAuth = auth ?? createHttpAuth({
        baseUrl: apiUrl,
        storage: platform.sessionStorage,
        deviceId: platform.deviceId,
        devicePlatform: platform.devicePlatform ?? currentDevicePlatform(),
      });
      await enrollmentAuth.enroll({
        apiUrl: apiUrl.trim(),
        enrollmentCode: currentEnrollmentCode.trim(),
      });
      setCurrentEnrollmentCode("");
      setEnrolled(true);
    } catch {
      setError("设备登记失败，请检查 API 地址和一次性登记码后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="auth-card" aria-labelledby="device-enrollment-heading">
      <p className="eyebrow">PRIVATE DEVICE</p>
      <h1 id="device-enrollment-heading">登记此设备</h1>
      <p className="muted">只需使用一次管理员提供的短时登记码，之后将静默验证此设备。</p>
      <p className="device-identity">设备标识：{platform.deviceId}</p>
      {platform.mode === "web" ? (
        <p className="muted">浏览器凭据仅保存在当前会话中，仅供开发，不能用于生产。</p>
      ) : null}
      <form onSubmit={handleSubmit}>
        <label>
          API 地址
          <input
            type="url"
            autoComplete="url"
            value={apiUrl}
            readOnly
            required
          />
        </label>
        <label>
          一次性登记码
          <input
            type="text"
            autoComplete="off"
            value={currentEnrollmentCode}
            onChange={(event) => setCurrentEnrollmentCode(event.target.value)}
            required
          />
        </label>
        {error ? <p role="alert" className="error-text">{error}</p> : null}
        {enrolled ? <p role="status">设备登记成功，正在进入 FlowContext…</p> : null}
        <button type="submit" disabled={submitting}>
          {submitting ? "登记中…" : "登记设备"}
        </button>
      </form>
    </section>
  );
}
