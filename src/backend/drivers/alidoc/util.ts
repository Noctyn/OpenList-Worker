// AliDoc (钉钉文档) HTTP client
import { AliDocApiResp, AliDocDentry, AliDocDownloadResp, AliDocListResp } from "./types"

export const ChinaSite = "china"
export const InternationalSite = "international"
export const chinaBaseURL = "https://alidocs.dingtalk.com"
export const internationalBaseURL = "https://docs.dingtalk.io"
export const aliDocApiBase = chinaBaseURL
export const aliDocUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

export function cleanBaseURL(raw?: string): string {
  const s = (raw || "").trim()
  if (!s) return ""
  const withProto = !/^https?:\/\//i.test(s) ? `https://${s}` : s
  try {
    const u = new URL(withProto)
    if (u.protocol && u.host) {
      return `${u.protocol}//${u.host}`
    }
  } catch {}
  return s.replace(/\/+$/, "")
}

export function resolveAliDocApiBase(addition?: { site?: string; custom_base_url?: string }): string {
  const custom = cleanBaseURL(addition?.custom_base_url)
  if (custom) return custom

  const site = (addition?.site || "").trim().toLowerCase()
  if (
    site === InternationalSite ||
    site === "intl" ||
    site === "global" ||
    site === "io" ||
    site.includes("dingtalk.io")
  ) {
    return internationalBaseURL
  }
  if (/^https?:\/\//i.test(site)) {
    const cleaned = cleanBaseURL(site)
    if (cleaned) return cleaned
    return site.replace(/\/+$/, "")
  }
  return chinaBaseURL
}

export function getCookieValue(cookieStr: string, key: string): string {
  if (!cookieStr) return ""
  const parts = cookieStr.split(";")
  for (const part of parts) {
    const idx = part.indexOf("=")
    if (idx < 0) continue
    const k = part.slice(0, idx).trim()
    if (k.toLowerCase() === key.toLowerCase()) {
      return part.slice(idx + 1).trim()
    }
  }
  return ""
}

function errMessage(r: AliDocApiResp | null): string {
  if (!r) return "request failed"
  if (r.message) return r.message
  if (r.msg) return r.msg
  return "request failed"
}

export class AliDocClient {
  private cookie: string
  private addition?: { site?: string; custom_base_url?: string }

  constructor(cookieOrAddition: string | { cookie?: string; site?: string; custom_base_url?: string }) {
    if (typeof cookieOrAddition === "string") {
      this.cookie = cookieOrAddition
    } else {
      this.cookie = cookieOrAddition.cookie || ""
      this.addition = cookieOrAddition
    }
  }

  get apiBase(): string {
    return resolveAliDocApiBase(this.addition)
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Cookie: this.cookie,
      Accept: "application/json, text/plain, */*",
      Referer: this.apiBase + "/",
      Origin: this.apiBase,
      "User-Agent": aliDocUserAgent,
    }
    const xsrf = getCookieValue(this.cookie, "XSRF-TOKEN")
    if (xsrf) {
      headers["x-xsrf-token"] = xsrf
    }
    const corpId = getCookieValue(this.cookie, "portal_corp_id")
    if (corpId) {
      headers["corp-id"] = corpId
    }
    return headers
  }

  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, {
      ...init,
      headers: { ...this.headers(), ...(init?.headers || {}) },
    })
    const body = (await res.json().catch(() => ({}))) as T & AliDocApiResp
    if (!res.ok || (body as AliDocApiResp).isSuccess === false) {
      throw new Error(errMessage(body as unknown as AliDocApiResp))
    }
    return body
  }

  async checkCookie(): Promise<void> {
    await this.request(`${this.apiBase}/portal/api/v1/mine/info`)
  }

  async list(dentryUuid: string): Promise<AliDocDentry[]> {
    const q = new URLSearchParams({
      dentryUuid,
      withParentAncestors: "true",
      orderType: "SORT_KEY",
      sortType: "desc",
      listDentrySource: "2",
      pageSize: "1000",
    })
    const resp = await this.request<AliDocListResp>(
      `${this.apiBase}/box/api/v2/dentry/list?${q.toString()}`,
    )
    return resp.data?.children || []
  }

  async download(dentryUuid: string): Promise<string> {
    const q = new URLSearchParams({
      dentryUuid,
      version: "1",
      supportDownloadTypes: "URL_PRE_SIGNATURE,HTTP_TO_CENTER",
      downloadType: "URL_PRE_SIGNATURE",
    })
    const resp = await this.request<AliDocDownloadResp>(
      `${this.apiBase}/box/api/v2/file/download?${q.toString()}`,
    )
    const urls = resp.data?.ossUrlPreSignatureInfo?.preSignUrls || []
    if (urls.length === 0) throw new Error("empty download url")
    return urls[0]
  }

  async post(path: string, body: Record<string, unknown>): Promise<void> {
    await this.request(`${this.apiBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  }
}
