// Feishu (飞书 / LarkSuite) HTTP Client & utilities
// Ported from: OpenList/drivers/feishu
import { createHash } from "node:crypto"
import {
  FeishuAddition,
  FeishuBaseResp,
  FeishuCreateFolderResp,
  FeishuListData,
  FeishuListResp,
  FeishuNode,
  FeishuRemoveResp,
  FeishuTaskStatusResp,
  FeishuUploadBlock,
  FeishuUploadBlockNeed,
  FeishuUploadBlocksResp,
  FeishuUploadFinishResp,
  FeishuUploadPrepareResp,
} from "./types"

export const defaultObjTypes = ["0", "12", "22", "124"]
export const feishuUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

export function cleanBaseURL(raw?: string, fallback = "https://my.feishu.cn"): string {
  const s = (raw || "").trim()
  if (!s) return fallback
  const withProto = !/^https?:\/\//i.test(s) ? `https://${s}` : s
  try {
    const u = new URL(withProto)
    if (u.protocol && u.host) {
      return `${u.protocol}//${u.host}`
    }
  } catch {}
  return s.replace(/\/+$/, "")
}

export function getCsrfToken(cookieStr: string): string {
  if (!cookieStr) return ""
  const cookies = cookieStr.split(";").map((c) => c.trim())
  const targetNames = ["_csrf_token", "csrf_token", "swp_csrf_token"]
  for (const name of targetNames) {
    for (const c of cookies) {
      const idx = c.indexOf("=")
      if (idx > 0) {
        const k = c.slice(0, idx).trim()
        const v = c.slice(idx + 1).trim()
        if (k.toLowerCase() === name.toLowerCase() && v) {
          return v
        }
      }
    }
  }
  return ""
}

export function adler32(buf: Uint8Array | Buffer): string {
  let a = 1
  let b = 0
  const MOD = 65521
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % MOD
    b = (b + a) % MOD
  }
  const sum = ((b << 16) | a) >>> 0
  return sum.toString(10)
}

export function parseSize(size?: string): number {
  if (!size) return 0
  const n = parseInt(size.trim(), 10)
  return isNaN(n) ? 0 : n
}

function setCookieValue(cookieStr: string, key: string, value: string): string {
  const parts = cookieStr ? cookieStr.split(";").map((s) => s.trim()).filter(Boolean) : []
  const newPart = `${key}=${value}`
  const idx = parts.findIndex((p) => p.toLowerCase().startsWith(`${key.toLowerCase()}=`))
  if (idx >= 0) {
    parts[idx] = newPart
  } else {
    parts.push(newPart)
  }
  return parts.join("; ")
}

export class FeishuClient {
  private cookie: string
  private baseURL: string

  constructor(addition: FeishuAddition, defaultBaseURL = "https://my.feishu.cn") {
    this.cookie = (addition.cookie || "").trim()
    this.baseURL = cleanBaseURL(addition.base_url, defaultBaseURL)
  }

  get apiBase(): string {
    return this.baseURL
  }

  getCookie(): string {
    return this.cookie
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = path.startsWith("http://") || path.startsWith("https://") ? path : `${this.apiBase}${path}`
    const headers: Record<string, string> = {
      Accept: "application/json, text/plain, */*",
      Origin: this.apiBase,
      Referer: `${this.apiBase}/drive/home/`,
      Cookie: this.cookie,
      "User-Agent": feishuUserAgent,
    }
    const csrf = getCsrfToken(this.cookie)
    if (csrf) {
      headers["x-csrftoken"] = csrf
    }

    const res = await fetch(url, {
      ...init,
      headers: { ...headers, ...(init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : {}) },
    })

    // Capture updated session cookies
    const withGetSetCookie = res.headers as Headers & { getSetCookie?: () => string[] }
    const setCookies: string[] = typeof withGetSetCookie.getSetCookie === "function"
      ? withGetSetCookie.getSetCookie()
      : [res.headers.get("set-cookie") || ""].filter(Boolean)

    for (const sc of setCookies) {
      const main = sc.split(";")[0]?.trim()
      const eqIdx = main?.indexOf("=") ?? -1
      if (eqIdx > 0 && main) {
        const k = main.slice(0, eqIdx).trim().toLowerCase()
        const v = main.slice(eqIdx + 1).trim()
        if (
          k === "_csrf_token" ||
          k === "csrf_token" ||
          k === "swp_csrf_token" ||
          k === "sl_session" ||
          k === "session" ||
          k === "passport_app_access_token"
        ) {
          this.cookie = setCookieValue(this.cookie, main.slice(0, eqIdx).trim(), v)
        }
      }
    }

    const body = (await res.json().catch(() => ({}))) as T & FeishuBaseResp
    if (!res.ok) {
      const errMsg = body.msg || body.message || `HTTP error ${res.status}`
      throw new Error(errMsg)
    }
    if (body && typeof body.code === "number" && body.code !== 0) {
      const errMsg = body.msg || body.message || `API error (code ${body.code})`
      throw new Error(errMsg)
    }
    return body
  }

