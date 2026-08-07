import type { PlatformPort } from "../../platform/PlatformPort";
import { useAuth } from "./useAuth";
import type { AuthPort, AuthSession } from "./useAuth";
import { DeviceEnrollmentForm } from "./DeviceEnrollmentForm";

export interface AuthGateProps {
  auth: AuthPort;
  platform: PlatformPort;
  apiUrl?: string;
  enrollmentCode?: string;
  children: React.ReactNode | ((session: AuthSession) => React.ReactNode);
}

export function AuthGate({ auth, platform, apiUrl = "", enrollmentCode = "", children }: AuthGateProps) {
  const { session, loading, error } = useAuth(auth);
  if (loading) return <p role="status">正在验证设备状态…</p>;
  if (error || !session) {
    return (
      <DeviceEnrollmentForm
        apiUrl={apiUrl}
        enrollmentCode={enrollmentCode}
        platform={platform}
        auth={auth}
      />
    );
  }
  return <>{typeof children === "function" ? children(session) : children}</>;
}
