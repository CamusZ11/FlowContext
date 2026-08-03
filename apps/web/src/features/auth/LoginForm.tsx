import { FormEvent, useState } from "react";
import type { AuthPort } from "./useAuth";

export interface LoginFormProps {
  auth: Pick<AuthPort, "signIn">;
}

export function LoginForm({ auth }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await auth.signIn(email.trim(), password);
    } catch {
      setError("登录失败，请检查邮箱和密码后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="auth-card" aria-labelledby="login-heading">
      <p className="eyebrow">PRIVATE WORKSPACE</p>
      <h1 id="login-heading">登录 FlowContext</h1>
      <p className="muted">使用已配置的私人账号继续。</p>
      <form onSubmit={handleSubmit}>
        <label>
          邮箱
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          密码
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error ? <p role="alert" className="error-text">{error}</p> : null}
        <button type="submit" disabled={submitting}>
          {submitting ? "登录中…" : "登录"}
        </button>
      </form>
    </section>
  );
}
