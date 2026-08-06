import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformProvider } from "../../app/PlatformContext";
import type { PlatformPort } from "../../platform/PlatformPort";
import { DeviceEnrollmentForm } from "./DeviceEnrollmentForm";
import { DEVICE_TOKEN_STORAGE_KEY } from "./useAuth";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

it("stores the enrollment token only through platform session storage", async () => {
  const user = userEvent.setup();
  const values = new Map<string, string>();
  const platform: PlatformPort = {
    mode: "desktop",
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
  window.localStorage.clear();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({ deviceToken: "issued-token", userId: "owner-1" }, 201))
    .mockResolvedValueOnce(jsonResponse({ userId: "owner-1" }));
  vi.stubGlobal("fetch", fetchMock);

  render(
    <PlatformProvider value={platform}>
      <DeviceEnrollmentForm apiUrl="https://api.example" enrollmentCode="single-use" />
    </PlatformProvider>,
  );
  expect(screen.getByLabelText("API 地址")).toHaveAttribute("readonly");
  await user.click(screen.getByRole("button", { name: "登记设备" }));

  expect(await screen.findByRole("status")).toHaveTextContent("设备登记成功");
  expect(await platform.sessionStorage.get(DEVICE_TOKEN_STORAGE_KEY)).toBe("issued-token");
  expect(window.localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY)).toBeNull();
  vi.unstubAllGlobals();
});
