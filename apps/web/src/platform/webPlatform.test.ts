import { webPlatform } from "./webPlatform";

it("provides the native device family required by browser-development enrollment", () => {
  expect(webPlatform.devicePlatform).toMatch(/^(macos|windows)$/);
});
