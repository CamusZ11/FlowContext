import { useAuth } from "./useAuth";
import type { AuthPort } from "./useAuth";
import { LoginForm } from "./LoginForm";

export interface AuthGateProps {
  auth: AuthPort;
  children: React.ReactNode;
}

export function AuthGate({ auth, children }: AuthGateProps) {
  const { session, loading, error } = useAuth(auth);
  if (loading) return <p role="status">正在验证登录状态…</p>;
  if (error) {
    return (
      <>
        <p role="alert" className="error-text">无法验证登录状态，请重新登录。</p>
        <LoginForm auth={auth} />
      </>
    );
  }
  if (!session) return <LoginForm auth={auth} />;
  return <>{children}</>;
}
