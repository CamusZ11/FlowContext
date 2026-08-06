export type BootstrapErrorKind = "configuration" | "runtime";

export function getBootstrapErrorDetail(
  kind: BootstrapErrorKind,
  provider: string | undefined,
): string {
  if (kind === "configuration") {
    return "请配置 FlowContext API URL 后重新加载。";
  }
  return provider === "self-hosted"
    ? "FlowContext API 启动失败，请检查 API 地址和网络后重试。"
    : "FlowContext 本地存储暂不可用，请检查系统权限后重试。";
}
