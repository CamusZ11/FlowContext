import assert from "node:assert/strict";
import test from "node:test";
import { validateDesktopEnv } from "./check-web-env.mjs";

const env = (apiUrl) => `VITE_FLOWCONTEXT_PROVIDER=self-hosted\nVITE_FLOWCONTEXT_API_URL=${apiUrl}\n`;

test("desktop release accepts only HTTPS API configuration", () => {
  assert.equal(validateDesktopEnv(env("https://api.example.test")), null);
  assert.match(validateDesktopEnv(env("http://api.example.test")), /only HTTPS/);
  assert.match(validateDesktopEnv(env("http://127.0.0.1:8787")), /only HTTPS/);
});

test("HTTP is available only to an explicit localhost fixture test", () => {
  assert.equal(validateDesktopEnv(env("http://127.0.0.1:8787"), { allowHttpFixture: true }), null);
  assert.match(validateDesktopEnv(env("http://localhost:8787"), { allowHttpFixture: true }), /only HTTPS/);
});
