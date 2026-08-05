import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthPort, AuthSession } from "./useAuth";
import { AuthGate } from "./AuthGate";
import { LoginForm } from "./LoginForm";

function fakeAuth(session: AuthSession | null): AuthPort {
  let current = session;
  const listeners = new Set<(value: AuthSession | null) => void>();
  return {
    getSession: async () => current,
    onAuthStateChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    signIn: async () => {
      current = { userId: "user-1" };
      listeners.forEach((listener) => listener(current));
    },
    signOut: async () => {
      current = null;
      listeners.forEach((listener) => listener(current));
    },
  };
}

function flakyAuth(): AuthPort {
  let current: AuthSession | null = null;
  let failInitialSession = true;
  const listeners = new Set<(value: AuthSession | null) => void>();
  return {
    getSession: async () => {
      if (failInitialSession) throw new Error("stored session unavailable");
      return current;
    },
    onAuthStateChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    signIn: async () => {
      failInitialSession = false;
      current = { userId: "user-1" };
      listeners.forEach((listener) => listener(current));
    },
    signOut: async () => {
      current = null;
      listeners.forEach((listener) => listener(current));
    },
  };
}

describe("private authentication", () => {
  it("does not expose public registration", () => {
    render(<LoginForm auth={fakeAuth(null)} />);
    expect(screen.queryByText(/注册|sign up/i)).not.toBeInTheDocument();
  });

  it("shows the app only after an authenticated session exists", async () => {
    render(<AuthGate auth={fakeAuth({ userId: "user-1" })}><div>private</div></AuthGate>);
    expect(await screen.findByText("private")).toBeInTheDocument();
  });

  it("exposes the authenticated owner identity to private app content", async () => {
    render(
      <AuthGate auth={fakeAuth({ userId: "owner-2" })}>
        {(session) => <div>owner:{session.userId}</div>}
      </AuthGate>,
    );

    expect(await screen.findByText("owner:owner-2")).toBeInTheDocument();
  });

  it("keeps login available when stored session verification fails", async () => {
    const user = userEvent.setup();
    render(<AuthGate auth={flakyAuth()}><div>private</div></AuthGate>);
    expect(await screen.findByRole("alert")).toHaveTextContent("无法验证登录状态");
    expect(screen.getByRole("heading", { name: "登录 FlowContext" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("邮箱"), "flowcontext@example.test");
    await user.type(screen.getByLabelText("密码"), "test-password");
    await user.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByText("private")).toBeInTheDocument();
  });
});
