export const commonMessages = {
  en: {
    loading: "Loading…",
    retry: "Retry",
    requestFailed: "Request did not complete",
    technicalDetails: "Technical details",
    unknown: "Unknown",
    "error.network": "Cannot reach the local daemon. Check that it is still running.",
    "error.decode": "The daemon returned invalid JSON",
    "error.apiPath": "API requests must use this daemon’s /api/ routes",
    notFound: "This page could not be found.",
    backToLibrary: "Back to library"
  },
  "zh-CN": {
    loading: "正在加载…",
    retry: "重试",
    requestFailed: "请求未完成",
    technicalDetails: "技术详情",
    unknown: "未知",
    "error.network": "无法连接本机 daemon，请确认它仍在运行。",
    "error.decode": "daemon 返回了无效的 JSON",
    "error.apiPath": "API 请求必须使用此 daemon 的 /api/ 路由",
    notFound: "找不到这个页面。",
    backToLibrary: "返回游戏库"
  }
} as const;