  async checkCookie(): Promise<void> {
    await this.request<FeishuListResp>("/space/api/explorer/recent/list/?length=1&rank_type=0")
  }

  async listChildren(parentToken: string, lastLabel: string, length = 50): Promise<FeishuListData> {
    const q = new URLSearchParams()
    for (const t of defaultObjTypes) {
      q.append("obj_type", t)
    }
    q.set("length", String(length))
    q.set("rank", "0")
    q.set("asc", "0")
    if (parentToken) {
      q.set("token", parentToken)
    }
    if (lastLabel) {
      q.set("last_label", lastLabel)
    }
    const resp = await this.request<FeishuListResp>(`/space/api/explorer/v3/children/list/?${q.toString()}`)
    return resp.data || { has_more: false, last_label: "" }
  }

  async listAllChildren(parentToken: string): Promise<FeishuNode[]> {
    const length = 50
    const nodes: FeishuNode[] = []
    let lastLabel = ""

    for (let i = 0; i < 100; i++) {
      const data = await this.listChildren(parentToken, lastLabel, length)
      if (data.node_list && data.node_list.length > 0 && data.entities?.nodes) {
        for (const token of data.node_list) {
          const node = data.entities.nodes[token]
          if (node) {
            nodes.push(node)
          }
        }
      } else if (data.entities?.nodes) {
        for (const [token, node] of Object.entries(data.entities.nodes)) {
          if (!parentToken && (node.type === 4 || node.type === 0) && node.name === "我的空间") {
            continue
          }
          if (!node.token) {
            node.token = token
          }
          nodes.push(node)
        }
      }

      if (!data.has_more || !data.last_label || data.last_label === lastLabel) {
        break
      }
      lastLabel = data.last_label
    }
    return nodes
  }

  async createFolder(parentToken: string, name: string): Promise<FeishuNode> {
    const params = new URLSearchParams()
    params.set("name", name)
    params.set("source", "0")
    if (parentToken) {
      params.set("parent_token", parentToken)
    }

    const resp = await this.request<FeishuCreateFolderResp>("/space/api/explorer/v2/create/folder/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    })

    if (resp.data?.node_list && resp.data.entities?.nodes) {
      for (const token of resp.data.node_list) {
        const node = resp.data.entities.nodes[token]
        if (node) return node
      }
    }
    if (resp.data?.entities?.nodes) {
      const first = Object.values(resp.data.entities.nodes)[0]
      if (first) return first
    }
    throw new Error("created folder node not found in response")
  }

  async renameFolder(token: string, name: string): Promise<void> {
    const params = new URLSearchParams()
    params.set("token", token)
    params.set("name", name)
    params.set("type", "0")

    await this.request<FeishuBaseResp>("/space/api/explorer/v2/rename/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    })
  }

  async renameFile(fileToken: string, name: string): Promise<void> {
    await this.request<FeishuBaseResp>("/space/api/box/file/update_info/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_token: fileToken, name }),
    })
  }

  async moveObj(srcToken: string, destToken: string): Promise<void> {
    const params = new URLSearchParams()
    params.set("src_token", srcToken)
    if (destToken) {
      params.set("dest_token", destToken)
    }

    await this.request<FeishuBaseResp>("/space/api/explorer/v2/move/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    })
  }

  async removeObj(tokens: string[]): Promise<void> {
    if (!tokens || tokens.length === 0) return
    const resp = await this.request<FeishuRemoveResp>("/space/api/explorer/v3/remove/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokens, apply: 1 }),
    })
    if (resp.data?.task_id) {
      await this.waitTask(resp.data.task_id)
    }
  }

  async waitTask(taskId: string): Promise<void> {
    if (!taskId) return
    for (let i = 0; i < 30; i++) {
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, 500)
      await promise
      const resp = await this.request<FeishuTaskStatusResp>(`/space/api/explorer/v2/task/?task_id=${encodeURIComponent(taskId)}`)
      if (resp.data?.is_fail) {
        throw new Error(`Task ${taskId} failed`)
      }
      if (resp.data?.is_finish) {
        return
      }
    }
  }

