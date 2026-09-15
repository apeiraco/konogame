export const commonMessages = {
  en: {
    loading: "Loading…",
    retry: "Retry",
    requestFailed: "Request failed",
    unknown: "Unknown",
    "error.network": "Cannot connect to the local daemon",
    "error.decode": "The daemon returned invalid JSON",
    "error.apiPath": "API requests must use this daemon’s /api/ routes",
    notFound: "This page could not be found."
  },
  "zh-CN": {
    loading: "正在加载…",
    retry: "重试",
    requestFailed: "请求未完成",
    unknown: "未知",
    "error.network": "无法连接本地守护进程",
    "error.decode": "守护进程返回了无效的 JSON",
    "error.apiPath": "API 请求必须使用此守护进程的 /api/ 路由",
    notFound: "找不到这个页面。"
  }
} as const;
