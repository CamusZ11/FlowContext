import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformProvider } from "../../app/PlatformContext";
import type { PlatformPort } from "../../platform/PlatformPort";
import type { AuthSession, PasswordlessAuthPort } from "./useAuth";
import { AuthGate } from "./AuthGate";

function fakeAuth(session: AuthSession | null, failInitialSession = false): PasswordlessAuthPort {
  let current = session;
  let shouldFail = failInitialSession;
  const listeners = new Set<(value: AuthSession | null) => void>();
  const notify = () => listeners.forEach((listener) => listener(current));
  return {
    getSession: async () => {
      if (shouldFail) throw new Error("session network unavailable");
      return current;
    },
    onAuthStateChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    enroll: async () => {
      shouldFail = false;
      current = { userId: "owner-1" };
      notify();
      return current;
    },
    clearDeviceCredential: async () => {
      current = null;
      notify();
    },
  };
}

function testPlatform(): PlatformPort {
  const values = new Map<string, string>();
  return {
    mode: "desktop",
    devicePlatform: "macos",
    deviceId: "5d3e3ab4-2e5a-4d6e-a2fb-5d64d6a0e725",
    today: () => "2026-08-06",
    openExternal: async () => undefined,
    sessionStorage: {
      get: (key) => values.get(key) ?? null,
      set: (key, value) => { values.set(key, value); },
      remove: (key) => { values.delete(key); },
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: (key) => { values.delete(key); },
    },
  };
}

function renderEnrollmentGate(auth: PasswordlessAuthPort, enrollmentCode = "") {
  return render(
    <PlatformProvider value={testPlatform()}>
      <AuthGate auth={auth} apiUrl="https://api.example" enrollmentCode={enrollmentCode}>
        <p>主界面</p>
      </AuthGate>
    </PlatformProvider>,
  );
}

describe("passwordless authentication gate", () => {
  it("opens the app directly when an enrolled device token has a valid session", async () => {
    render(<AuthGate auth={fakeAuth({ userId: "owner-1" })}>{() => <p>主界面</p>}</AuthGate>);

    expect(await screen.findByText("主界面")).toBeInTheDocument();
    expect(screen.queryByLabelText(/密码|邮箱|登录/)).not.toBeInTheDocument();
  });

  it("exposes the authenticated owner identity to private app content", async () => {
    render(
      <AuthGate auth={fakeAuth({ userId: "owner-2" })}>
        {(session) => <div>owner:{session.userId}</div>}
      </AuthGate>,
    );

    expect(await screen.findByText("owner:owner-2")).toBeInTheDocument();
  });

  it("shows device registration instead of account login when no credential exists", async () => {
    renderEnrollmentGate(fakeAuth(null));

    expect(await screen.findByRole("heading", { name: "登记此设备" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登记设备" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/密码|邮箱|登录/)).not.toBeInTheDocument();
  });

  it("uses the same neutral registration screen when session verification has a network error", async () => {
    renderEnrollmentGate(fakeAuth(null, true));

    expect(await screen.findByRole("heading", { name: "登记此设备" })).toBeInTheDocument();
    expect(screen.getByText(/短时登记码/)).toBeInTheDocument();
    expect(screen.queryByText(/网络|登录失败|密码/)).not.toBeInTheDocument();
  });

  it("enters the app after one-time device enrollment", async () => {
    const user = userEvent.setup();
    renderEnrollmentGate(fakeAuth(null), "single-use");

    await user.click(await screen.findByRole("button", { name: "登记设备" }));

    expect(await screen.findByText("主界面")).toBeInTheDocument();
  });
});