  async upload(name: string, content: Uint8Array | Buffer, mountNodeToken: string): Promise<string> {
    const totalSize = content.length

    // 1. Prepare upload
    const prep = await this.request<FeishuUploadPrepareResp>("/space/api/box/upload/prepare/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mount_point: "explorer",
        mount_node_token: mountNodeToken,
        name,
        size: totalSize,
        size_checker: true,
      }),
    })

    const uploadId = prep.data?.upload_id
    if (!uploadId) throw new Error("prepare upload missing upload_id")

    // 0-byte file: finish immediately with num_blocks = 0
    if (totalSize === 0) {
      const finish = await this.request<FeishuUploadFinishResp>("/space/api/box/upload/finish/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          upload_id: uploadId,
          num_blocks: 0,
          mount_point: "explorer",
        }),
      })
      return finish.data?.file_token || ""
    }

    const blockSize = prep.data?.block_size && prep.data.block_size > 0 ? prep.data.block_size : 4 * 1024 * 1024
    const numBlocks = Math.ceil(totalSize / blockSize)
    const blocks: FeishuUploadBlock[] = []

    for (let seq = 0; seq < numBlocks; seq++) {
      const offset = seq * blockSize
      const chunkSize = Math.min(blockSize, totalSize - offset)
      const chunk = content.subarray(offset, offset + chunkSize)
      const hash = createHash("sha256").update(chunk).digest("base64")
      const checksum = adler32(chunk)

      blocks.push({
        hash,
        seq,
        size: chunk.length,
        checksum,
        is_uploaded: true,
      })
    }

    // 2. Query blocks needed
    const blocksResp = await this.request<FeishuUploadBlocksResp>("/space/api/box/upload/blocks/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        upload_id: uploadId,
        blocks,
        mount_point: "explorer",
      }),
    })

    const needed = blocksResp.data?.needed_upload_blocks || []
    for (const need of needed) {
      const offset = need.seq * blockSize
      const chunkSize = Math.min(blockSize, totalSize - offset)
      const chunk = content.subarray(offset, offset + chunkSize)

      const q = new URLSearchParams({
        upload_id: uploadId,
        seq: String(need.seq),
        size: String(chunk.length),
        checksum: need.checksum,
        mount_point: "explorer",
      })

      const fd = new FormData()
      fd.set("upload_id", uploadId)
      fd.set("size", String(chunk.length))
      const arrayBuf = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer
      fd.set("file", new Blob([arrayBuf], { type: "application/octet-stream" }), "blob")

      await this.request(`/space/api/box/stream/upload/v3/block/?${q.toString()}`, {
        method: "POST",
        headers: {
          "x-block-seq": String(need.seq),
          "x-block-checksum": need.checksum,
        },
        body: fd,
      })
    }

    // 3. Finish upload
    const finish = await this.request<FeishuUploadFinishResp>("/space/api/box/upload/finish/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        upload_id: uploadId,
        num_blocks: numBlocks,
        mount_point: "explorer",
      }),
    })

    return finish.data?.file_token || ""
  }
}
